import { supabaseAdmin } from "@/lib/supabase/admin";
import type {
  AppraisalDraftListItem,
  AppraisalInput,
  AppraisalRugSearchRow,
  AppraisalStatus,
} from "@/lib/types/appraisal";

type ListRugInput = {
  tenantId: string;
  q?: string | null;
  status?: string | null;
  limit?: number;
};

type ListDraftInput = {
  tenantId: string;
  status?: AppraisalStatus | null;
  limit?: number;
};

type SaveDraftInput = {
  tenantId: string;
  appraisalId?: string | null;
  sourceType: "inventory_linked" | "customer_owned";
  status: AppraisalStatus;
  rugId: string | null;
  appraisalContext: AppraisalInput;
  draftText: string | null;
  finalText?: string | null;
  qualityMetrics: Record<string, unknown>;
  aiStructuredOutput: Record<string, unknown>;
  sourceSnapshot: Record<string, unknown>;
  model: string;
};

export type SavePersistedAppraisalDraftResult =
  | { id: string | null; persisted: true; error: null }
  | {
      id: null;
      persisted: false;
      error: {
        code: "FORBIDDEN" | "INTERNAL_ERROR";
        message: string;
      };
    };

type AppraisalRow = {
  id: string;
  tenant_id: string;
  rug_id: string | null;
  external_rug_label: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  customer_email: string | null;
  customer_address_line1: string | null;
  customer_address_line2: string | null;
  customer_city: string | null;
  customer_state: string | null;
  customer_postal_code: string | null;
  customer_country: string | null;
  appraisal_date: string | null;
  appraised_value: number | null;
  condition: string | null;
  condition_notes: string | null;
  rug_type_label: string | null;
  origin_country: string | null;
  region: string | null;
  age_category: string | null;
  construction: string | null;
  foundation: string | null;
  pile_material: string | null;
  width_ft: number | null;
  width_in: number | null;
  length_ft: number | null;
  length_in: number | null;
  dominant_colors: string[] | null;
  design_motifs: string[] | null;
  draft_text: string | null;
  final_text: string | null;
  status: AppraisalStatus;
  created_at: string;
  updated_at: string;
  custom_fields: Record<string, unknown> | null;
};

function toNumberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function toStringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function toStringArrayOrNull(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const out = value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean);
  return out.length > 0 ? out : null;
}

function toObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export async function listInventoryRugsForAppraisal(
  input: ListRugInput
): Promise<AppraisalRugSearchRow[]> {
  const limit = Math.min(Math.max(input.limit ?? 25, 1), 100);
  const status = input.status?.trim() || "available";
  const q = input.q?.trim() ?? "";

  let query = supabaseAdmin
    .from("rugs")
    .select(
      "id, sku, intake_label, status, price, sale_price, width_total_in, length_total_in, style, origin_country, palette, pattern, condition"
    )
    .eq("tenant_id", input.tenantId)
    .eq("status", status)
    .limit(limit)
    .order("id", { ascending: false });

  if (q) {
    const token = q.replace(/[%_]/g, "");
    query = query.or(
      [
        `sku.ilike.%${token}%`,
        `intake_label.ilike.%${token}%`,
        `style.ilike.%${token}%`,
        `palette.ilike.%${token}%`,
        `pattern.ilike.%${token}%`,
      ].join(",")
    );
  }

  const { data, error } = await query;
  if (error || !Array.isArray(data)) return [];

  return data
    .map((row) => {
      if (typeof row.id !== "string" || typeof row.intake_label !== "string") return null;
      return {
        id: row.id,
        sku: toStringOrNull(row.sku),
        intake_label: row.intake_label,
        status: toStringOrNull(row.status),
        price: toNumberOrNull(row.price),
        sale_price: toNumberOrNull(row.sale_price),
        width_total_in: toNumberOrNull(row.width_total_in),
        length_total_in: toNumberOrNull(row.length_total_in),
        style: toStringOrNull(row.style),
        origin_country: toStringOrNull(row.origin_country),
        palette: toStringOrNull(row.palette),
        pattern: toStringOrNull(row.pattern),
        condition: toStringOrNull(row.condition),
      } as AppraisalRugSearchRow;
    })
    .filter((row): row is AppraisalRugSearchRow => row !== null);
}

