import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { badRequest, internalError } from "@/lib/errors/http-errors";
import { resolveAuthoritativeTenantForServer } from "@/lib/auth/tenant";
import { isStaffUnlockedFromRequest } from "@/lib/auth/staff";
import { fetchPrimaryRugImagesForRugs } from "@/lib/storage/rug-images";
import {
  aiStructuredFieldsSchema,
  staffOverridesSchema,
} from "@/lib/inventory/schemas";
import {
  mergeStaffOverrides,
  resolveEffectiveFields,
} from "@/lib/inventory/resolve-fields";

const PATCH_BODY_SCHEMA = z
  .object({
    stock_id: z.string().max(80).nullable().optional(),
    status: z.enum(["available", "sold", "on_hold"]).optional(),
    staff_overrides: staffOverridesSchema.optional(),
  })
  .strict();

type RugRecord = {
  id: string;
  tenant_id: string;
  intake_label: string | null;
  ai_description: string | null;
  ai_structured_fields: unknown;
  staff_overrides: unknown;
  stock_id: string | null;
  status: string | null;
  width_total_in: number | null;
  length_total_in: number | null;
  created_at: string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function toAiStructuredFields(value: unknown) {
  if (!isRecord(value)) return null;
  const parsed = aiStructuredFieldsSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function toStaffOverrides(value: unknown) {
  if (!isRecord(value)) return null;
  const parsed = staffOverridesSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function shapeRugResponse(input: {
  row: RugRecord;
  primaryImageUrl: string | null;
  primaryImageCaption: string | null;
}) {
  const aiFields = toAiStructuredFields(input.row.ai_structured_fields);
  const staffOverrides = toStaffOverrides(input.row.staff_overrides);

  return {
    id: input.row.id,
    tenant_id: input.row.tenant_id,
    intake_label: input.row.intake_label,
    ai_description: input.row.ai_description,
    ai_structured_fields: aiFields,
    staff_overrides: staffOverrides,
    effective_fields: resolveEffectiveFields(input.row.intake_label, aiFields, staffOverrides),
    stock_id: input.row.stock_id,
    status: input.row.status,
    width_total_in: input.row.width_total_in,
    length_total_in: input.row.length_total_in,
    created_at: input.row.created_at,
    primary_image_url: input.primaryImageUrl,
    primary_image_caption: input.primaryImageCaption,
  };
}

async function fetchStaffRugById(input: {
  tenantId: string;
  id: string;
}): Promise<RugRecord | null> {
  const runQuery = (columns: string) =>
    supabaseAdmin
      .from("rugs")
      .select(columns)
      .eq("tenant_id", input.tenantId)
      .eq("id", input.id)
      .maybeSingle();

  const selectCandidates = [
    "id, tenant_id, intake_label, ai_description, ai_structured_fields, staff_overrides, stock_id, status, width_total_in, length_total_in, created_at",
    "id, tenant_id, intake_label, ai_description, ai_structured_fields, stock_id, status, width_total_in, length_total_in, created_at",
    "id, tenant_id, intake_label, ai_description, status, width_total_in, length_total_in, created_at",
  ];

  let result = await runQuery(selectCandidates[0]);
  for (const selectColumns of selectCandidates.slice(1)) {
    if (!result.error) break;
    if (!isLikelyMissingColumnError(result.error.message ?? "")) break;
    result = await runQuery(selectColumns);
  }

  if (result.error || !result.data) return null;

  const row = result.data as unknown as Record<string, unknown>;
  if (
    typeof row.id !== "string" ||
    typeof row.tenant_id !== "string" ||
    row.id.trim().length === 0 ||
    row.tenant_id.trim().length === 0
  ) {
    return null;
  }

  return {
    id: row.id,
    tenant_id: row.tenant_id,
    intake_label: typeof row.intake_label === "string" ? row.intake_label : null,
    ai_description:
      typeof row.ai_description === "string" ? row.ai_description : null,
    ai_structured_fields: row.ai_structured_fields,
    staff_overrides: row.staff_overrides ?? null,
    stock_id: typeof row.stock_id === "string" ? row.stock_id : null,
    status: typeof row.status === "string" ? row.status : null,
    width_total_in:
      typeof row.width_total_in === "number" && Number.isFinite(row.width_total_in)
        ? row.width_total_in
        : null,
    length_total_in:
      typeof row.length_total_in === "number" && Number.isFinite(row.length_total_in)
        ? row.length_total_in
        : null,
    created_at: typeof row.created_at === "string" ? row.created_at : null,
  };
}

function isLikelyMissingColumnError(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("does not exist") ||
    normalized.includes("schema cache") ||
    normalized.includes("could not find the")
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

function staffLockedResponse() {
  return NextResponse.json({ error: "staff_locked" }, { status: 401 });
}

function parsePatchBody(
  body: unknown
): { ok: true; value: z.infer<typeof PATCH_BODY_SCHEMA> } | { ok: false; response: NextResponse } {
  if (!isRecord(body)) {
    return { ok: false, response: badRequest("Invalid request payload.") };
  }

  if (
    Object.prototype.hasOwnProperty.call(body, "staff_overrides") &&
    body.staff_overrides === null
  ) {
    return {
      ok: false,
      response: badRequest(
        "staff_overrides cannot be null. Omit it for no change, or provide an object."
      ),
    };
  }

  const parsed = PATCH_BODY_SCHEMA.safeParse(body);
  if (!parsed.success) {
    return { ok: false, response: badRequest("Invalid request payload.") };
  }
  return { ok: true, value: parsed.data };
}

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  if (!isStaffUnlockedFromRequest(req)) {
    return staffLockedResponse();
  }

  const { id } = await context.params;
  if (!id || typeof id !== "string") {
    return badRequest("rug id is required.");
  }

  const tenantId = resolveAuthoritativeTenantForServer({});
  if (!tenantId) {
    return internalError("Tenant is not configured.");
  }

  const row = await fetchStaffRugById({ tenantId, id });
  if (!row) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const image = await withPrimaryImage({ tenantId, rugId: row.id });
  return NextResponse.json(shapeRugResponse({ row, ...image }));
}

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  if (!isStaffUnlockedFromRequest(req)) {
    return staffLockedResponse();
  }

  const { id } = await context.params;
  if (!id || typeof id !== "string") {
    return badRequest("rug id is required.");
  }

  const tenantId = resolveAuthoritativeTenantForServer({});
  if (!tenantId) {
    return internalError("Tenant is not configured.");
  }

  const existing = await fetchStaffRugById({ tenantId, id });
  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const rawBody = (await req.json().catch(() => null)) as unknown;
  const parsedBody = parsePatchBody(rawBody);
  if (!parsedBody.ok) {
    return parsedBody.response;
  }

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
      toStaffOverrides(existing.staff_overrides),
      parsedBody.value.staff_overrides ?? {}
    );
  }

  let updated = existing;
  if (Object.keys(updatePayload).length > 0) {
    const result = await supabaseAdmin
      .from("rugs")
      .update(updatePayload)
      .eq("tenant_id", tenantId)
      .eq("id", id);

    if (result.error) {
      return internalError("Unable to update rug.");
    }

    const refreshed = await fetchStaffRugById({ tenantId, id });
    if (!refreshed) {
      return internalError("Unable to load updated rug.");
    }
    updated = refreshed;
  }

  const image = await withPrimaryImage({ tenantId, rugId: updated.id });
  return NextResponse.json(shapeRugResponse({ row: updated, ...image }));
}
