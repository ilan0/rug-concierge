import { NextResponse } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { internalError } from "@/lib/errors/http-errors";
import { resolveAuthoritativeTenantForServer } from "@/lib/auth/tenant";
import { fetchPrimaryRugImagesForRugs } from "@/lib/storage/rug-images";
import {
  fetchRugRecordById,
  toStaffInventoryRugDetail,
} from "@/lib/inventory/rug-record";
import { formatRugSize } from "@/lib/utils/format";
import { parseRouteParamsWithSchema } from "@/lib/http/route-validation";

const RUG_ID_PARAMS_SCHEMA = z.object({ id: z.string().uuid() }).strict();

export async function GET(
  _req: Request,
  context: { params: Promise<{ id: string }> }
) {
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
  if (!row || row.status !== "available") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (row.width_total_in === null || row.length_total_in === null) {
    return internalError("Rug dimensions are unavailable.");
  }

  const imageMap = await fetchPrimaryRugImagesForRugs({
    supabase: supabaseAdmin,
    tenantId,
    rugIds: [params.value.id],
  });
  const primaryImageUrl = imageMap.get(params.value.id)?.primary_image_url ?? null;

  const detail = toStaffInventoryRugDetail({
    row,
    primaryImageUrl,
    primaryImageCaption: null,
  });

  return NextResponse.json({
    id: row.id,
    intake_label: row.intake_label,
    effective_fields: detail.effective_fields,
    ai_description: row.ai_description,
    width_total_in: row.width_total_in,
    length_total_in: row.length_total_in,
    size_display: formatRugSize(row.width_total_in, row.length_total_in),
    primary_image_url: primaryImageUrl,
  });
}
