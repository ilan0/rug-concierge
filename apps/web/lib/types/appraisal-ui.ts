import type {
  AppraisalDraftListItem,
  AppraisalGenerateResponse,
  AppraisalInput,
  AppraisalRugSearchRow,
  AppraisalSourceType,
  AppraisalStatus,
} from "@/lib/types/appraisal";

export type AppraisalFormState = {
  source_type: AppraisalSourceType;
  status: AppraisalStatus;
  appraisal_id: string;
  rug_id: string;
  external_rug_label: string;
  customer_name: string;
  customer_phone: string;
  customer_email: string;
  customer_address_line1: string;
  customer_address_line2: string;
  customer_city: string;
  customer_state: string;
  customer_postal_code: string;
  customer_country: string;
  appraisal_date: string;
  appraised_value: string;
  condition: string;
  condition_notes: string;
  rug_type_label: string;
  origin_country: string;
  region: string;
  age_category: string;
  construction: string;
  foundation: string;
  pile_material: string;
  width_ft: string;
  width_in: string;
  length_ft: string;
  length_in: string;
  rug_size_text: string;
  dominant_colors: string;
  design_motifs: string;
  style: string;
  palette: string;
  staff_notes: string;
};

export type AppraisalUiResult = AppraisalGenerateResponse;

export type AppraisalDraftSaveResult = {
  appraisal_id: string | null;
  persisted: boolean;
  quality: AppraisalGenerateResponse["quality"];
};

export type AppraisalRugLookupResult = {
  rows: AppraisalRugSearchRow[];
  total: number;
};

export type AppraisalDraftListResult = {
  rows: AppraisalDraftListItem[];
  total: number;
};

function toNullableNumber(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number.parseFloat(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function toNullableString(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toList(value: string): string[] | null {
  const values = value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return values.length > 0 ? values : null;
}

export function toAppraisalInput(form: AppraisalFormState): AppraisalInput {
  return {
    appraisal_id: toNullableString(form.appraisal_id),
    rug_id: form.source_type === "inventory_linked" ? toNullableString(form.rug_id) : null,
    external_rug_label: toNullableString(form.external_rug_label),
    status: form.status,
    customer_name: toNullableString(form.customer_name),
    customer_phone: toNullableString(form.customer_phone),
    customer_email: toNullableString(form.customer_email),
    customer_address_line1: toNullableString(form.customer_address_line1),
    customer_address_line2: toNullableString(form.customer_address_line2),
    customer_city: toNullableString(form.customer_city),
    customer_state: toNullableString(form.customer_state),
    customer_postal_code: toNullableString(form.customer_postal_code),
    customer_country: toNullableString(form.customer_country),
    appraisal_date: toNullableString(form.appraisal_date),
    appraised_value: toNullableNumber(form.appraised_value),
    condition: toNullableString(form.condition) as AppraisalInput["condition"],
    condition_notes: toNullableString(form.condition_notes),
    rug_type_label: toNullableString(form.rug_type_label),
    origin_country: toNullableString(form.origin_country),
    region: toNullableString(form.region),
    age_category: toNullableString(form.age_category),
    construction: toNullableString(form.construction),
    foundation: toNullableString(form.foundation),
    pile_material: toNullableString(form.pile_material),
    width_ft: toNullableNumber(form.width_ft),
    width_in: toNullableNumber(form.width_in),
    length_ft: toNullableNumber(form.length_ft),
    length_in: toNullableNumber(form.length_in),
    rug_size_text: toNullableString(form.rug_size_text),
    dominant_colors: toList(form.dominant_colors),
    design_motifs: toList(form.design_motifs),
    // legacy aliases, kept for prompt continuity
    rug_label: toNullableString(form.rug_type_label),
    style: toNullableString(form.style),
    palette: toNullableString(form.palette),
    staff_notes: toNullableString(form.staff_notes),
    materials: toNullableString(form.pile_material),
    motifs: toNullableString(form.design_motifs),
    currency: "USD",
  };
}

function toNumberString(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? String(value) : "";
}

export function applyRugToForm(
  form: AppraisalFormState,
  rug: AppraisalRugSearchRow
): AppraisalFormState {
  const widthFt =
    typeof rug.width_total_in === "number" ? Math.floor(Math.round(rug.width_total_in) / 12) : null;
  const widthIn =
    typeof rug.width_total_in === "number" ? Math.round(rug.width_total_in) % 12 : null;
  const lengthFt =
    typeof rug.length_total_in === "number"
      ? Math.floor(Math.round(rug.length_total_in) / 12)
      : null;
  const lengthIn =
    typeof rug.length_total_in === "number" ? Math.round(rug.length_total_in) % 12 : null;

  return {
    ...form,
    source_type: "inventory_linked",
    rug_id: rug.id,
    external_rug_label: rug.intake_label,
    rug_type_label: rug.intake_label,
    condition: rug.condition ?? form.condition,
    origin_country: rug.origin_country ?? form.origin_country,
    palette: rug.palette ?? form.palette,
    dominant_colors: rug.palette ?? form.dominant_colors,
    design_motifs: rug.pattern ?? form.design_motifs,
    style: rug.style ?? form.style,
    width_ft: toNumberString(widthFt),
    width_in: toNumberString(widthIn),
    length_ft: toNumberString(lengthFt),
    length_in: toNumberString(lengthIn),
    rug_size_text:
      typeof rug.width_total_in === "number" && typeof rug.length_total_in === "number"
        ? `${widthFt}'${widthIn}" x ${lengthFt}'${lengthIn}"`
        : form.rug_size_text,
    appraised_value: toNumberString(
      typeof rug.sale_price === "number" ? rug.sale_price : rug.price
    ),
  };
}

export function applyDraftToForm(
  form: AppraisalFormState,
  draft: AppraisalDraftListItem
): AppraisalFormState {
  const custom = draft.custom_fields ?? {};
  const sourceType =
    custom &&
    typeof custom === "object" &&
    custom.source_type === "inventory_linked"
      ? "inventory_linked"
      : "customer_owned";
  return {
    ...form,
    source_type: sourceType,
    appraisal_id: draft.id,
    rug_id: draft.rug_id ?? "",
    external_rug_label: draft.external_rug_label ?? "",
    customer_name: draft.customer_name ?? "",
    appraisal_date: draft.appraisal_date ?? "",
    appraised_value:
      typeof draft.appraised_value === "number" ? String(draft.appraised_value) : "",
    condition: draft.condition ?? "",
    rug_type_label: draft.rug_type_label ?? "",
    origin_country: draft.origin_country ?? "",
    status: draft.status,
  };
}