export async function getInventoryRugForAppraisal(input: {
  tenantId: string;
  rugId: string;
}): Promise<AppraisalRugSearchRow | null> {
  const { data, error } = await supabaseAdmin
    .from("rugs")
    .select(
      "id, sku, intake_label, status, price, sale_price, width_total_in, length_total_in, style, origin_country, palette, pattern, condition"
    )
    .eq("tenant_id", input.tenantId)
    .eq("id", input.rugId)
    .maybeSingle();

  if (error || !data) return null;
  if (typeof data.id !== "string" || typeof data.intake_label !== "string") return null;

  return {
    id: data.id,
    sku: toStringOrNull(data.sku),
    intake_label: data.intake_label,
    status: toStringOrNull(data.status),
    price: toNumberOrNull(data.price),
    sale_price: toNumberOrNull(data.sale_price),
    width_total_in: toNumberOrNull(data.width_total_in),
    length_total_in: toNumberOrNull(data.length_total_in),
    style: toStringOrNull(data.style),
    origin_country: toStringOrNull(data.origin_country),
    palette: toStringOrNull(data.palette),
    pattern: toStringOrNull(data.pattern),
    condition: toStringOrNull(data.condition),
  };
}

export async function listPersistedAppraisalDrafts(
  input: ListDraftInput
): Promise<AppraisalDraftListItem[]> {
  const limit = Math.min(Math.max(input.limit ?? 25, 1), 100);
  let query = supabaseAdmin
    .from("appraisals")
    .select(
      "id, tenant_id, rug_id, external_rug_label, customer_name, appraisal_date, appraised_value, condition, rug_type_label, origin_country, status, draft_text, final_text, created_at, updated_at, custom_fields"
    )
    .eq("tenant_id", input.tenantId)
    .order("updated_at", { ascending: false })
    .limit(limit);

  if (input.status) {
    query = query.eq("status", input.status);
  }

  const { data, error } = await query;
  if (error || !Array.isArray(data)) return [];

  return data
    .map((row) => {
      if (
        typeof row.id !== "string" ||
        typeof row.tenant_id !== "string" ||
        typeof row.status !== "string"
      ) {
        return null;
      }
      return {
        id: row.id,
        tenant_id: row.tenant_id,
        rug_id: toStringOrNull(row.rug_id),
        external_rug_label: toStringOrNull(row.external_rug_label),
        customer_name: toStringOrNull(row.customer_name),
        appraisal_date: toStringOrNull(row.appraisal_date),
        appraised_value: toNumberOrNull(row.appraised_value),
        condition: toStringOrNull(row.condition),
        rug_type_label: toStringOrNull(row.rug_type_label),
        origin_country: toStringOrNull(row.origin_country),
        status: row.status as AppraisalStatus,
        draft_text: toStringOrNull(row.draft_text),
        final_text: toStringOrNull(row.final_text),
        created_at:
          typeof row.created_at === "string"
            ? row.created_at
            : new Date().toISOString(),
        updated_at:
          typeof row.updated_at === "string"
            ? row.updated_at
            : new Date().toISOString(),
        custom_fields: toObject(row.custom_fields),
      } as AppraisalDraftListItem;
    })
    .filter((row): row is AppraisalDraftListItem => row !== null);
}

export async function getPersistedAppraisalById(input: {
  tenantId: string;
  appraisalId: string;
}): Promise<AppraisalRow | null> {
  const { data, error } = await supabaseAdmin
    .from("appraisals")
    .select("*")
    .eq("tenant_id", input.tenantId)
    .eq("id", input.appraisalId)
    .maybeSingle();

  if (error || !data) return null;
  if (
    typeof data.id !== "string" ||
    typeof data.tenant_id !== "string" ||
    typeof data.status !== "string"
  ) {
    return null;
  }

  return {
    ...data,
    custom_fields: toObject(data.custom_fields),
    dominant_colors: toStringArrayOrNull(data.dominant_colors),
    design_motifs: toStringArrayOrNull(data.design_motifs),
  } as AppraisalRow;
}

