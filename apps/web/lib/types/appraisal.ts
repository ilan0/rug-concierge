export type AppraisalStatus = "draft" | "finalized";

export type AppraisalInput = {
  appraisal_id?: string | null;
  tenant_id?: string | null;
  rug_id?: string | null;
  status?: AppraisalStatus;
  customer_name?: string | null;
  customer_contact?: string | null;
  appraisal_date?: string | null;
  rug_label?: string | null;
  rug_size_text?: string | null;
  condition?: string | null;
  style?: string | null;
  origin_country?: string | null;
  materials?: string | null;
  palette?: string | null;
  motifs?: string | null;
  appraised_value?: number | null;
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
