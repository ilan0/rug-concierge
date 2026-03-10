export type InventoryStatusFilter = "all" | "available" | "sold" | "on_hold";

export type InventorySort = "newest" | "oldest";

export type InventoryFilters = {
  q: string;
  status: InventoryStatusFilter;
  widthMin: number | null;
  widthMax: number | null;
  lengthMin: number | null;
  lengthMax: number | null;
  sort: InventorySort;
};

export type InventoryBrowserRow = {
  id: string;
  tenant_id: string | null;
  intake_label: string;
  primary_image_url: string | null;
  primary_image_caption: string | null;
  status: string | null;
  width_total_in: number | null;
  length_total_in: number | null;
  ai_description: string | null;
  created_at: string | null;
};

export type InventoryListResult = {
  rows: InventoryBrowserRow[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  filters: InventoryFilters;
  loadedAt: string;
  error: string | null;
};