function splitList(value: string | null | undefined): string[] | null {
  if (!value) return null;
  const items = value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  return items.length > 0 ? items : null;
}

export async function savePersistedAppraisalDraft(
  input: SaveDraftInput
): Promise<SavePersistedAppraisalDraftResult> {
  const context = input.appraisalContext;
  const nowIso = new Date().toISOString();
  const customFields = {
    ...(context.custom_fields && typeof context.custom_fields === "object"
      ? context.custom_fields
      : {}),
    ai_structured_output: input.aiStructuredOutput,
    quality_metrics: input.qualityMetrics,
    source_type: input.sourceType,
    source_snapshot: input.sourceSnapshot,
    generated_at: nowIso,
    model: input.model,
  };

  const payload = {
    tenant_id: input.tenantId,
    rug_id: input.rugId,
    external_rug_label:
      context.external_rug_label ?? context.rug_label ?? context.rug_type_label ?? null,
    customer_name: context.customer_name ?? null,
    customer_phone: context.customer_phone ?? null,
    customer_email: context.customer_email ?? null,
    customer_address_line1: context.customer_address_line1 ?? null,
    customer_address_line2: context.customer_address_line2 ?? null,
    customer_city: context.customer_city ?? null,
    customer_state: context.customer_state ?? null,
    customer_postal_code: context.customer_postal_code ?? null,
    customer_country: context.customer_country ?? null,
    appraisal_date: context.appraisal_date ?? new Date().toISOString().slice(0, 10),
    appraised_value:
      typeof context.appraised_value === "number" ? context.appraised_value : null,
    condition: context.condition ?? null,
    condition_notes:
      context.condition_notes ?? context.staff_notes ?? null,
    rug_type_label: context.rug_type_label ?? context.rug_label ?? null,
    origin_country: context.origin_country ?? null,
    region: context.region ?? null,
    age_category: context.age_category ?? null,
    construction: context.construction ?? null,
    foundation: context.foundation ?? null,
    pile_material: context.pile_material ?? context.materials ?? null,
    width_ft: typeof context.width_ft === "number" ? context.width_ft : null,
    width_in: typeof context.width_in === "number" ? context.width_in : null,
    length_ft: typeof context.length_ft === "number" ? context.length_ft : null,
    length_in: typeof context.length_in === "number" ? context.length_in : null,
    dominant_colors:
      context.dominant_colors ?? splitList(context.palette ?? null),
    design_motifs:
      context.design_motifs ?? splitList(context.motifs ?? null),
    draft_text: input.draftText,
    final_text: input.finalText ?? null,
    status: input.status,
    custom_fields: customFields,
  };

  if (input.appraisalId) {
    const existing = await getPersistedAppraisalById({
      tenantId: input.tenantId,
      appraisalId: input.appraisalId,
    });
    if (!existing) {
      return {
        id: null,
        persisted: false,
        error: {
          code: "FORBIDDEN",
          message: "appraisal_id is not accessible for this tenant.",
        },
      };
    }
    if (existing.status === "finalized") {
      return {
        id: null,
        persisted: false,
        error: {
          code: "FORBIDDEN",
          message: "Finalized appraisals cannot be modified.",
        },
      };
    }

    const { data, error } = await supabaseAdmin
      .from("appraisals")
      .update(payload)
      .eq("tenant_id", input.tenantId)
      .eq("id", input.appraisalId)
      .select("id")
      .maybeSingle();

    if (error || !data || typeof data.id !== "string") {
      return {
        id: null,
        persisted: false,
        error: {
          code: "INTERNAL_ERROR",
          message: "Failed to update appraisal draft.",
        },
      };
    }

    return { id: data.id, persisted: true, error: null };
  }

  const { data, error } = await supabaseAdmin
    .from("appraisals")
    .insert(payload)
    .select("id")
    .maybeSingle();

  if (error || !data || typeof data.id !== "string") {
    return {
      id: null,
      persisted: false,
      error: {
        code: "INTERNAL_ERROR",
        message: "Failed to insert appraisal draft.",
      },
    };
  }

  return { id: data.id, persisted: true, error: null };
}
