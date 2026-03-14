import type { InventoryListResult, InventoryBrowserRow } from "@/lib/types/inventory";
import {
  normalizeInventoryFilters,
  type InventoryFilterInput,
} from "@/lib/inventory/filters";
import {
  aiStructuredFieldsSchema,
  staffOverridesSchema,
} from "@/lib/inventory/schemas";
import { resolveEffectiveFields } from "@/lib/inventory/resolve-fields";
import { fetchPrimaryRugImagesForRugs } from "@/lib/storage/rug-images";
import { toExactSizePresetSpec } from "@/lib/inventory/size-presets";
import type { SupabaseClient } from "@supabase/supabase-js";

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;
const SELECT_WITH_OVERRIDES =
  "id, tenant_id, intake_label, ai_structured_fields, staff_overrides, stock_id, status, width_total_in, length_total_in, ai_description, created_at";
const SELECT_LEGACY =
  "id, tenant_id, intake_label, ai_structured_fields, stock_id, status, width_total_in, length_total_in, ai_description, created_at";
const SELECT_MINIMAL =
  "id, tenant_id, intake_label, status, width_total_in, length_total_in, ai_description, created_at";

type ListInventoryInput = {
  tenantId?: string | null;
  page?: number;
  pageSize?: number;
  filters?: InventoryFilterInput;
};

// Server-side inventory read helper for owner/staff transparency view.
export async function listInventory(
  input: ListInventoryInput = {}
): Promise<InventoryListResult> {
  const tenantId =
    typeof input.tenantId === "string" && input.tenantId.trim().length > 0
      ? input.tenantId.trim()
      : null;
  const page = toPositiveInt(input.page, 1);
  const requestedPageSize = toPositiveInt(input.pageSize, DEFAULT_PAGE_SIZE);
  const pageSize = Math.min(requestedPageSize, MAX_PAGE_SIZE);
  const filters = normalizeInventoryFilters(input.filters);
  const from = (page - 1) * pageSize;
  const to = from + pageSize;

  if (!tenantId) {
    return {
      rows: [],
      total: 0,
      page,
      pageSize,
      totalPages: 0,
      filters,
      loadedAt: new Date().toISOString(),
      error: "Tenant context is required to load inventory.",
    };
  }

  const supabase = await getSupabaseAdminSafe();
  if (!supabase) {
    return {
      rows: [],
      total: 0,
      page,
      pageSize,
      totalPages: 0,
      filters,
      loadedAt: new Date().toISOString(),
      error: "Unable to connect to inventory source (missing Supabase server config).",
    };
  }

  const runQuery = (selectColumns: string) => {
    let query = supabase
      .from("rugs")
      .select(selectColumns)
      .eq("tenant_id", tenantId);

    if (filters.status !== "all") {
      query = query.eq("status", filters.status);
    }

    if (filters.sort === "oldest") {
      query = query
        .order("created_at", { ascending: true, nullsFirst: true })
        .order("id", { ascending: true });
    } else {
      query = query
        .order("created_at", { ascending: false, nullsFirst: false })
        .order("id", { ascending: false });
    }

    return query;
  };

  const selectCandidates = [SELECT_WITH_OVERRIDES, SELECT_LEGACY, SELECT_MINIMAL];
  let queryResult = await runQuery(selectCandidates[0]);

  for (const selectColumns of selectCandidates.slice(1)) {
    if (!queryResult.error) break;
    if (!isLikelyMissingColumnError(queryResult.error.message ?? "")) break;
    queryResult = await runQuery(selectColumns);
  }

  const { data, error } = queryResult;
  if (error || !Array.isArray(data)) {
    return {
      rows: [],
      total: 0,
      page,
      pageSize,
      totalPages: 0,
      filters,
      loadedAt: new Date().toISOString(),
      error: "Failed to load inventory records.",
    };
  }

  const allRows = (data as unknown as Record<string, unknown>[])
    .map((row) => toBrowserRow(row))
    .filter((row): row is InventoryBrowserRow => row !== null);
  const filteredRows = allRows.filter((row) =>
    matchesRowWithFilters(row, filters)
  );
  const total = filteredRows.length;
  const totalPages = total === 0 ? 0 : Math.ceil(total / pageSize);
  const pagedRows = filteredRows.slice(from, to);

  const imageMap = await fetchPrimaryRugImagesForRugs({
    supabase,
    tenantId,
    rugIds: pagedRows.map((row) => row.id),
  });
  const rows = pagedRows.map((row) => {
    const image = imageMap.get(row.id);
    return {
      ...row,
      primary_image_url: image?.primary_image_url ?? null,
      primary_image_caption: image?.primary_image_caption ?? null,
    };
  });

  return {
    rows,
    total,
    page,
    pageSize,
    totalPages,
    filters,
    loadedAt: new Date().toISOString(),
    error: null,
  };
}

function toPositiveInt(value: unknown, fallback: number): number {
  if (typeof value !== "number") return fallback;
  if (!Number.isFinite(value) || value < 1) return fallback;
  return Math.floor(value);
}

