import {
  aiStructuredFieldsSchema,
  staffOverridesSchema,
} from "@/lib/inventory/schemas";
import { normalizeColorList } from "@/lib/config/color-taxonomy";
import {
  isEnrichmentStatus,
  isReviewReasonCode,
} from "@/lib/inventory/enrichment-state";
import { resolveEffectiveFields } from "@/lib/inventory/resolve-fields";
import type {
  InventoryBrowserRow,
  InventoryRugStatus,
  StaffInventoryRugDetail,
} from "@/lib/types/inventory";
import type { SupabaseClient } from "@supabase/supabase-js";

export const RUG_SELECT_WITH_OVERRIDES =
  "id, tenant_id, intake_label, ai_description, ai_structured_fields, staff_overrides, stock_id, status, enrichment_status, review_reason_code, width_total_in, length_total_in, created_at";
export const RUG_SELECT_LEGACY =
  "id, tenant_id, intake_label, ai_description, ai_structured_fields, stock_id, status, enrichment_status, review_reason_code, width_total_in, length_total_in, created_at";
export const RUG_SELECT_MINIMAL =
  "id, tenant_id, intake_label, ai_description, stock_id, status, width_total_in, length_total_in, created_at";

export const RUG_SELECT_CANDIDATES = [
  RUG_SELECT_WITH_OVERRIDES,
  RUG_SELECT_LEGACY,
  RUG_SELECT_MINIMAL,
] as const;

export type RugRecord = {
  id: string;
  tenant_id: string;
  intake_label: string | null;
  ai_description: string | null;
  ai_structured_fields: InventoryBrowserRow["ai_structured_fields"];
  staff_overrides: InventoryBrowserRow["staff_overrides"];
  stock_id: string | null;
  status: InventoryRugStatus | null;
  enrichment_status: InventoryBrowserRow["enrichment_status"];
  review_reason_code: InventoryBrowserRow["review_reason_code"];
  width_total_in: number | null;
  length_total_in: number | null;
  created_at: string | null;
};

function toStringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function toInventoryRugStatusOrNull(
  value: unknown
): InventoryRugStatus | null {
  return value === "available" || value === "on_hold" ? value : null;
}

function toNumberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function toEnrichmentStatusOrNull(
  value: unknown
): InventoryBrowserRow["enrichment_status"] {
  return isEnrichmentStatus(value) ? value : null;
}

function toReviewReasonCodeOrNull(
  value: unknown
): InventoryBrowserRow["review_reason_code"] {
  return isReviewReasonCode(value) ? value : null;
}

function toAiStructuredFieldsOrNull(
  value: unknown
): InventoryBrowserRow["ai_structured_fields"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const normalized = { ...(value as Record<string, unknown>) };
  if (Array.isArray(normalized.primary_colors)) {
    normalized.primary_colors = normalizeColorList(
      normalized.primary_colors as string[],
      8
    );
  }
  const parsed = aiStructuredFieldsSchema.safeParse(normalized);
  return parsed.success ? parsed.data : null;
}

function toStaffOverridesOrNull(
  value: unknown
): InventoryBrowserRow["staff_overrides"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const normalized = { ...(value as Record<string, unknown>) };
  if (Array.isArray(normalized.primary_colors)) {
    normalized.primary_colors = normalizeColorList(
      normalized.primary_colors as string[],
      8
    );
  }
  const parsed = staffOverridesSchema.safeParse(normalized);
  return parsed.success ? parsed.data : null;
}

function normalizeLabel(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function parseRugRecord(row: unknown): RugRecord | null {
  if (!row || typeof row !== "object" || Array.isArray(row)) return null;
  const record = row as Record<string, unknown>;

  const id = toStringOrNull(record.id);
  const tenantId = toStringOrNull(record.tenant_id);
  if (!id || !tenantId || id.trim().length === 0 || tenantId.trim().length === 0) {
    return null;
  }

  return {
    id,
    tenant_id: tenantId,
    intake_label: toStringOrNull(record.intake_label),
    ai_description: toStringOrNull(record.ai_description),
    ai_structured_fields: toAiStructuredFieldsOrNull(record.ai_structured_fields),
    staff_overrides: toStaffOverridesOrNull(record.staff_overrides),
    stock_id: toStringOrNull(record.stock_id),
    status: toInventoryRugStatusOrNull(record.status),
    enrichment_status: toEnrichmentStatusOrNull(record.enrichment_status),
    review_reason_code: toReviewReasonCodeOrNull(record.review_reason_code),
    width_total_in: toNumberOrNull(record.width_total_in),
    length_total_in: toNumberOrNull(record.length_total_in),
    created_at: toStringOrNull(record.created_at),
  };
}

export function toInventoryBrowserRow(row: RugRecord): InventoryBrowserRow {
  const sourceLabel =
    normalizeLabel(row.staff_overrides?.label) ?? normalizeLabel(row.intake_label);
  const effectiveFields = resolveEffectiveFields(
    row.intake_label,
    row.ai_structured_fields,
    row.staff_overrides,
    row.ai_description
  );

  return {
    id: row.id,
    tenant_id: row.tenant_id,
    effective_label: sourceLabel ?? normalizeLabel(effectiveFields.label),
    intake_label: row.intake_label,
    primary_image_url: null,
    primary_image_caption: null,
    ai_structured_fields: row.ai_structured_fields,
    staff_overrides: row.staff_overrides,
    stock_id: row.stock_id,
    status: row.status,
    enrichment_status: row.enrichment_status,
    review_reason_code: row.review_reason_code,
    width_total_in: row.width_total_in,
    length_total_in: row.length_total_in,
    ai_description: row.ai_description,
    created_at: row.created_at,
  };
}

export function toStaffInventoryRugDetail(input: {
  row: RugRecord;
  primaryImageUrl: string | null;
  primaryImageCaption: string | null;
}): StaffInventoryRugDetail {
  return {
    id: input.row.id,
    tenant_id: input.row.tenant_id,
    intake_label: input.row.intake_label,
    ai_description: input.row.ai_description,
    ai_structured_fields: input.row.ai_structured_fields,
    staff_overrides: input.row.staff_overrides,
    effective_fields: resolveEffectiveFields(
      input.row.intake_label,
      input.row.ai_structured_fields,
      input.row.staff_overrides,
      input.row.ai_description
    ),
    stock_id: input.row.stock_id,
    status: input.row.status,
    enrichment_status: input.row.enrichment_status,
    review_reason_code: input.row.review_reason_code,
    width_total_in: input.row.width_total_in,
    length_total_in: input.row.length_total_in,
    created_at: input.row.created_at,
    primary_image_url: input.primaryImageUrl,
    primary_image_caption: input.primaryImageCaption,
  };
}

export function isLikelyMissingColumnError(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("does not exist") ||
    normalized.includes("schema cache") ||
    normalized.includes("could not find the")
  );
}

export async function fetchRugRecordById(input: {
  supabase: SupabaseClient;
  tenantId: string;
  id: string;
}): Promise<RugRecord | null> {
  const runQuery = (columns: string) =>
    input.supabase
      .from("rugs")
      .select(columns)
      .eq("tenant_id", input.tenantId)
      .eq("id", input.id)
      .maybeSingle();

  let result = await runQuery(RUG_SELECT_CANDIDATES[0]);
  for (const selectColumns of RUG_SELECT_CANDIDATES.slice(1)) {
    if (!result.error) break;
    if (!isLikelyMissingColumnError(result.error.message ?? "")) break;
    result = await runQuery(selectColumns);
  }

  if (result.error || !result.data) return null;
  return parseRugRecord(result.data);
}
