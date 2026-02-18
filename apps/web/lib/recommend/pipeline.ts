import { filterByHardConstraints } from "@/lib/filters/hard-constraints";
import { shapeCandidatesForAI } from "@/lib/filters/candidate-shaping";
import { getSizeBounds } from "@/lib/filters/size-bounds";
import { rankAndExplain } from "@/lib/ai/recommend";
import { logRecommendationQaEvent } from "@/lib/qa/recommendation-log";
import type { HardConstraints, InventoryRug } from "@/lib/types/recommendation";
import type { RecommendationResponse } from "@/lib/ai/recommend";
import type { SupabaseClient } from "@supabase/supabase-js";

const SQL_QUERY_LIMIT = 120;
const AI_CANDIDATE_LIMIT = 30;

type RunRecommendationPipelineInput = {
  requestId?: string;
  tenantId: string | null;
  userMessage: string;
  constraints: HardConstraints;
  promptContext?: {
    role?: "retail_customer" | "trade_client" | "store_staff";
    trade_preferences?: Record<string, unknown>;
    project_context?: {
      project_name?: string | null;
      active_room?: string | null;
      room_count?: number;
      rooms?: Array<{
        room_name: string;
        constraints: HardConstraints;
      }>;
    };
  };
};

type RunRecommendationPipelineResult =
  | { ok: true; response: RecommendationResponse }
  | { ok: false; error: string };

// PSEUDOCODE
// Shared server recommendation pipeline:
// - query candidates from Supabase (SQL-first hard filtering)
// - enforce backend hard constraints again in code
// - shape bounded candidate set
// - call AI for ranking/explanations
// - write QA logs
export async function runRecommendationPipeline(
  input: RunRecommendationPipelineInput
): Promise<RunRecommendationPipelineResult> {
  const requestId = input.requestId ?? crypto.randomUUID();

  const inventory = await fetchInventoryCandidates({
    tenantId: input.tenantId,
    constraints: input.constraints,
    limit: SQL_QUERY_LIMIT,
  });

  if (inventory === null) {
    await logRecommendationQaEvent({
      request_id: requestId,
      tenant_id: input.tenantId,
      user_message: input.userMessage,
      constraints: input.constraints,
      sql_candidate_count: 0,
      filtered_candidate_count: 0,
      ai_candidate_count: 0,
      response_mode: "error",
      recommendation_ids: [],
      notes: null,
      error: "Unable to query inventory source",
      created_at: new Date().toISOString(),
    });

    return { ok: false, error: "Unable to query inventory source" };
  }

  const candidates = filterByHardConstraints(inventory, input.constraints);
  const aiCandidates = shapeCandidatesForAI(candidates, {
    maxCandidates: AI_CANDIDATE_LIMIT,
  });

  const response = await rankAndExplain(
    aiCandidates,
    input.constraints,
    input.userMessage,
    input.promptContext
  );

  await logRecommendationQaEvent({
    request_id: requestId,
    tenant_id: input.tenantId,
    user_message: input.userMessage,
    constraints: input.constraints,
    sql_candidate_count: inventory.length,
    filtered_candidate_count: candidates.length,
    ai_candidate_count: aiCandidates.length,
    response_mode: response.mode,
    recommendation_ids: response.recommendations.map((rec) => rec.rug_id),
    notes: response.notes,
    error: null,
    created_at: new Date().toISOString(),
  });

  return {
    ok: true,
    response,
  };
}

async function fetchInventoryCandidates(input: {
  tenantId: string | null;
  constraints: HardConstraints;
  limit: number;
}): Promise<InventoryRug[] | null> {
  const supabase = await getSupabaseAdminSafe();
  if (!supabase) return null;

  const sizeBounds = getSizeBounds(input.constraints.size);
  const budgetMax = input.constraints.budgetMax;

  const variants = buildQueryVariants({
    hasSize: Boolean(sizeBounds),
    hasBudget: typeof budgetMax === "number",
  });

  const results = await Promise.all(
    variants.map((variant) =>
      runCandidateQuery({
        supabase,
        tenantId: input.tenantId,
        limit: input.limit,
        budgetMax,
        sizeBounds,
        variant,
      })
    )
  );

  if (results.some((rows) => rows === null)) {
    return null;
  }

  const merged = new Map<string, InventoryRug>();
  for (const rows of results) {
    for (const row of rows ?? []) {
      merged.set(row.id, row);
    }
  }

  return [...merged.values()];
}

