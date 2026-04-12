import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { internalError } from "@/lib/errors/http-errors";
import { getStaffUnlockStateFromRequest } from "@/lib/auth/staff";
import { resolveTenantFromRequest } from "@/lib/tenant/resolve-tenant";
import {
  checkLocalRateLimit,
  checkRateLimit,
  inventoryRugWriteRateLimit,
} from "@/lib/rate-limit";
import {
  fetchRugRecordById,
  toStaffInventoryRugDetail,
} from "@/lib/inventory/rug-record";
import { fetchPrimaryRugImagesForRugs } from "@/lib/storage/rug-images";
import { parseRouteParamsWithSchema } from "@/lib/http/route-validation";
import {
  enqueueInventoryEnrichmentJob,
  setRugProcessingState,
} from "@/lib/inventory/enrichment-jobs";

const RUG_ID_PARAMS_SCHEMA = z.object({ id: z.string().uuid() }).strict();

function staffLockedResponse() {
  return NextResponse.json({ error: "staff_locked" }, { status: 401 });
}

function staffAuthMisconfiguredResponse(message: string) {
  return NextResponse.json({ error: message }, { status: 503 });
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

export async function POST(
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

  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    "unknown";
  const rateLimitResult = inventoryRugWriteRateLimit
    ? await checkRateLimit(
        inventoryRugWriteRateLimit,
        `inventory:rug:write:${tenantId}:${ip}`
      )
    : checkLocalRateLimit({
        key: `inventory:rug:write:${tenantId}:${ip}`,
        maxRequests: 60,
        windowMs: 10 * 60 * 1000,
      });
  if (!rateLimitResult.allowed) {
    return NextResponse.json(
      { error: "Too many inventory requests. Please wait and try again." },
      { status: 429 }
    );
  }

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

  const processingState = await setRugProcessingState({
    tenantId,
    rugId: params.value.id,
    currentStatus: existing.status,
    currentEnrichmentStatus: existing.enrichment_status,
    supabase: supabaseAdmin,
  });

  const enqueueResult = await enqueueInventoryEnrichmentJob({
    tenantId,
    rugId: params.value.id,
    restoreAvailableOnReady: processingState.restoreAvailableOnReady,
    supabase: supabaseAdmin,
  });
  if (!enqueueResult.ok) {
    return internalError("Unable to queue AI enrichment job.");
  }

  const updatedRow = await fetchRugRecordById({
    supabase: supabaseAdmin,
    tenantId,
    id: params.value.id,
  });
  if (!updatedRow) {
    return internalError("Unable to load updated rug.");
  }

  const updatedImage = await withPrimaryImage({
    tenantId,
    rugId: updatedRow.id,
  });
  return NextResponse.json(
    toStaffInventoryRugDetail({ row: updatedRow, ...updatedImage })
  );
}
