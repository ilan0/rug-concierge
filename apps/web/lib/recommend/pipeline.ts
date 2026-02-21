import { filterByHardConstraints } from "@/lib/filters/hard-constraints";
import { shapeCandidatesForAI } from "@/lib/filters/candidate-shaping";
import { getSizeBounds } from "@/lib/filters/size-bounds";
import { rankAndExplain } from "@/lib/ai/recommend";
import type { RecommendationAiTrace } from "@/lib/ai/recommend";
import { logRecommendationQaEvent } from "@/lib/qa/recommendation-log";
import type { E2eTraceMeta } from "@/lib/qa/e2e-trace";
import { writeE2eTraceArtifact } from "@/lib/qa/e2e-trace";
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
  traceMeta?: E2eTraceMeta & {
    source_route: "/api/recommend" | "/api/chat";
    session_id?: string | null;
    role?: "retail_customer" | "trade_client" | "store_staff" | null;
  };
};

type RunRecommendationPipelineResult =
  | { ok: true; response: RecommendationResponse; trace_id?: string | null }
  | { ok: false; error: string };

type PipelineQueryTrace = {
  variant: string;
  filters: Record<string, unknown>;
  row_count: number;
  error: string | null;
};

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
  const startedAt = Date.now();
  const flowPath: string[] = [
    "runRecommendationPipeline",
    "fetchInventoryCandidates",
    "filterByHardConstraints",
    "shapeCandidatesForAI",
    "rankAndExplain",
    "logRecommendationQaEvent",
  ];
  const queryTrace: PipelineQueryTrace[] = [];
  const timings: Record<string, number> = {};
  const aiTrace: RecommendationAiTrace = {
    called: false,
    model: process.env.OPENAI_MODEL ?? "gpt-4.1-nano",
    request_payload: null,
    response_status: null,
    response_payload: null,
    parsed_response: null,
    fallback_reason: null,
    error: null,
  };

  const writeTrace = async (payload: unknown) => {
    if (!input.traceMeta) return null;
    return writeE2eTraceArtifact({
      meta: {
        run_id: input.traceMeta.run_id,
        case_id: input.traceMeta.case_id,
      },
      channel: "recommendation-pipeline",
      trace_id: requestId,
      payload,
    });
  };

  try {
    const sqlStart = Date.now();
    const inventory = await fetchInventoryCandidates({
      tenantId: input.tenantId,
      constraints: input.constraints,
      limit: SQL_QUERY_LIMIT,
      queryTrace,
    });
    timings.fetch_inventory_candidates_ms = Date.now() - sqlStart;

    if (inventory === null) {
      const errorMessage = "Unable to query inventory source";
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
        notes: "PIPELINE_DB_QUERY_FAILED",
        error: errorMessage,
        created_at: new Date().toISOString(),
      });

      await writeTrace({
        request_id: requestId,
        flow_path: flowPath,
        source_route: input.traceMeta?.source_route ?? null,
        session_id: input.traceMeta?.session_id ?? null,
        role: input.traceMeta?.role ?? null,
        tenant_id: input.tenantId,
        user_message: input.userMessage,
        constraints: input.constraints,
        prompt_context: input.promptContext ?? null,
        query_trace: queryTrace,
        timing_ms: {
          ...timings,
          total_ms: Date.now() - startedAt,
        },
        ai_trace: aiTrace,
        result: null,
        error: errorMessage,
      });

      return { ok: false, error: errorMessage };
    }

    const hardFilterStart = Date.now();
    const candidates = filterByHardConstraints(inventory, input.constraints);
    timings.filter_hard_constraints_ms = Date.now() - hardFilterStart;
    const shapeStart = Date.now();
    const aiCandidates = shapeCandidatesForAI(candidates, {
      maxCandidates: AI_CANDIDATE_LIMIT,
    });
    timings.shape_candidates_ms = Date.now() - shapeStart;

    const aiStart = Date.now();
    const response = await rankAndExplain(
      aiCandidates,
      input.constraints,
      input.userMessage,
      input.promptContext,
      aiTrace
    );
    timings.rank_and_explain_ms = Date.now() - aiStart;

    const logStart = Date.now();
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
    timings.qa_log_ms = Date.now() - logStart;

    const tracePath = await writeTrace({
      request_id: requestId,
      flow_path: flowPath,
      source_route: input.traceMeta?.source_route ?? null,
      session_id: input.traceMeta?.session_id ?? null,
      role: input.traceMeta?.role ?? null,
      tenant_id: input.tenantId,
      user_message: input.userMessage,
      constraints: input.constraints,
      prompt_context: input.promptContext ?? null,
      query_trace: queryTrace,
      candidate_counts: {
        sql_candidates: inventory.length,
        hard_filtered_candidates: candidates.length,
        ai_candidates: aiCandidates.length,
      },
      timing_ms: {
        ...timings,
        total_ms: Date.now() - startedAt,
      },
      ai_trace: aiTrace,
      result: {
        mode: response.mode,
        notes: response.notes,
        recommendation_ids: response.recommendations.map((rec) => rec.rug_id),
        recommendation_count: response.recommendations.length,
      },
      error: null,
    });

    return {
      ok: true,
      response,
      trace_id: tracePath ? requestId : null,
    };
  } catch {
    await writeTrace({
      request_id: requestId,
      flow_path: flowPath,
      source_route: input.traceMeta?.source_route ?? null,
      session_id: input.traceMeta?.session_id ?? null,
      role: input.traceMeta?.role ?? null,
      tenant_id: input.tenantId,
      user_message: input.userMessage,
      constraints: input.constraints,
      prompt_context: input.promptContext ?? null,
      query_trace: queryTrace,
      timing_ms: {
        ...timings,
        total_ms: Date.now() - startedAt,
      },
      ai_trace: aiTrace,
      result: null,
      error: "Unexpected pipeline failure",
    });
    return {
      ok: false,
      error: "Unexpected pipeline failure",
    };
  }
}

