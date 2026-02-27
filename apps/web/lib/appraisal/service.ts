import {
  getInventoryRugForAppraisal,
  getPersistedAppraisalById,
  listInventoryRugsForAppraisal,
  listPersistedAppraisalDrafts,
  savePersistedAppraisalDraft,
} from "@/lib/appraisal/repo";
import { generateAppraisalDraft } from "@/lib/ai/appraisal";
import type {
  AppraisalCondition,
  AppraisalDraftListItem,
  AppraisalGenerateRequest,
  AppraisalGenerateResponse,
  AppraisalInput,
  AppraisalQualityMetrics,
  AppraisalRugSearchRow,
  AppraisalSourceType,
  AppraisalStatus,
} from "@/lib/types/appraisal";

const VALID_STATUSES: AppraisalStatus[] = ["draft", "reviewed", "finalized", "void"];
const VALID_CONDITIONS: AppraisalCondition[] = [
  "excellent",
  "very_good",
  "good",
  "fair",
  "distressed",
];

type ValidationError = {
  code: string;
  message: string;
};

type BuildInputResult =
  | {
      ok: true;
      sourceType: AppraisalSourceType;
      sourceSnapshot: Record<string, unknown>;
      normalizedInput: AppraisalInput;
    }
  | { ok: false; error: ValidationError };

function toNullishString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function toNullishNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number.parseFloat(value.trim());
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function toArray(value: unknown): string[] | null {
  if (Array.isArray(value)) {
    const items = value
      .map((item) => (typeof item === "string" ? item.trim() : ""))
      .filter(Boolean);
    return items.length > 0 ? items : null;
  }
  if (typeof value === "string") {
    const items = value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
    return items.length > 0 ? items : null;
  }
  return null;
}

function splitFeetAndInches(totalIn: number | null): {
  ft: number | null;
  in: number | null;
} {
  if (typeof totalIn !== "number" || !Number.isFinite(totalIn) || totalIn < 0) {
    return { ft: null, in: null };
  }
  const rounded = Math.round(totalIn);
  return {
    ft: Math.floor(rounded / 12),
    in: rounded % 12,
  };
}

function sizeTextFromTotals(widthIn: number | null, lengthIn: number | null): string | null {
  if (
    typeof widthIn !== "number" ||
    !Number.isFinite(widthIn) ||
    typeof lengthIn !== "number" ||
    !Number.isFinite(lengthIn)
  ) {
    return null;
  }
  const w = splitFeetAndInches(widthIn);
  const l = splitFeetAndInches(lengthIn);
  if (w.ft === null || w.in === null || l.ft === null || l.in === null) return null;
  return `${w.ft}'${w.in}" x ${l.ft}'${l.in}"`;
}

function toDraftText(response: AppraisalGenerateResponse): string | null {
  if (response.mode !== "appraisal_draft" || !response.draft) return null;
  return [
    `Customer: ${response.draft.header.customer_name ?? "-"}`,
    `Contact: ${response.draft.header.customer_contact ?? "-"}`,
    `Date: ${response.draft.header.appraisal_date ?? "-"}`,
    `Rug: ${response.draft.header.rug_label ?? "-"}`,
    `Size: ${response.draft.header.rug_size_text ?? "-"}`,
    "",
    ...response.draft.description_paragraphs,
    "",
    `${response.draft.value_section.label}: ${
      typeof response.draft.value_section.amount === "number"
        ? `${response.draft.value_section.amount} ${response.draft.value_section.currency ?? ""}`.trim()
        : "-"
    }`,
    response.draft.value_section.statement,
    "",
    ...response.draft.disclaimers,
  ]
    .map((line) => line.trimEnd())
    .join("\n")
    .trim();
}

