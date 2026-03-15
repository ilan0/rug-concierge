import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { badRequest, internalError } from "@/lib/errors/http-errors";
import { isStaffUnlockedFromRequest } from "@/lib/auth/staff";
import { resolveAuthoritativeTenantForServer } from "@/lib/auth/tenant";
import { fetchPrimaryRugImagesForRugs } from "@/lib/storage/rug-images";
import { requestVisionEnrichment } from "@/lib/inventory/vision-enrichment";
import {
  checkLocalRateLimit,
  checkRateLimit,
  inventoryWriteRateLimit,
} from "@/lib/rate-limit";
import {
  fetchRugRecordById,
  toStaffInventoryRugDetail,
} from "@/lib/inventory/rug-record";
import { parseRouteParamsWithSchema } from "@/lib/http/route-validation";

const RUG_ID_PARAMS_SCHEMA = z.object({ id: z.string().uuid() }).strict();

function staffLockedResponse() {
  return NextResponse.json({ error: "staff_locked" }, { status: 401 });
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
  if (!isStaffUnlockedFromRequest(req)) {
    return staffLockedResponse();
  }

  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    "unknown";
  const rateLimitResult = inventoryWriteRateLimit
    ? await checkRateLimit(inventoryWriteRateLimit, `inventory:re-enrich:${ip}`)
    : checkLocalRateLimit({
        key: `inventory:re-enrich:${ip}`,
        maxRequests: 30,
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

  const image = await withPrimaryImage({ tenantId, rugId: params.value.id });
  if (!image.primaryImageUrl) {
    return badRequest("Rug does not have a primary image to analyze.");
  }

  const enrichment = await requestVisionEnrichment({
    imageUrl: image.primaryImageUrl,
    widthTotalIn: existing.width_total_in,
    lengthTotalIn: existing.length_total_in,
  });
  if (!enrichment) {
    return internalError("Vision enrichment failed for this rug.");
  }

  const updateResult = await supabaseAdmin
    .from("rugs")
    .update({
      intake_label: enrichment.intakeLabel,
      ai_description: enrichment.aiDescription,
      ai_structured_fields: enrichment.aiStructuredFields,
    })
    .eq("tenant_id", tenantId)
    .eq("id", params.value.id);

  if (updateResult.error) {
    return internalError("Unable to save enrichment result.");
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

