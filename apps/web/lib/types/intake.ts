import type {
  EnrichmentStatus,
  ReviewReasonCode,
} from "@/lib/inventory/enrichment-state";

export type IntakeCreateRequest = {
  tenant_id: string;
  stock_id?: string | null;
  width_ft: number;
  width_in: number;
  length_ft: number;
  length_in: number;
  image: File;
};

export type IntakeCreatedRug = {
  id: string;
  stock_id: string | null;
  intake_label: string | null;
  ai_description: string | null;
  status: "available" | "on_hold" | null;
  enrichment_status: EnrichmentStatus | null;
  review_reason_code: ReviewReasonCode | null;
  width_total_in: number;
  length_total_in: number;
  primary_image_url: string | null;
};

export type IntakeCreateResponse = {
  rug: IntakeCreatedRug;
  ai_status: "processing";
};

export type IntakeDuplicateImageResponse = {
  error: string;
  code: "DUPLICATE_IMAGE";
  existing_rug: {
    id: string;
    label: string | null;
  };
};