function computeQualityMetrics(input: AppraisalInput): AppraisalQualityMetrics {
  const required: Array<keyof AppraisalInput> = [
    "rug_type_label",
    "condition",
    "appraised_value",
    "appraisal_date",
  ];
  const recommended: Array<keyof AppraisalInput> = [
    "origin_country",
    "construction",
    "pile_material",
    "dominant_colors",
    "design_motifs",
    "condition_notes",
  ];

  const missingRequired = required.filter((field) => {
    const value = input[field];
    if (typeof value === "number") return !Number.isFinite(value);
    if (Array.isArray(value)) return value.length === 0;
    return value === null || value === undefined || String(value).trim().length === 0;
  });
  const missingRecommended = recommended.filter((field) => {
    const value = input[field];
    if (typeof value === "number") return !Number.isFinite(value);
    if (Array.isArray(value)) return value.length === 0;
    return value === null || value === undefined || String(value).trim().length === 0;
  });

  const requiredCovered = required.length - missingRequired.length;
  const recommendedCovered = recommended.length - missingRecommended.length;
  const weightedRequired = required.length === 0 ? 0 : (requiredCovered / required.length) * 70;
  const weightedRecommended =
    recommended.length === 0 ? 0 : (recommendedCovered / recommended.length) * 30;
  const score = Math.round(weightedRequired + weightedRecommended);

  const evidenceFields = [
    "rug_type_label",
    "condition",
    "condition_notes",
    "origin_country",
    "construction",
    "foundation",
    "pile_material",
    "width_ft",
    "width_in",
    "length_ft",
    "length_in",
    "dominant_colors",
    "design_motifs",
    "appraised_value",
  ].filter((field) => {
    const key = field as keyof AppraisalInput;
    const value = input[key];
    if (typeof value === "number") return Number.isFinite(value);
    if (Array.isArray(value)) return value.length > 0;
    return value !== null && value !== undefined && String(value).trim().length > 0;
  });

  return {
    completeness_score: Math.max(0, Math.min(100, score)),
    missing_required_fields: missingRequired.map(String),
    missing_recommended_fields: missingRecommended.map(String),
    evidence_fields_used: evidenceFields,
  };
}

function validateNormalizedInput(input: AppraisalInput): ValidationError | null {
  if (input.status && !VALID_STATUSES.includes(input.status)) {
    return { code: "BAD_REQUEST", message: "status must be one of draft/reviewed/finalized/void." };
  }
  if (input.condition && !VALID_CONDITIONS.includes(input.condition)) {
    return {
      code: "BAD_REQUEST",
      message:
        "condition must be one of excellent/very_good/good/fair/distressed.",
    };
  }
  if (
    typeof input.appraised_value === "number" &&
    (!Number.isFinite(input.appraised_value) || input.appraised_value < 0)
  ) {
    return { code: "BAD_REQUEST", message: "appraised_value must be a nonnegative number." };
  }
  for (const field of ["width_in", "length_in"] as const) {
    const value = input[field];
    if (
      typeof value === "number" &&
      (!Number.isFinite(value) || value < 0 || value > 11)
    ) {
      return {
        code: "BAD_REQUEST",
        message: `${field} must be between 0 and 11.`,
      };
    }
  }
  return null;
}

function mergeInput(base: AppraisalInput, override: AppraisalInput): AppraisalInput {
  const merged: AppraisalInput = { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (value === undefined) continue;
    (merged as Record<string, unknown>)[key] = value;
  }
  return merged;
}

function normalizeInput(raw: AppraisalInput): AppraisalInput {
  const status = toNullishString(raw.status);
  const condition = toNullishString(raw.condition);
  const customerContact =
    toNullishString(raw.customer_contact) ??
    toNullishString(raw.customer_phone) ??
    toNullishString(raw.customer_email);
  const rugLabel =
    toNullishString(raw.rug_label) ??
    toNullishString(raw.rug_type_label) ??
    toNullishString(raw.external_rug_label);
  return {
    appraisal_id: toNullishString(raw.appraisal_id),
    tenant_id: toNullishString(raw.tenant_id),
    rug_id: toNullishString(raw.rug_id),
    external_rug_label: toNullishString(raw.external_rug_label),
    status: (status as AppraisalStatus | null) ?? "draft",
    customer_name: toNullishString(raw.customer_name),
    customer_phone: toNullishString(raw.customer_phone),
    customer_email: toNullishString(raw.customer_email),
    customer_address_line1: toNullishString(raw.customer_address_line1),
    customer_address_line2: toNullishString(raw.customer_address_line2),
    customer_city: toNullishString(raw.customer_city),
    customer_state: toNullishString(raw.customer_state),
    customer_postal_code: toNullishString(raw.customer_postal_code),
    customer_country: toNullishString(raw.customer_country),
    appraisal_date: toNullishString(raw.appraisal_date),
    appraised_value: toNullishNumber(raw.appraised_value),
    condition: (condition as AppraisalCondition | null) ?? null,
    condition_notes: toNullishString(raw.condition_notes),
    rug_type_label: toNullishString(raw.rug_type_label ?? raw.rug_label),
    origin_country: toNullishString(raw.origin_country),
    region: toNullishString(raw.region),
    age_category: toNullishString(raw.age_category),
    construction: toNullishString(raw.construction),
    foundation: toNullishString(raw.foundation),
    pile_material: toNullishString(raw.pile_material ?? raw.materials),
    width_ft: toNullishNumber(raw.width_ft),
    width_in: toNullishNumber(raw.width_in),
    length_ft: toNullishNumber(raw.length_ft),
    length_in: toNullishNumber(raw.length_in),
    rug_size_text: toNullishString(raw.rug_size_text),
    dominant_colors: toArray(raw.dominant_colors ?? raw.palette),
    design_motifs: toArray(raw.design_motifs ?? raw.motifs),
    custom_fields:
      raw.custom_fields && typeof raw.custom_fields === "object"
        ? (raw.custom_fields as Record<string, unknown>)
        : null,
    customer_contact: customerContact,
    rug_label: rugLabel,
    style: toNullishString(raw.style),
    materials: toNullishString(raw.materials),
    palette: toNullishString(raw.palette),
    motifs: toNullishString(raw.motifs),
    currency: toNullishString(raw.currency ?? "USD"),
    staff_notes: toNullishString(raw.staff_notes),
  };
}

