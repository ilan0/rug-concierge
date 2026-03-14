import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { badRequest, internalError } from "@/lib/errors/http-errors";
import { resolveAuthoritativeTenantForServer } from "@/lib/auth/tenant";
import { fetchPrimaryRugImagesForRugs } from "@/lib/storage/rug-images";
import {
  aiStructuredFieldsSchema,
  staffOverridesSchema,
} from "@/lib/inventory/schemas";
import { resolveEffectiveFields } from "@/lib/inventory/resolve-fields";
import { formatRugSize } from "@/lib/utils/format";

function toAiStructuredFields(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const parsed = aiStructuredFieldsSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function toStaffOverrides(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const parsed = staffOverridesSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export async function GET(
  _req: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  if (!id || typeof id !== "string") {
    return badRequest("rug id is required.");
  }

  const tenantId = resolveAuthoritativeTenantForServer({});
  if (!tenantId) {
    return internalError("Tenant is not configured.");
  }

  const runRugQuery = (columns: string) =>
    supabaseAdmin
      .from("rugs")
      .select(columns)
      .eq("tenant_id", tenantId)
      .eq("id", id)
      .maybeSingle();

  const selectCandidates = [
    "id, intake_label, ai_structured_fields, staff_overrides, ai_description, width_total_in, length_total_in, status",
    "id, intake_label, ai_structured_fields, ai_description, width_total_in, length_total_in, status",
    "id, intake_label, ai_description, width_total_in, length_total_in, status",
  ];

  let rugResult = await runRugQuery(selectCandidates[0]);
  for (const selectColumns of selectCandidates.slice(1)) {
    if (!rugResult.error) break;
    if (!isLikelyMissingColumnError(rugResult.error.message ?? "")) break;
    rugResult = await runRugQuery(selectColumns);
  }

  if (rugResult.error || !rugResult.data) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const rug = rugResult.data as unknown as Record<string, unknown>;
  if (rug.status !== "available") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const widthTotalIn =
    typeof rug.width_total_in === "number" ? rug.width_total_in : null;
  const lengthTotalIn =
    typeof rug.length_total_in === "number" ? rug.length_total_in : null;
  if (widthTotalIn === null || lengthTotalIn === null) {
    return internalError("Rug dimensions are unavailable.");
  }
  const sizeDisplay = formatRugSize(widthTotalIn, lengthTotalIn);

  const imageMap = await fetchPrimaryRugImagesForRugs({
    supabase: supabaseAdmin,
    tenantId,
    rugIds: [id],
  });
  const primaryImageUrl = imageMap.get(id)?.primary_image_url ?? null;

  const aiFields = toAiStructuredFields(rug.ai_structured_fields);
  const staffOverrides = toStaffOverrides(rug.staff_overrides ?? null);

  return NextResponse.json({
    id,
    intake_label:
      typeof rug.intake_label === "string" ? rug.intake_label : null,
    effective_fields: resolveEffectiveFields(
      typeof rug.intake_label === "string" ? rug.intake_label : null,
      aiFields,
      staffOverrides
    ),
    ai_description:
      typeof rug.ai_description === "string" ? rug.ai_description : null,
    width_total_in: widthTotalIn,
    length_total_in: lengthTotalIn,
    size_display: sizeDisplay,
    primary_image_url: primaryImageUrl,
  });
}

function isLikelyMissingColumnError(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("does not exist") ||
    normalized.includes("schema cache") ||
    normalized.includes("could not find the")
  );
}
