import type {
  EffectiveRugFields,
  RugAiStructuredFields,
  StaffOverrides,
} from "@/lib/types/inventory";

// Shared recommendation types.

export type RecommendationShapeConstraint =
  | "runner"
  | "round_oval"
  | "area"
  | "oversized";

export type RecommendationRoomPreference =
  | "living_room"
  | "dining_room"
  | "bedroom"
  | "kitchen"
  | "hallway"
  | "entryway"
  | "office";

export type HardConstraints = {
  size?: {
    widthIn: number;
    lengthIn: number;
    toleranceIn?: number;
  };
  colors?: string[];
  styles?: string[];
  shape?: RecommendationShapeConstraint;
};

export type InventoryRug = {
  id: string;
  intake_label: string | null;
  primary_image_url?: string | null;
  status?: string | null;
  width_total_in?: number | null;
  length_total_in?: number | null;
  ai_description?: string | null;
  ai_structured_fields?: RugAiStructuredFields | null;
  staff_overrides?: StaffOverrides | null;
  effective_fields?: EffectiveRugFields | null;
  origin?: string | null;
  style?: string | null;
  mood?: string | null;
};