function prefillFromRug(rug: AppraisalRugSearchRow): AppraisalInput {
  const widthSplit = splitFeetAndInches(rug.width_total_in);
  const lengthSplit = splitFeetAndInches(rug.length_total_in);
  return {
    rug_id: rug.id,
    rug_type_label: rug.intake_label,
    rug_label: rug.intake_label,
    condition: (rug.condition as AppraisalCondition | null) ?? null,
    origin_country: rug.origin_country ?? null,
    palette: rug.palette ?? null,
    dominant_colors: rug.palette ? [rug.palette] : null,
    design_motifs: rug.pattern ? [rug.pattern] : null,
    style: rug.style ?? null,
    width_ft: widthSplit.ft,
    width_in: widthSplit.in,
    length_ft: lengthSplit.ft,
    length_in: lengthSplit.in,
    rug_size_text: sizeTextFromTotals(rug.width_total_in, rug.length_total_in),
    appraised_value:
      typeof rug.sale_price === "number"
        ? rug.sale_price
        : typeof rug.price === "number"
          ? rug.price
          : null,
  };
}

export async function buildGenerateInput(
  request: AppraisalGenerateRequest,
  tenantId: string
): Promise<BuildInputResult> {
  const sourceType: AppraisalSourceType =
    request.source_type === "inventory_linked" || request.source_type === "customer_owned"
      ? request.source_type
      : "customer_owned";
  const context = normalizeInput(request.appraisal_context ?? {});

  if (sourceType === "inventory_linked") {
    const rugId = toNullishString(request.rug_id ?? context.rug_id);
    if (!rugId) {
      return {
        ok: false,
        error: {
          code: "BAD_REQUEST",
          message: "rug_id is required for inventory_linked appraisal generation.",
        },
      };
    }

    const rug = await getInventoryRugForAppraisal({ tenantId, rugId });
    if (!rug) {
      return {
        ok: false,
        error: {
          code: "BAD_REQUEST",
          message: "Inventory rug was not found for this tenant.",
        },
      };
    }

    const merged = mergeInput(prefillFromRug(rug), {
      ...context,
      rug_id: rug.id,
      external_rug_label: context.external_rug_label ?? rug.intake_label,
    });
    const validationError = validateNormalizedInput(merged);
    if (validationError) {
      return { ok: false, error: validationError };
    }
    return {
      ok: true,
      sourceType,
      sourceSnapshot: {
        rug_id: rug.id,
        intake_label: rug.intake_label,
        style: rug.style,
        palette: rug.palette,
        pattern: rug.pattern,
        origin_country: rug.origin_country,
        condition: rug.condition,
        width_total_in: rug.width_total_in,
        length_total_in: rug.length_total_in,
      },
      normalizedInput: merged,
    };
  }

  const customerOwned = {
    ...context,
    rug_id: null,
  };
  const validationError = validateNormalizedInput(customerOwned);
  if (validationError) {
    return { ok: false, error: validationError };
  }
  return {
    ok: true,
    sourceType,
    sourceSnapshot: {
      mode: "customer_owned",
    },
    normalizedInput: customerOwned,
  };
}

export async function runAppraisalGeneration(input: {
  request: AppraisalGenerateRequest;
  tenantId: string;
  model: string;
}): Promise<
  | { ok: false; error: ValidationError }
  | {
      ok: true;
      response: AppraisalGenerateResponse;
    }
