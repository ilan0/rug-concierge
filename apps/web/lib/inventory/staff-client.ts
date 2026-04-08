import { mapApiErrorToFriendlyMessage } from "@/lib/ui/error-messages";
import {
  aiStructuredFieldsSchema,
  staffOverridesSchema,
} from "@/lib/inventory/schemas";
import { normalizeColorList } from "@/lib/config/color-taxonomy";
import {
  isEnrichmentStatus,
  isReviewReasonCode,
} from "@/lib/inventory/enrichment-state";
import type {
  InventoryRugStatus,
  StaffInventoryRugDetail,
  StaffOverrides,
} from "@/lib/types/inventory";

export type StaffRugPatchInput = {
  stock_id?: string | null;
  status?: InventoryRugStatus;
  staff_overrides?: StaffOverrides;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function toInventoryRugStatusOrNull(value: unknown): InventoryRugStatus | null {
  return value === "available" || value === "not_available" ? value : null;
}

function toAiStructuredFields(value: unknown) {
  if (!isRecord(value)) return null;
  const normalized = { ...value };
  if (Array.isArray(normalized.primary_colors)) {
    normalized.primary_colors = normalizeColorList(normalized.primary_colors, 8);
  }
  const parsed = aiStructuredFieldsSchema.safeParse(normalized);
  return parsed.success ? parsed.data : null;
}

function toStaffOverrides(value: unknown) {
  if (!isRecord(value)) return null;
  const normalized = { ...value };
  if (Array.isArray(normalized.primary_colors)) {
    normalized.primary_colors = normalizeColorList(normalized.primary_colors, 8);
  }
  const parsed = staffOverridesSchema.safeParse(normalized);
  return parsed.success ? parsed.data : null;
}

function toEffectiveFields(
  value: unknown
): StaffInventoryRugDetail["effective_fields"] | null {
  if (!isRecord(value)) return null;
  if (typeof value.label !== "string" || value.label.trim().length === 0) return null;

  return {
    label: value.label,
    origin: typeof value.origin === "string" ? value.origin : null,
    style: typeof value.style === "string" ? value.style : null,
    pattern: Array.isArray(value.pattern)
      ? value.pattern.filter((item): item is string => typeof item === "string")
      : null,
    primary_colors: Array.isArray(value.primary_colors)
      ? normalizeColorList(
          value.primary_colors.filter((item): item is string => typeof item === "string"),
          8
        )
      : null,
    age_category:
      typeof value.age_category === "string" ? value.age_category : null,
    mood: typeof value.mood === "string" ? value.mood : null,
  };
}

function parseStaffRugDetail(payload: unknown): StaffInventoryRugDetail {
  if (!isRecord(payload)) {
    throw new Error("Invalid staff rug response payload.");
  }

  const effectiveFields = toEffectiveFields(payload.effective_fields);
  if (!effectiveFields) {
    throw new Error("Missing effective_fields in response payload.");
  }

  if (
    typeof payload.id !== "string" ||
    typeof payload.tenant_id !== "string" ||
    payload.id.trim().length === 0 ||
    payload.tenant_id.trim().length === 0
  ) {
    throw new Error("Invalid staff rug response payload.");
  }

  return {
    id: payload.id,
    tenant_id: payload.tenant_id,
    intake_label: typeof payload.intake_label === "string" ? payload.intake_label : null,
    ai_description:
      typeof payload.ai_description === "string" ? payload.ai_description : null,
    ai_structured_fields: toAiStructuredFields(payload.ai_structured_fields),
    staff_overrides: toStaffOverrides(payload.staff_overrides),
    effective_fields: effectiveFields,
    stock_id: typeof payload.stock_id === "string" ? payload.stock_id : null,
    status: toInventoryRugStatusOrNull(payload.status),
    enrichment_status: isEnrichmentStatus(payload.enrichment_status)
      ? payload.enrichment_status
      : null,
    review_reason_code: isReviewReasonCode(payload.review_reason_code)
      ? payload.review_reason_code
      : null,
    width_total_in:
      typeof payload.width_total_in === "number" && Number.isFinite(payload.width_total_in)
        ? payload.width_total_in
        : null,
    length_total_in:
      typeof payload.length_total_in === "number" &&
      Number.isFinite(payload.length_total_in)
        ? payload.length_total_in
        : null,
    created_at: typeof payload.created_at === "string" ? payload.created_at : null,
    primary_image_url:
      typeof payload.primary_image_url === "string" ? payload.primary_image_url : null,
    primary_image_caption:
      typeof payload.primary_image_caption === "string"
        ? payload.primary_image_caption
        : null,
  };
}

async function parseErrorOrThrow(response: Response): Promise<never> {
  const payload = (await response.json().catch(() => null)) as
    | { error?: unknown; code?: unknown }
    | null;

  const message = mapApiErrorToFriendlyMessage({
    status: response.status,
    code: payload && typeof payload.code === "string" ? payload.code : null,
    rawMessage:
      payload && typeof payload.error === "string" ? payload.error : null,
    context: "generic",
    fallbackMessage: "Unable to load rug details right now.",
  });
  throw new Error(message);
}

export async function fetchStaffRugDetail(id: string): Promise<StaffInventoryRugDetail> {
  const response = await fetch(`/api/inventory/rugs/${encodeURIComponent(id)}`);
  if (!response.ok) {
    await parseErrorOrThrow(response);
  }
  const payload = (await response.json().catch(() => null)) as unknown;
  return parseStaffRugDetail(payload);
}

export async function patchStaffRugDetail(
  id: string,
  input: StaffRugPatchInput
): Promise<StaffInventoryRugDetail> {
  const response = await fetch(`/api/inventory/rugs/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    await parseErrorOrThrow(response);
  }
  const payload = (await response.json().catch(() => null)) as unknown;
  return parseStaffRugDetail(payload);
}

export async function reEnrichStaffRug(
  id: string
): Promise<StaffInventoryRugDetail> {
  const response = await fetch(
    `/api/inventory/rugs/${encodeURIComponent(id)}/re-enrich`,
    {
      method: "POST",
    }
  );
  if (!response.ok) {
    await parseErrorOrThrow(response);
  }
  const payload = (await response.json().catch(() => null)) as unknown;
  return parseStaffRugDetail(payload);
}

export async function deleteStaffRug(id: string): Promise<void> {
  const response = await fetch(`/api/inventory/rugs/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  if (!response.ok) {
    await parseErrorOrThrow(response);
  }
}
