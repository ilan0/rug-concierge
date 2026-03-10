import type { InventoryListResult, InventoryBrowserRow } from "@/lib/types/inventory";
import {
  normalizeInventoryFilters,
  type InventoryFilterInput,
} from "@/lib/inventory/filters";
import { fetchPrimaryRugImagesForRugs } from "@/lib/storage/rug-images";
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

  let query = supabase
    .from("rugs")
    .select(
      "id, tenant_id, intake_label, status, width_total_in, length_total_in, ai_description, created_at",
      { count: "exact" }
    )
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false, nullsFirst: false })
    .order("id", { ascending: false })
    .range(from, to);

  if (filters.status !== "all") {
    query = query.eq("status", filters.status);
  }

  if (filters.q) {
    const token = escapeForIlike(filters.q);
    query = query.or(
      [
        `intake_label.ilike.%${token}%`,
        `ai_description.ilike.%${token}%`,
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
    query = query
      .order("created_at", { ascending: true, nullsFirst: true })
      .order("id", { ascending: true });
  } else {
    query = query
      .order("created_at", { ascending: false, nullsFirst: false })
      .order("id", { ascending: false });
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

  const baseRows = data
    .map((row) => toBrowserRow(row))
    .filter((row): row is InventoryBrowserRow => row !== null);
  const imageMap = await fetchPrimaryRugImagesForRugs({
    supabase,
    tenantId,
    rugIds: baseRows.map((row) => row.id),
  });
  const rows = baseRows.map((row) => {
    const image = imageMap.get(row.id);
    return {
      ...row,
      primary_image_url: image?.primary_image_url ?? null,
      primary_image_caption: image?.primary_image_caption ?? null,
    };
  });
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
    tenant_id: typeof row.tenant_id === "string" ? row.tenant_id : null,
    intake_label: row.intake_label,
    primary_image_url: null,
    primary_image_caption: null,
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
