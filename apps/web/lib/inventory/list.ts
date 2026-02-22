import type { InventoryListResult, InventoryBrowserRow } from "@/lib/types/inventory";
import {
  normalizeInventoryFilters,
  type InventoryFilterInput,
} from "@/lib/inventory/filters";
import type { SupabaseClient } from "@supabase/supabase-js";

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;

type ListInventoryInput = {
  page?: number;
  pageSize?: number;
  filters?: InventoryFilterInput;
};

// Server-side inventory read helper for owner/staff transparency view.
export async function listInventory(
  input: ListInventoryInput = {}
): Promise<InventoryListResult> {
  const page = toPositiveInt(input.page, 1);
  const requestedPageSize = toPositiveInt(input.pageSize, DEFAULT_PAGE_SIZE);
  const pageSize = Math.min(requestedPageSize, MAX_PAGE_SIZE);
  const filters = normalizeInventoryFilters(input.filters);
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

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

  let query = supabase
    .from("rugs")
    .select(
      "id, sku, intake_label, status, price, sale_price, width_total_in, length_total_in, style, palette, pattern, best_for, public_description",
      { count: "exact" }
    )
    .order("id", { ascending: false })
    .range(from, to);

  if (filters.status !== "all") {
    query = query.eq("status", filters.status);
  }

  if (filters.q) {
    const token = escapeForIlike(filters.q);
    query = query.or(
      [
        `sku.ilike.%${token}%`,
        `intake_label.ilike.%${token}%`,
        `style.ilike.%${token}%`,
        `palette.ilike.%${token}%`,
        `pattern.ilike.%${token}%`,
        `public_description.ilike.%${token}%`,
      ].join(",")
    );
  }

  if (filters.priceMin !== null) {
    query = query.or(
      [
        `sale_price.gte.${filters.priceMin}`,
        `price.gte.${filters.priceMin}`,
      ].join(",")
    );
  }

  if (filters.priceMax !== null) {
    query = query.or(
      [
        `sale_price.lte.${filters.priceMax}`,
        `price.lte.${filters.priceMax}`,
      ].join(",")
    );
  }

  if (filters.widthMin !== null) {
    query = query.gte("width_total_in", filters.widthMin);
  }
  if (filters.widthMax !== null) {
    query = query.lte("width_total_in", filters.widthMax);
  }
  if (filters.lengthMin !== null) {
    query = query.gte("length_total_in", filters.lengthMin);
  }
  if (filters.lengthMax !== null) {
    query = query.lte("length_total_in", filters.lengthMax);
  }

  if (filters.sort === "oldest") {
    query = query.order("id", { ascending: true });
  } else if (filters.sort === "price_low") {
    query = query
      .order("sale_price", { ascending: true, nullsFirst: false })
      .order("price", { ascending: true, nullsFirst: false });
  } else if (filters.sort === "price_high") {
    query = query
      .order("sale_price", { ascending: false, nullsFirst: false })
      .order("price", { ascending: false, nullsFirst: false });
  } else {
    query = query.order("id", { ascending: false });
  }

  const { data, error, count } = await query;
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

  const rows = data
    .map((row) => toBrowserRow(row))
    .filter((row): row is InventoryBrowserRow => row !== null);
  const total = typeof count === "number" ? count : rows.length;
  const totalPages = total === 0 ? 0 : Math.ceil(total / pageSize);

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
  if (typeof row.id !== "string" || typeof row.intake_label !== "string") {
    return null;
  }

  return {
    id: row.id,
    sku: typeof row.sku === "string" ? row.sku : null,
    intake_label: row.intake_label,
    status: typeof row.status === "string" ? row.status : null,
    price: toNumberOrNull(row.price),
    sale_price: toNumberOrNull(row.sale_price),
    width_total_in: toNumberOrNull(row.width_total_in),
    length_total_in: toNumberOrNull(row.length_total_in),
    style: typeof row.style === "string" ? row.style : null,
    palette: typeof row.palette === "string" ? row.palette : null,
    pattern: typeof row.pattern === "string" ? row.pattern : null,
    best_for: typeof row.best_for === "string" ? row.best_for : null,
    public_description:
      typeof row.public_description === "string" ? row.public_description : null,
  };
}

function toNumberOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return null;
}

function escapeForIlike(value: string): string {
  return value.replace(/[%_]/g, "");
}

async function getSupabaseAdminSafe(): Promise<SupabaseClient | null> {
  try {
    const supabaseModule = await import("@/lib/supabase/admin");
    return supabaseModule.supabaseAdmin;
  } catch {
    return null;
  }
}
