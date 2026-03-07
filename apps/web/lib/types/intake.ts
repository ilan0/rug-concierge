import type { UiRole } from "@/lib/types/chat-ui";

export type IntakeCreateRequest = {
  role: UiRole;
  tenant_id: string;
  intake_label: string;
  width_ft: number;
  width_in: number;
  length_ft: number;
  length_in: number;
  image: File;
};

export type IntakeCreatedRug = {
  id: string;
  tenant_id: string;
  intake_label: string;
  status: string | null;
  price: number | null;
  sale_price: number | null;
  width_ft: number;
  width_in: number;
  length_ft: number;
  length_in: number;
  width_total_in: number;
  length_total_in: number;
  created_at: string;
  primary_image_url: string | null;
  primary_image_path: string | null;
};

export type IntakeCreateResponse = {
  rug: IntakeCreatedRug;
};
