import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { internalError } from "@/lib/errors/http-errors";
import { resolveAuthoritativeTenantForServer } from "@/lib/auth/tenant";
import { isStaffUnlockedFromRequest } from "@/lib/auth/staff";
import { fetchPrimaryRugImagesForRugs } from "@/lib/storage/rug-images";
import {
  checkLocalRateLimit,
  checkRateLimit,
  inventoryReadRateLimit,
  inventoryWriteRateLimit,
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

const RUG_ID_PARAMS_SCHEMA = z.object({ id: z.string().uuid() }).strict();

const PATCH_BODY_SCHEMA = z
  .object({
    stock_id: z.string().max(80).nullable().optional(),
    status: z.enum(["available", "sold", "on_hold"]).optional(),
    staff_overrides: staffOverridesSchema.optional(),
  })
  .strict();

function staffLockedResponse() {
  return NextResponse.json({ error: "staff_locked" }, { status: 401 });
}

async function enforceInventoryRateLimit(
  req: NextRequest,
  scope: "read" | "write"
): Promise<NextResponse | null> {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    "unknown";

  const key = `inventory:rug:${scope}:${ip}`;
  const rateLimitResult =
    scope === "read"
      ? inventoryReadRateLimit
        ? await checkRateLimit(inventoryReadRateLimit, key)
        : checkLocalRateLimit({
            key,
            maxRequests: 120,
            windowMs: 10 * 60 * 1000,
          })
      : inventoryWriteRateLimit
        ? await checkRateLimit(inventoryWriteRateLimit, key)
        : checkLocalRateLimit({
            key,
            maxRequests: 30,
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
  if (!isStaffUnlockedFromRequest(req)) {
    return staffLockedResponse();
  }
  const rateLimited = await enforceInventoryRateLimit(req, "read");
  if (rateLimited) return rateLimited;

  const params = await parseRouteParamsWithSchema(
    context.params,
    RUG_ID_PARAMS_SCHEMA,
    "rug id is required."
  );
  if (!params.ok) return params.response;

  const tenantId = resolveAuthoritativeTenantForServer({});
  if (!tenantId) {
    return internalError("Tenant is not configured.");
  }

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
  if (!isStaffUnlockedFromRequest(req)) {
    return staffLockedResponse();
  }
  const rateLimited = await enforceInventoryRateLimit(req, "write");
  if (rateLimited) return rateLimited;

  const params = await parseRouteParamsWithSchema(
    context.params,
    RUG_ID_PARAMS_SCHEMA,
    "rug id is required."
  );
  if (!params.ok) return params.response;

  const tenantId = resolveAuthoritativeTenantForServer({});
  if (!tenantId) {
    return internalError("Tenant is not configured.");
  }

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
    updatePayload.staff_overrides = mergeStaffOverrides(
      existing.staff_overrides,
      parsedBody.value.staff_overrides ?? {}
    );
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
