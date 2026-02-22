import type { AppraisalDraftResponse, AppraisalInput } from "@/lib/types/appraisal";

export type AppraisalFormState = {
  status: "draft" | "finalized";
  customer_name: string;
  customer_contact: string;
  appraisal_date: string;
  rug_label: string;
  rug_size_text: string;
  condition: string;
  style: string;
  origin_country: string;
  materials: string;
  palette: string;
  motifs: string;
  appraised_value: string;
  currency: string;
  staff_notes: string;
};

export type AppraisalUiResult = AppraisalDraftResponse;

export function toAppraisalInput(form: AppraisalFormState): AppraisalInput {
  const value =
    form.appraised_value.trim().length > 0
      ? Number(form.appraised_value.trim())
      : null;

  return {
    status: form.status,
    customer_name: form.customer_name.trim() || null,
    customer_contact: form.customer_contact.trim() || null,
    appraisal_date: form.appraisal_date.trim() || null,
    rug_label: form.rug_label.trim() || null,
    rug_size_text: form.rug_size_text.trim() || null,
    condition: form.condition.trim() || null,
    style: form.style.trim() || null,
    origin_country: form.origin_country.trim() || null,
    materials: form.materials.trim() || null,
    palette: form.palette.trim() || null,
    motifs: form.motifs.trim() || null,
    appraised_value:
      typeof value === "number" && Number.isFinite(value) ? value : null,
    currency: form.currency.trim() || null,
    staff_notes: form.staff_notes.trim() || null,
  };
}
