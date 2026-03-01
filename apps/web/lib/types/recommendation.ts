// PSEUDOCODE
// Define shared types for:
// - hard-constraint inputs (budget + size envelope)
// - inventory rows passed through backend filters and into AI context.

export type HardConstraints = {
  // Maximum allowed price from user.
  budgetMax?: number;
  size?: {
    // Requested rug size in inches.
    widthIn: number;
    lengthIn: number;
    // Optional user-specified tolerance in inches (+/-).
    toleranceIn?: number;
  };
};

export type InventoryRug = {
  // Stable rug identifier used for recommendation linking.
  id: string;
  sku?: string | null;
  // Human-readable rug title/label shown in UI.
  label: string;
  primary_image_url?: string | null;
  primary_image_caption?: string | null;
  // Inventory status (ex: available, sold, on_hold).
  status?: string | null;
  // Base price and optional sale price.
  price_usd?: number | null;
  sale_price_usd?: number | null;
  // Normalized dimensions (inches) used by hard filters.
  width_total_in?: number | null;
  length_total_in?: number | null;
  // Soft-ranking metadata for AI explanations.
  style?: string | null;
  palette?: string | null;
  pattern?: string | null;
  best_for?: string | null;
  public_description?: string | null;
};
