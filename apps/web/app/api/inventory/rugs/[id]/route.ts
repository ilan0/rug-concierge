import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { internalError } from "@/lib/errors/http-errors";
import { resolveTenantFromRequest } from "@/lib/tenant/resolve-tenant";
import { getStaffUnlockStateFromRequest } from "@/lib/auth/staff";
import { fetchPrimaryRugImagesForRugs } from "@/lib/storage/rug-images";
import { buildTradeTitle } from "@/lib/inventory/title-builder";
import {
  checkLocalRateLimit,
  checkRateLimit,
  inventoryReadRateLimit,
  inventoryRugWriteRateLimit,
} from "@/lib/rate-limit";
import { staffOverridesSchema } from "@/lib/inventory/schemas";
import { mergeStaffOverrides } from "@/lib/inventory/resolve-fields";
import {
  fetchRugRecordById,
  toStaffInventoryRugDetail,
} from "@/lib/inventory/rug-record";
import {
  parseJsonBodyWithSchema,
  parseRouteParamsWithSchema,
} from "@/lib/http/route-validation";

const RUG_IMAGES_BUCKET = "rug-images";
const RUG_ID_PARAMS_SCHEMA = z.object({ id: z.string().uuid() }).strict();

const PATCH_BODY_SCHEMA = z
  .object({
    stock_id: z.string().max(80).nullable().optional(),
    status: z.enum(["available", "not_available"]).optional(),
    staff_overrides: staffOverridesSchema.optional(),
  })
  .strict();

function staffLockedResponse() {
  return NextResponse.json({ error: "staff_locked" }, { status: 401 });
}

function staffAuthMisconfiguredResponse(message: string) {
  return NextResponse.json({ error: message }, { status: 503 });
}

async function enforceInventoryRateLimit(
  req: NextRequest,
  tenantId: string,
  scope: "read" | "write"
): Promise<NextResponse | null> {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    "unknown";

  const key =
    scope === "read"
      ? `inventory:rug:read:${ip}`
      : `inventory:rug:write:${tenantId}:${ip}`;
  const rateLimitResult =
    scope === "read"
      ? inventoryReadRateLimit
        ? await checkRateLimit(inventoryReadRateLimit, key)
        : checkLocalRateLimit({
            key,
            maxRequests: 600,
            windowMs: 10 * 60 * 1000,
          })
      : inventoryRugWriteRateLimit
        ? await checkRateLimit(inventoryRugWriteRateLimit, key)
        : checkLocalRateLimit({
            key,
            maxRequests: 60,
            windowMs: 10 * 60 * 1000,
          });

  if (rateLimitResult.allowed) return null;
  return NextResponse.json(
    { error: "Too many inventory requests. Please wait and try again." },
    { status: 429 }
  );
}

