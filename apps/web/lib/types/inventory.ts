import type {
  EnrichmentStatus,
  ReviewReasonCode,
} from "@/lib/inventory/enrichment-state";

export type InventoryStatusFilter = "all" | "available" | "on_hold";

export type InventoryRugStatus = "available" | "on_hold";

export type InventorySort = "newest" | "oldest";
export type InventorySizePreset =
  | "accent"
  | "3x5"
  | "4x6"
  | "5x8"
  | "6x9"
  | "8x10"
  | "9x12"
  | "10x14"
  | "oversized"
  | "runner"
  | "round-oval";

export type RugOrigin =
  | "Persian"
  | "Afghan"
  | "Turkish"
  | "Indian"
  | "Caucasian"
  | "Pakistani"
  | "Moroccan"
  | "Central Asian"
  | "Other";

export type RugAgeCategory =
  | "antique"
  | "semi-antique"
  | "vintage"
  | "traditional"
  | "contemporary"
  | "new";

export type RugMood = "traditional" | "transitional" | "eclectic" | "modern";

export type RugAiStructuredFields = {
  origin?: RugOrigin | null;
  style?: string | null;
  pattern?: string[] | null;
  primary_colors?: string[] | null;
  age_category?: RugAgeCategory | null;
  mood?: RugMood | null;
};

export type StaffOverrides = {
  label?: string | null;
  origin?: string | null;
  style?: string | null;
  pattern?: string[] | null;
  primary_colors?: string[] | null;
  age_category?: string | null;
  mood?: string | null;
};

export type EffectiveRugFields = {
  label: string;
  origin?: string | null;
  style?: string | null;
  pattern?: string[] | null;
  primary_colors?: string[] | null;
  age_category?: string | null;
  mood?: string | null;
};

export type InventoryFilters = {
  q: string;
  status: InventoryStatusFilter;
  sizePresets: InventorySizePreset[];
  widthMin: number | null;
  widthMax: number | null;
  lengthMin: number | null;
  lengthMax: number | null;
  sort: InventorySort;
};

export type InventoryBrowserRow = {
  id: string;
  tenant_id: string | null;
  effective_label: string | null;
  intake_label: string | null;
  primary_image_url: string | null;
  primary_image_caption: string | null;
  ai_structured_fields: RugAiStructuredFields | null;
  staff_overrides: StaffOverrides | null;
  stock_id: string | null;
  status: InventoryRugStatus | null;
  enrichment_status: EnrichmentStatus | null;
  review_reason_code: ReviewReasonCode | null;
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

export type StaffInventoryRugDetail = {
  id: string;
  tenant_id: string;
  intake_label: string | null;
  ai_description: string | null;
  ai_structured_fields: RugAiStructuredFields | null;
  staff_overrides: StaffOverrides | null;
  effective_fields: EffectiveRugFields;
  stock_id: string | null;
  status: InventoryRugStatus | null;
  enrichment_status: EnrichmentStatus | null;
  review_reason_code: ReviewReasonCode | null;
  width_total_in: number | null;
  length_total_in: number | null;
  created_at: string | null;
  primary_image_url: string | null;
  primary_image_caption: string | null;
};