async function fetchInventoryCandidates(input: {
  tenantId: string | null;
  constraints: HardConstraints;
  limit: number;
  queryTrace: PipelineQueryTrace[];
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
        queryTrace: input.queryTrace,
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
  queryTrace: PipelineQueryTrace[];
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
  if (error || !Array.isArray(data)) {
    input.queryTrace.push({
      variant: input.variant,
      filters: {
        tenant_id: input.tenantId,
        status: "available",
        limit: input.limit,
        size_bounds: bounds
          ? {
              min_width_in: bounds.minWidthIn,
              max_width_in: bounds.maxWidthIn,
              min_length_in: bounds.minLengthIn,
              max_length_in: bounds.maxLengthIn,
              rotated,
            }
          : null,
        budget_max: typeof budgetMax === "number" ? budgetMax : null,
        budget_field:
          wantsBudgetSale && wantsBudgetList
            ? "sale_price_or_price"
            : wantsBudgetSale
              ? "sale_price"
              : wantsBudgetList
                ? "price"
                : null,
      },
      row_count: 0,
      error: error?.message ?? "Unknown query failure",
    });
    return null;
  }

  input.queryTrace.push({
    variant: input.variant,
    filters: {
      tenant_id: input.tenantId,
      status: "available",
      limit: input.limit,
      size_bounds: bounds
        ? {
            min_width_in: bounds.minWidthIn,
            max_width_in: bounds.maxWidthIn,
            min_length_in: bounds.minLengthIn,
            max_length_in: bounds.maxLengthIn,
            rotated,
          }
        : null,
      budget_max: typeof budgetMax === "number" ? budgetMax : null,
      budget_field:
        wantsBudgetSale && wantsBudgetList
          ? "sale_price_or_price"
          : wantsBudgetSale
            ? "sale_price"
            : wantsBudgetList
              ? "price"
              : null,
    },
    row_count: data.length,
    error: null,
  });

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