async function getSupabaseAdminSafe(): Promise<SupabaseClient | null> {
  try {
    const supabaseModule = await import("@/lib/supabase/admin");
    return supabaseModule.supabaseAdmin;
  } catch {
    return null;
  }
}

function buildQueryVariants(input: {
  hasSize: boolean;
  hasBudget: boolean;
}): Array<
  | "none"
  | "size_direct"
  | "size_rotated"
  | "budget_sale"
  | "budget_list"
  | "size_direct_budget_sale"
  | "size_direct_budget_list"
  | "size_rotated_budget_sale"
  | "size_rotated_budget_list"
> {
  if (!input.hasSize && !input.hasBudget) {
    return ["none"];
  }

  if (input.hasSize && !input.hasBudget) {
    return ["size_direct", "size_rotated"];
  }

  if (!input.hasSize && input.hasBudget) {
    return ["budget_sale", "budget_list"];
  }

  return [
    "size_direct_budget_sale",
    "size_direct_budget_list",
    "size_rotated_budget_sale",
    "size_rotated_budget_list",
  ];
}

async function runCandidateQuery(input: {
  supabase: SupabaseClient;
  tenantId: string | null;
  limit: number;
  budgetMax: number | undefined;
  sizeBounds: ReturnType<typeof getSizeBounds>;
  variant:
    | "none"
    | "size_direct"
    | "size_rotated"
    | "budget_sale"
    | "budget_list"
    | "size_direct_budget_sale"
    | "size_direct_budget_list"
    | "size_rotated_budget_sale"
    | "size_rotated_budget_list";
}): Promise<InventoryRug[] | null> {
  let query = input.supabase
    .from("rugs")
    .select(
      "id, sku, intake_label, status, price, sale_price, width_total_in, length_total_in, style, palette, pattern, best_for, public_description"
    )
    .eq("status", "available")
    .limit(input.limit);

  if (input.tenantId) {
    query = query.eq("tenant_id", input.tenantId);
  }

  const bounds = input.sizeBounds;
  const budgetMax = input.budgetMax;
  const wantsSize = input.variant.includes("size_");
  const rotated = input.variant.includes("rotated");
  const wantsBudgetSale = input.variant.includes("budget_sale");
  const wantsBudgetList = input.variant.includes("budget_list");

  if (wantsSize && bounds) {
    const widthMin = rotated ? bounds.minLengthIn : bounds.minWidthIn;
    const widthMax = rotated ? bounds.maxLengthIn : bounds.maxWidthIn;
    const lengthMin = rotated ? bounds.minWidthIn : bounds.minLengthIn;
    const lengthMax = rotated ? bounds.maxWidthIn : bounds.maxLengthIn;

    query = query
      .gte("width_total_in", widthMin)
      .lte("width_total_in", widthMax)
      .gte("length_total_in", lengthMin)
      .lte("length_total_in", lengthMax);
  }

  if ((wantsBudgetSale || wantsBudgetList) && typeof budgetMax === "number") {
    if (wantsBudgetSale) {
      query = query.not("sale_price", "is", null).lte("sale_price", budgetMax);
    }

    if (wantsBudgetList) {
      query = query.is("sale_price", null).lte("price", budgetMax);
    }
  }

  const { data, error } = await query;
  if (error || !Array.isArray(data)) return null;

  return data
    .map((row) => toInventoryFromDbRow(row))
    .filter((row): row is InventoryRug => row !== null);
}

function toInventoryFromDbRow(row: Record<string, unknown>): InventoryRug | null {
  if (typeof row.id !== "string" || typeof row.intake_label !== "string") {
    return null;
  }

  return {
    id: row.id,
    sku: typeof row.sku === "string" ? row.sku : null,
    label: row.intake_label,
    status: typeof row.status === "string" ? row.status : null,
    price_usd: toNumberOrNull(row.price),
    sale_price_usd: toNumberOrNull(row.sale_price),
    width_total_in: toNumberOrNull(row.width_total_in),
    length_total_in: toNumberOrNull(row.length_total_in),
    style: typeof row.style === "string" ? row.style : null,
    palette: typeof row.palette === "string" ? row.palette : null,
    pattern: typeof row.pattern === "string" ? row.pattern : null,
    best_for: typeof row.best_for === "string" ? row.best_for : null,
    public_description:
      typeof row.public_description === "string" ? row.public_description : null,
  };
}

function toNumberOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return null;
}