> {
  const built = await buildGenerateInput(input.request, input.tenantId);
  if (!built.ok) return built;

  const existingId = toNullishString(input.request.appraisal_id);
  if (existingId) {
    const existing = await getPersistedAppraisalById({
      tenantId: input.tenantId,
      appraisalId: existingId,
    });
    if (!existing) {
      return {
        ok: false,
        error: {
          code: "FORBIDDEN",
          message: "appraisal_id is not accessible for this tenant.",
        },
      };
    }
    if (existing.status === "finalized") {
      return {
        ok: false,
        error: {
          code: "FORBIDDEN",
          message: "Finalized appraisals cannot be regenerated.",
        },
      };
    }
  }

  const generated = await generateAppraisalDraft(built.normalizedInput);
  const quality = computeQualityMetrics(built.normalizedInput);
  const persist =
    typeof input.request.persist === "boolean" ? input.request.persist : true;

  const response: AppraisalGenerateResponse = {
    ...generated,
    appraisal_id: null,
    persisted: false,
    source_type: built.sourceType,
    quality,
  };

  if (!persist) return { ok: true, response };

  const persisted = await savePersistedAppraisalDraft({
    tenantId: input.tenantId,
    appraisalId: existingId ?? null,
    sourceType: built.sourceType,
    status: (built.normalizedInput.status as AppraisalStatus) ?? "draft",
    rugId: built.normalizedInput.rug_id ?? null,
    appraisalContext: built.normalizedInput,
    draftText: toDraftText(response),
    qualityMetrics: quality,
    aiStructuredOutput: generated as unknown as Record<string, unknown>,
    sourceSnapshot: built.sourceSnapshot,
    model: input.model,
  });
  if (persisted.error) {
    return {
      ok: false,
      error: persisted.error,
    };
  }

  response.appraisal_id = persisted.id;
  response.persisted = persisted.persisted;
  return { ok: true, response };
}

export async function saveManualAppraisalDraft(input: {
  tenantId: string;
  sourceType: AppraisalSourceType;
  appraisalId?: string | null;
  rugId?: string | null;
  status: AppraisalStatus;
  appraisalContext: AppraisalInput;
  draftPayload: Record<string, unknown>;
  draftText?: string | null;
  finalText?: string | null;
  model?: string | null;
}): Promise<
  | { ok: true; id: string | null; persisted: boolean; quality: AppraisalQualityMetrics }
  | { ok: false; error: ValidationError }
> {
  const existingId = toNullishString(input.appraisalId);
  if (existingId) {
    const existing = await getPersistedAppraisalById({
      tenantId: input.tenantId,
      appraisalId: existingId,
    });
    if (!existing) {
      return {
        ok: false,
        error: {
          code: "FORBIDDEN",
          message: "appraisal_id is not accessible for this tenant.",
        },
      };
    }
    if (existing.status === "finalized") {
      return {
        ok: false,
        error: {
          code: "FORBIDDEN",
          message: "Finalized appraisals cannot be modified.",
        },
      };
    }
  }

  const normalized = normalizeInput({
    ...input.appraisalContext,
    status: input.status,
    rug_id: input.sourceType === "inventory_linked" ? input.rugId ?? null : null,
  });
  const validationError = validateNormalizedInput(normalized);
  if (validationError) {
    return { ok: false, error: validationError };
  }
  const quality = computeQualityMetrics(normalized);
  const saved = await savePersistedAppraisalDraft({
    tenantId: input.tenantId,
    appraisalId: existingId,
    sourceType: input.sourceType,
    status: input.status,
    rugId: input.sourceType === "inventory_linked" ? input.rugId ?? null : null,
    appraisalContext: normalized,
    draftText: input.draftText ?? null,
    finalText: input.finalText ?? null,
    qualityMetrics: quality,
    aiStructuredOutput: input.draftPayload,
    sourceSnapshot: {
      mode: input.sourceType,
      rug_id: input.rugId ?? null,
    },
    model: input.model ?? process.env.OPENAI_MODEL ?? "gpt-4.1-nano",
  });
  if (saved.error) {
    return {
      ok: false,
      error: saved.error,
    };
  }

  return { ok: true, id: saved.id, persisted: saved.persisted, quality };
}

export async function fetchInventoryLinkedRugs(input: {
  tenantId: string;
  q?: string | null;
  status?: string | null;
  limit?: number;
}): Promise<AppraisalRugSearchRow[]> {
  return listInventoryRugsForAppraisal(input);
}

export async function fetchAppraisalDrafts(input: {
  tenantId: string;
  status?: AppraisalStatus | null;
  limit?: number;
}): Promise<AppraisalDraftListItem[]> {
  return listPersistedAppraisalDrafts(input);
}
