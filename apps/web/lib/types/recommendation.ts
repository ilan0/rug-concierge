// Shared recommendation types.

export type HardConstraints = {
  size?: {
    widthIn: number;
    lengthIn: number;
    toleranceIn?: number;
  };
};

export type InventoryRug = {
  id: string;
  intake_label: string | null;
  primary_image_url?: string | null;
  status?: string | null;
  width_total_in?: number | null;
  length_total_in?: number | null;
  ai_description?: string | null;
};
