export type InventoryStatusFilter = "all" | "available" | "sold" | "on_hold";

export type InventorySort =
  | "newest"
  | "oldest"
  | "price_low"
  | "price_high";

export type InventoryFilters = {
  q: string;
  status: InventoryStatusFilter;
  priceMin: number | null;
  priceMax: number | null;
  widthMin: number | null;
  widthMax: number | null;
  lengthMin: number | null;
  lengthMax: number | null;
  sort: InventorySort;
};

export type InventoryBrowserRow = {
  id: string;
  sku: string | null;
  intake_label: string;
  primary_image_url: string | null;
  primary_image_caption: string | null;
  status: string | null;
  price: number | null;
  sale_price: number | null;
  width_total_in: number | null;
  length_total_in: number | null;
  style: string | null;
  palette: string | null;
  pattern: string | null;
  best_for: string | null;
  public_description: string | null;
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
