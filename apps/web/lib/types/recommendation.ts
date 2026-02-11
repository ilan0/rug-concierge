// PSEUDOCODE
// Define shared types for constraints and inventory rows.

export type HardConstraints = {
  budgetMax?: number;
  size?: {
    widthIn: number;
    lengthIn: number;
    toleranceIn?: number;
  };
};

export type InventoryRug = {
  id: string;
  sku?: string | null;
  label: string;
  status?: string | null;
  price_usd?: number | null;
  width_total_in?: number | null;
  length_total_in?: number | null;
};