function toBrowserRow(row: Record<string, unknown>): InventoryBrowserRow | null {
  if (typeof row.id !== "string") {
    return null;
  }

  const intakeLabel =
    typeof row.intake_label === "string" ? row.intake_label : null;
  const aiStructuredFields = toAiStructuredFieldsOrNull(row.ai_structured_fields);
  const staffOverrides = toStaffOverridesOrNull(row.staff_overrides);
  const sourceLabel =
    normalizeLabel(staffOverrides?.label) ?? normalizeLabel(intakeLabel);
  const mergedFields = resolveEffectiveFields(
    intakeLabel,
    aiStructuredFields,
    staffOverrides
  );

  return {
    id: row.id,
    tenant_id: typeof row.tenant_id === "string" ? row.tenant_id : null,
    effective_label: sourceLabel ?? normalizeLabel(mergedFields.label),
    intake_label: intakeLabel,
    primary_image_url: null,
    primary_image_caption: null,
    ai_structured_fields: aiStructuredFields,
    staff_overrides: staffOverrides,
    stock_id: typeof row.stock_id === "string" ? row.stock_id : null,
    status: typeof row.status === "string" ? row.status : null,
    width_total_in: toNumberOrNull(row.width_total_in),
    length_total_in: toNumberOrNull(row.length_total_in),
    ai_description:
      typeof row.ai_description === "string" ? row.ai_description : null,
    created_at: typeof row.created_at === "string" ? row.created_at : null,
  };
}

function toNumberOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return null;
}

function toAiStructuredFieldsOrNull(
  value: unknown
): InventoryBrowserRow["ai_structured_fields"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const parsed = aiStructuredFieldsSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function toStaffOverridesOrNull(
  value: unknown
): InventoryBrowserRow["staff_overrides"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const parsed = staffOverridesSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function matchesRowWithFilters(
  row: InventoryBrowserRow,
  filters: ReturnType<typeof normalizeInventoryFilters>
): boolean {
  if (!matchesSearchQuery(row, filters.q)) return false;
  if (!matchesManualSizeBounds(row, filters)) return false;
  if (!matchesSizePreset(row, filters.sizePreset)) return false;
  return true;
}

function matchesSearchQuery(row: InventoryBrowserRow, query: string): boolean {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return true;

  const tokens = normalized.split(/\s+/).filter((token) => token.length > 0);
  if (tokens.length === 0) return true;

  const haystack = [
    row.effective_label,
    row.intake_label,
    row.stock_id,
    row.ai_description,
  ]
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .toLowerCase();

  return tokens.every((token) => haystack.includes(token));
}

function matchesManualSizeBounds(
  row: InventoryBrowserRow,
  filters: ReturnType<typeof normalizeInventoryFilters>
): boolean {
  const width = row.width_total_in;
  const length = row.length_total_in;

  if (
    filters.widthMin === null &&
    filters.widthMax === null &&
    filters.lengthMin === null &&
    filters.lengthMax === null
  ) {
    return true;
  }
  if (width === null || length === null) return false;
  if (filters.widthMin !== null && width < filters.widthMin) return false;
  if (filters.widthMax !== null && width > filters.widthMax) return false;
  if (filters.lengthMin !== null && length < filters.lengthMin) return false;
  if (filters.lengthMax !== null && length > filters.lengthMax) return false;
  return true;
}

function matchesSizePreset(
  row: InventoryBrowserRow,
  sizePreset: ReturnType<typeof normalizeInventoryFilters>["sizePreset"]
): boolean {
  if (!sizePreset) return true;
  if (sizePreset === "runner") return matchesRunnerPreset(row);
  if (sizePreset === "round-oval") return matchesRoundOvalPreset(row);

  const spec = toExactSizePresetSpec(sizePreset);
  if (!spec) return true;
  const width = row.width_total_in;
  const length = row.length_total_in;
  if (width === null || length === null) return false;

  const directMatch =
    Math.abs(width - spec.widthIn) <= spec.toleranceIn &&
    Math.abs(length - spec.lengthIn) <= spec.toleranceIn;
  if (directMatch) return true;

  return (
    Math.abs(width - spec.lengthIn) <= spec.toleranceIn &&
    Math.abs(length - spec.widthIn) <= spec.toleranceIn
  );
}

function matchesRunnerPreset(row: InventoryBrowserRow): boolean {
  const width = row.width_total_in;
  const length = row.length_total_in;
  if (width === null || length === null) return false;

  const shortSide = Math.min(width, length);
  const longSide = Math.max(width, length);
  if (shortSide <= 0) return false;

  return shortSide <= 42 && longSide >= 84 && longSide / shortSide >= 2.2;
}

function matchesRoundOvalPreset(row: InventoryBrowserRow): boolean {
  const haystack = `${row.intake_label ?? ""} ${row.ai_description ?? ""}`.toLowerCase();
  return /\b(round|circular|circle|oval)\b/.test(haystack);
}

function normalizeLabel(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isLikelyMissingColumnError(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("does not exist") ||
    normalized.includes("schema cache") ||
    normalized.includes("could not find the")
  );
}

async function getSupabaseAdminSafe(): Promise<SupabaseClient | null> {
  try {
    const supabaseModule = await import("@/lib/supabase/admin");
    return supabaseModule.supabaseAdmin;
  } catch {
    return null;
  }
}

export async function getInventoryStats(
  tenantId: string
): Promise<{ total: number; available: number }> {
  const normalizedTenantId = tenantId.trim();
  if (!normalizedTenantId) {
    return { total: 0, available: 0 };
  }

  const supabase = await getSupabaseAdminSafe();
  if (!supabase) {
    return { total: 0, available: 0 };
  }

  const [totalResult, availableResult] = await Promise.all([
    supabase
      .from("rugs")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", normalizedTenantId),
    supabase
      .from("rugs")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", normalizedTenantId)
      .eq("status", "available"),
  ]);

  if (totalResult.error || availableResult.error) {
    return { total: 0, available: 0 };
  }

  return {
    total: totalResult.count ?? 0,
    available: availableResult.count ?? 0,
  };
}
