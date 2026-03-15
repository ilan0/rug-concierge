import type { InventoryListResult } from "@/lib/types/inventory";
import {
  normalizeInventoryFilters,
  type InventoryFilterInput,
} from "@/lib/inventory/filters";
import {
  isLikelyMissingColumnError,
  parseRugRecord,
  RUG_SELECT_CANDIDATES,
  toInventoryBrowserRow,
} from "@/lib/inventory/rug-record";
import { fetchPrimaryRugImagesForRugs } from "@/lib/storage/rug-images";
import { toExactSizePresetSpec } from "@/lib/inventory/size-presets";
import type { SupabaseClient } from "@supabase/supabase-js";

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;

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
  const to = from + pageSize - 1;

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

  let countQuery = supabase
    .from("rugs")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId);

  countQuery = applySqlFilters(countQuery, filters);

  const countResult = await countQuery;
  if (countResult.error) {
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

  const total = countResult.count ?? 0;
  const totalPages = total === 0 ? 0 : Math.ceil(total / pageSize);
  if (total === 0) {
    return {
      rows: [],
      total,
      page,
      pageSize,
      totalPages,
      filters,
      loadedAt: new Date().toISOString(),
      error: null,
    };
  }

  const runQuery = (selectColumns: string) => {
    let query = supabase
      .from("rugs")
      .select(selectColumns)
      .eq("tenant_id", tenantId);

    query = applySqlFilters(query, filters);

    if (filters.sort === "oldest") {
      query = query
        .order("created_at", { ascending: true, nullsFirst: true })
        .order("id", { ascending: true });
    } else {
      query = query
        .order("created_at", { ascending: false, nullsFirst: false })
        .order("id", { ascending: false });
    }

    return query.range(from, to);
  };

  let queryResult = await runQuery(RUG_SELECT_CANDIDATES[0]);

  for (const selectColumns of RUG_SELECT_CANDIDATES.slice(1)) {
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

  const rowsFromDb = (data as unknown[])
    .map((row) => parseRugRecord(row))
    .filter((row): row is NonNullable<typeof row> => row !== null)
    .map((row) => toInventoryBrowserRow(row));

  const imageMap = await fetchPrimaryRugImagesForRugs({
    supabase,
    tenantId,
    rugIds: rowsFromDb.map((row) => row.id),
  });
  const rows = rowsFromDb.map((row) => {
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

type InventorySqlQuery<T> = {
  eq: (column: string, value: unknown) => T;
  gte: (column: string, value: number) => T;
  lte: (column: string, value: number) => T;
  or: (filters: string) => T;
};

function applySqlFilters<T extends InventorySqlQuery<T>>(
  query: T,
  filters: ReturnType<typeof normalizeInventoryFilters>
): T {
  let next = query;

  if (filters.status !== "all") {
    next = next.eq("status", filters.status);
  }

  const searchTokens = filters.q
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .map((token) => sanitizeSearchToken(token))
    .filter((token) => token.length > 0);

  if (filters.widthMin !== null) {
    next = next.gte("width_total_in", filters.widthMin);
  }
  if (filters.widthMax !== null) {
    next = next.lte("width_total_in", filters.widthMax);
  }
  if (filters.lengthMin !== null) {
    next = next.gte("length_total_in", filters.lengthMin);
  }
  if (filters.lengthMax !== null) {
    next = next.lte("length_total_in", filters.lengthMax);
  }

  const booleanExpressions: string[] = [];
  if (searchTokens.length > 0) {
    const tokenExpressions = searchTokens.map((token) => {
      const pattern = `*${token}*`;
      return `or(intake_label.ilike.${pattern},stock_id.ilike.${pattern},ai_description.ilike.${pattern})`;
    });
    booleanExpressions.push(
      tokenExpressions.length === 1
        ? tokenExpressions[0]
        : `and(${tokenExpressions.join(",")})`
    );
  }

  if (filters.sizePresets.length > 0) {
    const clauses = buildSizePresetClauses(filters.sizePresets);
    if (clauses.length > 0) {
      booleanExpressions.push(
        clauses.length === 1 ? clauses[0] : `or(${clauses.join(",")})`
      );
    }
  }

  if (booleanExpressions.length > 0) {
    const expression =
      booleanExpressions.length === 1
        ? booleanExpressions[0]
        : `and(${booleanExpressions.join(",")})`;
    next = next.or(expression);
  }

  return next;
}

function sanitizeSearchToken(token: string): string {
  return token
    .replace(/[^a-z0-9-]/gi, "")
    .slice(0, 40);
}

function buildExactSizeClauses(
  widthIn: number,
  lengthIn: number,
  toleranceIn: number
): string[] {
  const widthMin = Math.max(0, Math.floor(widthIn - toleranceIn));
  const widthMax = Math.ceil(widthIn + toleranceIn);
  const lengthMin = Math.max(0, Math.floor(lengthIn - toleranceIn));
  const lengthMax = Math.ceil(lengthIn + toleranceIn);

  return [
    `and(width_total_in.gte.${widthMin},width_total_in.lte.${widthMax},length_total_in.gte.${lengthMin},length_total_in.lte.${lengthMax})`,
    `and(width_total_in.gte.${lengthMin},width_total_in.lte.${lengthMax},length_total_in.gte.${widthMin},length_total_in.lte.${widthMax})`,
  ];
}

function buildSizePresetClauses(
  sizePresets: ReturnType<typeof normalizeInventoryFilters>["sizePresets"]
): string[] {
  const clauses: string[] = [];

  for (const preset of sizePresets) {
    if (preset === "accent") {
      clauses.push(
        "and(width_total_in.lte.36,length_total_in.lte.60)",
        "and(width_total_in.lte.60,length_total_in.lte.36)"
      );
      continue;
    }

    if (preset === "runner") {
      clauses.push(
        "and(width_total_in.lte.42,length_total_in.gte.93)",
        "and(width_total_in.gte.93,length_total_in.lte.42)"
      );
      continue;
    }

    if (preset === "oversized") {
      clauses.push(
        "and(width_total_in.gte.84,length_total_in.gte.133)",
        "and(width_total_in.gte.133,length_total_in.gte.84)"
      );
      continue;
    }

    if (preset === "round-oval") {
      for (const keyword of ["round", "circular", "circle", "oval"]) {
        clauses.push(
          `intake_label.ilike.*${keyword}*`,
          `ai_description.ilike.*${keyword}*`
        );
      }
      continue;
    }

    const spec = toExactSizePresetSpec(preset);
    if (!spec) continue;
    clauses.push(
      ...buildExactSizeClauses(spec.widthIn, spec.lengthIn, spec.toleranceIn)
    );
  }

  return clauses;
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
