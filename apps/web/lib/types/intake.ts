import type { UiRole } from "@/lib/types/chat-ui";

export type IntakeCreateRequest = {
  role: UiRole;
  tenant_id: string;
  width_ft: number;
  width_in: number;
  length_ft: number;
  length_in: number;
  image: File;
};

export type IntakeCreatedRug = {
  id: string;
  intake_label: string | null;
  ai_description: string | null;
  status: string | null;
  width_total_in: number;
  length_total_in: number;
  primary_image_url: string | null;
};

export type IntakeCreateResponse = {
  rug: IntakeCreatedRug;
  ai_status: "processing";
};