async function withPrimaryImage(input: { tenantId: string; rugId: string }) {
  const imageMap = await fetchPrimaryRugImagesForRugs({
    supabase: supabaseAdmin,
    tenantId: input.tenantId,
    rugIds: [input.rugId],
  });
  const image = imageMap.get(input.rugId);
  return {
    primaryImageUrl: image?.primary_image_url ?? null,
    primaryImageCaption: image?.primary_image_caption ?? null,
  };
}

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const tenantResolution = await resolveTenantFromRequest(req);
  if (!tenantResolution.ok) {
    return NextResponse.json(
      { error: tenantResolution.message },
      { status: tenantResolution.status }
    );
  }
  const tenantId = tenantResolution.tenantId;

  const staffUnlockState = await getStaffUnlockStateFromRequest(req, tenantId);
  if (!staffUnlockState.ok) {
    return staffAuthMisconfiguredResponse(staffUnlockState.message);
  }
  if (!staffUnlockState.unlocked) {
    return staffLockedResponse();
  }
  const rateLimited = await enforceInventoryRateLimit(req, tenantId, "read");
  if (rateLimited) return rateLimited;

  const params = await parseRouteParamsWithSchema(
    context.params,
    RUG_ID_PARAMS_SCHEMA,
    "rug id is required."
  );
  if (!params.ok) return params.response;

  const row = await fetchRugRecordById({
    supabase: supabaseAdmin,
    tenantId,
    id: params.value.id,
  });
  if (!row) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const image = await withPrimaryImage({ tenantId, rugId: row.id });
  return NextResponse.json(toStaffInventoryRugDetail({ row, ...image }));
}

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const tenantResolution = await resolveTenantFromRequest(req);
  if (!tenantResolution.ok) {
    return NextResponse.json(
      { error: tenantResolution.message },
      { status: tenantResolution.status }
    );
  }
  const tenantId = tenantResolution.tenantId;

  const staffUnlockState = await getStaffUnlockStateFromRequest(req, tenantId);
  if (!staffUnlockState.ok) {
    return staffAuthMisconfiguredResponse(staffUnlockState.message);
  }
  if (!staffUnlockState.unlocked) {
    return staffLockedResponse();
  }
  const rateLimited = await enforceInventoryRateLimit(req, tenantId, "write");
  if (rateLimited) return rateLimited;

  const params = await parseRouteParamsWithSchema(
    context.params,
    RUG_ID_PARAMS_SCHEMA,
    "rug id is required."
  );
  if (!params.ok) return params.response;

  const existing = await fetchRugRecordById({
    supabase: supabaseAdmin,
    tenantId,
    id: params.value.id,
  });
  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const parsedBody = await parseJsonBodyWithSchema(
    req,
    PATCH_BODY_SCHEMA,
    "Invalid request payload."
  );
  if (!parsedBody.ok) return parsedBody.response;

  const updatePayload: Record<string, unknown> = {};
  if (Object.prototype.hasOwnProperty.call(parsedBody.value, "stock_id")) {
    const stockId = parsedBody.value.stock_id;
    updatePayload.stock_id =
      typeof stockId === "string" ? stockId.trim() || null : stockId;
  }
  if (Object.prototype.hasOwnProperty.call(parsedBody.value, "status")) {
    updatePayload.status = parsedBody.value.status;
  }
  if (Object.prototype.hasOwnProperty.call(parsedBody.value, "staff_overrides")) {
    const mergedOverrides = mergeStaffOverrides(
      existing.staff_overrides,
      parsedBody.value.staff_overrides ?? {}
    );
    updatePayload.staff_overrides = mergedOverrides;

    const explicitStaffLabel =
      typeof mergedOverrides?.label === "string" &&
      mergedOverrides.label.trim().length > 0
        ? mergedOverrides.label.trim()
        : null;

    const computedTitle = buildTradeTitle({
      aiFields: {
        origin:
          mergedOverrides?.origin ??
          existing.ai_structured_fields?.origin ??
          null,
        style:
          mergedOverrides?.style ??
          existing.ai_structured_fields?.style ??
          null,
        age_category:
          mergedOverrides?.age_category ??
          existing.ai_structured_fields?.age_category ??
          null,
        pattern:
          mergedOverrides?.pattern ??
          existing.ai_structured_fields?.pattern ??
          null,
        primary_colors:
          mergedOverrides?.primary_colors ??
          existing.ai_structured_fields?.primary_colors ??
          null,
        mood:
          mergedOverrides?.mood ??
          existing.ai_structured_fields?.mood ??
          null,
      },
      widthTotalIn: existing.width_total_in,
      lengthTotalIn: existing.length_total_in,
      fallbackLabel: explicitStaffLabel ?? existing.intake_label,
    });

    const isReady = Boolean(computedTitle);
    updatePayload.enrichment_status = isReady ? "ready" : "needs_review";
    updatePayload.review_reason_code = isReady ? null : "ANALYSIS_INCOMPLETE";
    if (computedTitle) {
      updatePayload.intake_label = computedTitle;
    }
  }

  const nextEnrichmentStatus =
    typeof updatePayload.enrichment_status === "string"
      ? updatePayload.enrichment_status
      : existing.enrichment_status;
  if (nextEnrichmentStatus !== "ready") {
    updatePayload.status = "not_available";
  } else if (updatePayload.status === "available") {
    updatePayload.status = "available";
  }

  let updated = existing;
  if (Object.keys(updatePayload).length > 0) {
    const result = await supabaseAdmin
      .from("rugs")
      .update(updatePayload)
      .eq("tenant_id", tenantId)
      .eq("id", params.value.id);

    if (result.error) {
      return internalError("Unable to update rug.");
    }

    const refreshed = await fetchRugRecordById({
      supabase: supabaseAdmin,
      tenantId,
      id: params.value.id,
    });
    if (!refreshed) {
      return internalError("Unable to load updated rug.");
    }
    updated = refreshed;
  }

  const image = await withPrimaryImage({ tenantId, rugId: updated.id });
  return NextResponse.json(toStaffInventoryRugDetail({ row: updated, ...image }));
}

export async function DELETE(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const tenantResolution = await resolveTenantFromRequest(req);
  if (!tenantResolution.ok) {
    return NextResponse.json(
      { error: tenantResolution.message },
      { status: tenantResolution.status }
    );
  }
  const tenantId = tenantResolution.tenantId;

  const staffUnlockState = await getStaffUnlockStateFromRequest(req, tenantId);
  if (!staffUnlockState.ok) {
    return staffAuthMisconfiguredResponse(staffUnlockState.message);
  }
  if (!staffUnlockState.unlocked) {
    return staffLockedResponse();
  }
  const rateLimited = await enforceInventoryRateLimit(req, tenantId, "write");
  if (rateLimited) return rateLimited;

  const params = await parseRouteParamsWithSchema(
    context.params,
    RUG_ID_PARAMS_SCHEMA,
    "rug id is required."
  );
  if (!params.ok) return params.response;

  const existing = await fetchRugRecordById({
    supabase: supabaseAdmin,
    tenantId,
    id: params.value.id,
  });
  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const imageRows = await supabaseAdmin
    .from("rug_images")
    .select("path")
    .eq("tenant_id", tenantId)
    .eq("rug_id", params.value.id);
  if (imageRows.error) {
    return internalError("Unable to read rug images before delete.");
  }

  const storagePaths = (Array.isArray(imageRows.data) ? imageRows.data : [])
    .map((row) => (typeof row?.path === "string" ? row.path.trim() : ""))
    .filter((path) => path.length > 0);

  if (storagePaths.length > 0) {
    const storageRemove = await supabaseAdmin.storage
      .from(RUG_IMAGES_BUCKET)
      .remove(storagePaths);
    if (storageRemove.error) {
      return internalError("Unable to delete rug image from storage.");
    }
  }

  const deleteResult = await supabaseAdmin
    .from("rugs")
    .delete()
    .eq("tenant_id", tenantId)
    .eq("id", params.value.id);
  if (deleteResult.error) {
    return internalError("Unable to delete rug.");
  }

  return NextResponse.json({ ok: true, id: params.value.id });
}
