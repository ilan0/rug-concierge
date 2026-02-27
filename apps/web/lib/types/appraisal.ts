export type AppraisalStatus = "draft" | "reviewed" | "finalized" | "void";

export type AppraisalCondition =
  | "excellent"
  | "very_good"
  | "good"
  | "fair"
  | "distressed";

export type AppraisalSourceType = "inventory_linked" | "customer_owned";

export type AppraisalInput = {
  appraisal_id?: string | null;
  tenant_id?: string | null;
  rug_id?: string | null;
  external_rug_label?: string | null;
  status?: AppraisalStatus;
  customer_name?: string | null;
  customer_phone?: string | null;
  customer_email?: string | null;
  customer_address_line1?: string | null;
  customer_address_line2?: string | null;
  customer_city?: string | null;
  customer_state?: string | null;
  customer_postal_code?: string | null;
  customer_country?: string | null;
  appraisal_date?: string | null;
  appraised_value?: number | null;
  condition?: AppraisalCondition | null;
  condition_notes?: string | null;
  rug_type_label?: string | null;
  origin_country?: string | null;
  region?: string | null;
  age_category?: string | null;
  construction?: string | null;
  foundation?: string | null;
  pile_material?: string | null;
  width_ft?: number | null;
  width_in?: number | null;
  length_ft?: number | null;
  length_in?: number | null;
  rug_size_text?: string | null;
  dominant_colors?: string[] | null;
  design_motifs?: string[] | null;
  custom_fields?: Record<string, unknown> | null;
  // Legacy aliases kept for compatibility and prompt continuity.
  customer_contact?: string | null;
  rug_label?: string | null;
  style?: string | null;
  materials?: string | null;
  palette?: string | null;
  motifs?: string | null;
  currency?: string | null;
  staff_notes?: string | null;
};

export type AppraisalDraftResponse = {
  mode: "appraisal_draft" | "cannot_generate";
  assistant_message: string;
  draft: {
    header: {
      customer_name: string | null;
      customer_contact: string | null;
      appraisal_date: string | null;
      rug_label: string | null;
      rug_size_text: string | null;
    };
    description_paragraphs: string[];
    value_section: {
      label: "Appraised Value";
      amount: number | null;
      currency: string | null;
      statement: string;
    };
    disclaimers: string[];
    metadata: {
      generated_at: string;
      schema_version: "appraisal_draft_v1";
    };
  } | null;
  missing_fields: string[];
  notes: string | null;
};

export type AppraisalQualityMetrics = {
  completeness_score: number;
  missing_required_fields: string[];
  missing_recommended_fields: string[];
  evidence_fields_used: string[];
};

export type AppraisalGenerateRequest = {
  role?: string;
  user_role?: string;
  tenant_id?: string | null;
  source_type?: AppraisalSourceType;
  rug_id?: string | null;
  appraisal_id?: string | null;
  persist?: boolean;
  appraisal_context?: AppraisalInput;
};

export type AppraisalGenerateResponse = AppraisalDraftResponse & {
  appraisal_id: string | null;
  persisted: boolean;
  source_type: AppraisalSourceType;
  quality: AppraisalQualityMetrics;
};

export type AppraisalRugSearchRow = {
  id: string;
  sku: string | null;
  intake_label: string;
  status: string | null;
  price: number | null;
  sale_price: number | null;
  width_total_in: number | null;
  length_total_in: number | null;
  style: string | null;
  origin_country: string | null;
  palette: string | null;
  pattern: string | null;
  condition: string | null;
};

export type AppraisalDraftListItem = {
  id: string;
  tenant_id: string;
  rug_id: string | null;
  external_rug_label: string | null;
  customer_name: string | null;
  appraisal_date: string | null;
  appraised_value: number | null;
  condition: string | null;
  rug_type_label: string | null;
  origin_country: string | null;
  status: AppraisalStatus;
  draft_text: string | null;
  final_text: string | null;
  created_at: string;
  updated_at: string;
  custom_fields: Record<string, unknown>;
};

