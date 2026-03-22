import { filterByHardConstraints } from "@/lib/filters/hard-constraints";
import { shapeCandidatesForAI } from "@/lib/filters/candidate-shaping";
import { getSizeBounds } from "@/lib/filters/size-bounds";
import { resolveEffectiveFields } from "@/lib/inventory/resolve-fields";
import { parseRugRecord } from "@/lib/inventory/rug-record";
import { fetchPrimaryRugImagesForRugs } from "@/lib/storage/rug-images";
import { rankAndExplain } from "@/lib/ai/recommend";
import type { RecommendationAiTrace } from "@/lib/ai/recommend";
import { logRecommendationQaEvent } from "@/lib/qa/recommendation-log";
import type { E2eTraceMeta } from "@/lib/qa/e2e-trace";
import { writeE2eTraceArtifact } from "@/lib/qa/e2e-trace";
import type { HardConstraints, InventoryRug } from "@/lib/types/recommendation";
import type { RecommendationResponse } from "@/lib/ai/recommend";
import { OPENAI_CHAT_MODEL } from "@/lib/config";
import type { SupabaseClient } from "@supabase/supabase-js";

const SQL_QUERY_LIMIT = 220;
const AI_CANDIDATE_LIMIT = 40;

type RunRecommendationPipelineInput = {
  requestId?: string;
  tenantId: string;
  userMessage: string;
  constraints: HardConstraints;
  followupIntent?:
    | "none"
    | "closest"
    | "larger"
    | "smaller"
    | "more_like_this"
    | "tighten";
  priorResultMode?: "recommendation" | "no_match" | "clarifying_question" | null;
  promptContext?: {
    role?: "retail_customer" | "store_staff";
    chat_context?: {
      structured_state?: unknown;
      conversation_memory?: unknown;
      recent_turns?: unknown[];
    };
  };
  traceMeta?: E2eTraceMeta & {
    source_route: "/api/recommend" | "/api/chat";
    session_id?: string | null;
    role?: "retail_customer" | "store_staff" | null;
  };
};

type RunRecommendationPipelineResult =
  | {
      ok: true;
      response: RecommendationResponse;
      trace_id?: string | null;
      meta?: {
        relaxed_size_tolerance_in?: number | null;
        blockers?: string[];
      };
    }
  | { ok: false; error: string };

type PipelineQueryTrace = {
  variant: string;
  filters: Record<string, unknown>;
  row_count: number;
  error: string | null;
};

const SIZE_RELAXATION_STEPS_IN = [0, 4, 8, 12, 18, 24] as const;

// Flow overview
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
    model: OPENAI_CHAT_MODEL,
    prompt_layers: [],
    request_payload: null,
    response_status: null,
    response_payload: null,
    parsed_response: null,
    fallback_reason: null,
    error: null,
    incomplete_detected: false,
    retry_attempted: false,
    retry_succeeded: false,
    text_postprocess_applied: false,
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
    const shouldPrepareClosestRelaxation = shouldAttemptClosestRelaxation({
      followupIntent: input.followupIntent ?? "none",
      priorResultMode: input.priorResultMode ?? null,
      constraints: input.constraints,
    });
    const sqlConstraintEnvelope = shouldPrepareClosestRelaxation
      ? expandSizeToleranceForFetch(input.constraints)
      : input.constraints;

    const sqlStart = Date.now();
    const inventory = await fetchInventoryCandidates({
      requestId,
      tenantId: input.tenantId,
      constraints: sqlConstraintEnvelope,
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

    let effectiveConstraints = input.constraints;
    let relaxedToleranceIn: number | null = null;

    const hardFilterStart = Date.now();
    let candidates = filterByHardConstraints(inventory, effectiveConstraints);
    timings.filter_hard_constraints_ms = Date.now() - hardFilterStart;

    if (
      candidates.length === 0 &&
      shouldAttemptClosestRelaxation({
        followupIntent: input.followupIntent ?? "none",
        priorResultMode: input.priorResultMode ?? null,
        constraints: effectiveConstraints,
      })
    ) {
      const relaxed = applyClosestRelaxationLadder(
        inventory,
        effectiveConstraints
      );
      candidates = relaxed.candidates;
      effectiveConstraints = relaxed.constraints;
      relaxedToleranceIn = relaxed.relaxedToleranceIn;
    }

    let blockers: string[] = [];
    if (candidates.length === 0) {
      blockers = detectHardConstraintBlockers(inventory, effectiveConstraints);
      const response = buildGuidedNoMatchResponse({
        userMessage: input.userMessage,
        constraints: effectiveConstraints,
        followupIntent: input.followupIntent ?? "none",
        blockers,
        relaxedToleranceIn,
      });

      const logStart = Date.now();
      await logRecommendationQaEvent({
        request_id: requestId,
        tenant_id: input.tenantId,
        user_message: input.userMessage,
        constraints: effectiveConstraints,
        sql_candidate_count: inventory.length,
        filtered_candidate_count: 0,
        ai_candidate_count: 0,
        response_mode: response.mode,
        recommendation_ids: [],
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
        constraints: effectiveConstraints,
        prompt_context: input.promptContext ?? null,
        query_trace: queryTrace,
        candidate_counts: {
          sql_candidates: inventory.length,
          hard_filtered_candidates: 0,
          ai_candidates: 0,
        },
        timing_ms: {
          ...timings,
          total_ms: Date.now() - startedAt,
        },
        ai_trace: aiTrace,
        result: {
          mode: response.mode,
          notes: response.notes,
          recommendation_ids: [],
          recommendation_count: 0,
          blockers,
          relaxed_size_tolerance_in: relaxedToleranceIn,
        },
        error: null,
      });

      return {
        ok: true,
        response,
        trace_id: tracePath ? requestId : null,
        meta: {
          relaxed_size_tolerance_in: relaxedToleranceIn,
          blockers,
        },
      };
    }

    const shapeStart = Date.now();
    const aiCandidates = shapeCandidatesForAI(candidates, {
      maxCandidates: AI_CANDIDATE_LIMIT,
      userMessage: input.userMessage,
      constraints: effectiveConstraints,
      followupIntent: input.followupIntent ?? "none",
    });
    timings.shape_candidates_ms = Date.now() - shapeStart;

    const aiStart = Date.now();
    const response = await rankAndExplain(
      aiCandidates,
      effectiveConstraints,
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
      constraints: effectiveConstraints,
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
      constraints: effectiveConstraints,
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
        relaxed_size_tolerance_in: relaxedToleranceIn,
      },
      error: null,
    });

    return {
      ok: true,
      response,
      trace_id: tracePath ? requestId : null,
      meta: {
        relaxed_size_tolerance_in: relaxedToleranceIn,
        blockers,
      },
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

function shouldAttemptClosestRelaxation(input: {
  followupIntent:
    | "none"
    | "closest"
    | "larger"
    | "smaller"
    | "more_like_this"
    | "tighten";
  priorResultMode: "recommendation" | "no_match" | "clarifying_question" | null;
  constraints: HardConstraints;
}): boolean {
  if (!input.constraints.size) return false;
  if (
    input.followupIntent !== "closest" &&
    input.followupIntent !== "larger" &&
    input.followupIntent !== "smaller"
  ) {
    return false;
  }

  return input.priorResultMode === "no_match";
}

function expandSizeToleranceForFetch(constraints: HardConstraints): HardConstraints {
  if (!constraints.size) return constraints;
  return {
    ...constraints,
    size: {
      ...constraints.size,
      toleranceIn: Math.max(
        constraints.size.toleranceIn ?? 0,
        SIZE_RELAXATION_STEPS_IN[SIZE_RELAXATION_STEPS_IN.length - 1]
      ),
    },
  };
}

function applyClosestRelaxationLadder(
  inventory: InventoryRug[],
  constraints: HardConstraints
): {
  constraints: HardConstraints;
  candidates: InventoryRug[];
  relaxedToleranceIn: number | null;
} {
  if (!constraints.size) {
    return {
      constraints,
      candidates: filterByHardConstraints(inventory, constraints),
      relaxedToleranceIn: null,
    };
  }

  for (const tolerance of SIZE_RELAXATION_STEPS_IN) {
    const nextConstraints: HardConstraints = {
      ...constraints,
      size: {
        ...constraints.size,
        toleranceIn: tolerance,
      },
    };
    const candidates = filterByHardConstraints(inventory, nextConstraints);
    if (candidates.length > 0) {
      return {
        constraints: nextConstraints,
        candidates,
        relaxedToleranceIn: tolerance,
      };
    }
  }

  return {
    constraints,
    candidates: [],
    relaxedToleranceIn: SIZE_RELAXATION_STEPS_IN[SIZE_RELAXATION_STEPS_IN.length - 1],
  };
}

function detectHardConstraintBlockers(
  inventory: InventoryRug[],
  constraints: HardConstraints
): string[] {
  const blockers: string[] = [];
  const activeKeys: Array<keyof HardConstraints> = [];
  if (constraints.size) activeKeys.push("size");
  if (constraints.colors && constraints.colors.length > 0) activeKeys.push("colors");
  if (constraints.styles && constraints.styles.length > 0) activeKeys.push("styles");
  if (constraints.shape) activeKeys.push("shape");

  if (activeKeys.length === 0) return blockers;

  const baseline = filterByHardConstraints(inventory, constraints);
  if (baseline.length > 0) return blockers;

  for (const key of activeKeys) {
    const relaxed: HardConstraints = {
      ...constraints,
      [key]: undefined,
    };
    const relaxedMatches = filterByHardConstraints(inventory, relaxed);
    if (relaxedMatches.length > 0) {
      blockers.push(key);
    }
  }

  return blockers;
}

function describeHardConstraints(constraints: HardConstraints): string[] {
  const items: string[] = [];
  if (constraints.size) {
    const toleranceText =
      typeof constraints.size.toleranceIn === "number"
        ? ` ±${constraints.size.toleranceIn}"`
        : "";
    items.push(
      `size ${Math.round(constraints.size.widthIn)}" x ${Math.round(
        constraints.size.lengthIn
      )}"${toleranceText}`
    );
  }
  if (constraints.colors && constraints.colors.length > 0) {
    items.push(`colors ${constraints.colors.join(", ")}`);
  }
  if (constraints.styles && constraints.styles.length > 0) {
    items.push(`styles ${constraints.styles.join(", ")}`);
  }
  if (constraints.shape) {
    items.push(
      constraints.shape === "round_oval"
        ? "shape round/oval"
        : `shape ${constraints.shape}`
    );
  }
  return items;
}

function blockerLabel(blocker: string): string {
  if (blocker === "colors") return "color";
  if (blocker === "styles") return "style";
  if (blocker === "shape") return "shape";
  return blocker;
}

function buildGuidedNoMatchResponse(input: {
  userMessage: string;
  constraints: HardConstraints;
  followupIntent:
    | "none"
    | "closest"
    | "larger"
    | "smaller"
    | "more_like_this"
    | "tighten";
  blockers: string[];
  relaxedToleranceIn: number | null;
}): RecommendationResponse {
  const constraintSummary = describeHardConstraints(input.constraints);
  const summaryText =
    constraintSummary.length > 0
      ? `I couldn't find rugs matching ${constraintSummary.join(" + ")}.`
      : "I couldn't find rugs matching your request.";

  let assistantMessage = summaryText;
  if (
    (input.followupIntent === "closest" ||
      input.followupIntent === "larger" ||
      input.followupIntent === "smaller") &&
    typeof input.relaxedToleranceIn === "number"
  ) {
    assistantMessage = `${summaryText} I widened size tolerance up to ±${input.relaxedToleranceIn}" and still found no valid matches.`;
  }

  if (input.blockers.length > 0) {
    assistantMessage = `${assistantMessage} The tightest blockers appear to be ${input.blockers
      .map((blocker) => blockerLabel(blocker))
      .join(" + ")} constraints.`;
  }

  const questions: string[] = [];
  if (input.blockers.includes("colors")) {
    questions.push("Would you like to relax color and keep the other constraints strict?");
  }
  if (input.blockers.includes("styles")) {
    questions.push("Would you like to relax style and keep size/color strict?");
  }
  if (input.blockers.includes("shape")) {
    questions.push("Would you like to clear shape and keep the rest strict?");
  }
  if (questions.length === 0) {
    questions.push("Would you like to relax one constraint so I can show the closest options?");
  }

  return {
    mode: "no_match",
    assistant_message: assistantMessage,
    questions: questions.slice(0, 2),
    recommendations: [],
    notes: null,
  };
}

async function fetchInventoryCandidates(input: {
  requestId: string;
  tenantId: string;
  constraints: HardConstraints;
  limit: number;
  queryTrace: PipelineQueryTrace[];
}): Promise<InventoryRug[] | null> {
  const supabase = await getSupabaseAdminSafe();
  if (!supabase) return null;

  const sizeBounds = getSizeBounds(input.constraints.size);
  const variants = buildQueryVariants({ hasSize: Boolean(sizeBounds) });

  const results = await Promise.all(
    variants.map((variant) =>
      runCandidateQuery({
        supabase,
        tenantId: input.tenantId,
        limit: input.limit,
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
  const primaryImageMap = await fetchPrimaryRugImagesForRugs({
    supabase,
    tenantId: input.tenantId,
    rugIds: [...merged.keys()],
  });

  const enriched = [...merged.values()].map((rug) => {
    const image = primaryImageMap.get(rug.id);
    return {
      ...rug,
      primary_image_url: image?.primary_image_url ?? null,
    };
  });

  const withImages = enriched.filter(
    (rug) =>
      typeof rug.primary_image_url === "string" &&
      rug.primary_image_url.trim().length > 0
  );
  const droppedForMissingImage = enriched.filter(
    (rug) =>
      !(typeof rug.primary_image_url === "string" && rug.primary_image_url.trim().length > 0)
  );

  if (droppedForMissingImage.length > 0) {
    console.warn("[recommendation] Candidates dropped: missing primary image", {
      request_id: input.requestId,
      tenant_id: input.tenantId,
      dropped_count: droppedForMissingImage.length,
    });
  }

  return withImages.map((rug) => {
    const effectiveFields = resolveEffectiveFields(
      rug.intake_label ?? null,
      rug.ai_structured_fields ?? null,
      rug.staff_overrides ?? null
    );

    return {
      ...rug,
      effective_fields: effectiveFields,
      origin: effectiveFields.origin ?? null,
      style: effectiveFields.style ?? null,
      mood: effectiveFields.mood ?? null,
    };
  });
}

async function getSupabaseAdminSafe(): Promise<SupabaseClient | null> {
  try {
    const supabaseModule = await import("@/lib/supabase/admin");
    return supabaseModule.supabaseAdmin;
  } catch {
    return null;
  }
}

function buildQueryVariants(input: { hasSize: boolean }): Array<
  "base" | "size_direct" | "size_rotated"
> {
  if (input.hasSize) {
    return ["size_direct", "size_rotated"];
  }
  return ["base"];
}

async function runCandidateQuery(input: {
  supabase: SupabaseClient;
  tenantId: string;
  limit: number;
  sizeBounds: ReturnType<typeof getSizeBounds>;
  variant: "base" | "size_direct" | "size_rotated";
  queryTrace: PipelineQueryTrace[];
}): Promise<InventoryRug[] | null> {
  const bounds = input.sizeBounds;
  const wantsSize = input.variant !== "base";
  const rotated = input.variant === "size_rotated";

  const buildQuery = (selectColumns: string) => {
    let query = input.supabase
      .from("rugs")
      .select(selectColumns)
      .eq("status", "available")
      .eq("enrichment_status", "ready")
      .order("created_at", { ascending: false, nullsFirst: false })
      .order("id", { ascending: false })
      .limit(input.limit);

    query = query.eq("tenant_id", input.tenantId);

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

    return query;
  };

  const selectCandidates = [
    "id, tenant_id, intake_label, status, enrichment_status, review_reason_code, width_total_in, length_total_in, ai_description, ai_structured_fields, staff_overrides",
    "id, tenant_id, intake_label, status, enrichment_status, review_reason_code, width_total_in, length_total_in, ai_description, ai_structured_fields",
    "id, tenant_id, intake_label, status, enrichment_status, review_reason_code, width_total_in, length_total_in, ai_description",
  ];

  let queryResult = await buildQuery(selectCandidates[0]);
  for (const selectColumns of selectCandidates.slice(1)) {
    if (!queryResult.error) break;
    if (!isLikelyMissingColumnError(queryResult.error.message ?? "")) break;
    queryResult = await buildQuery(selectColumns);
  }

  const { data, error } = queryResult;
  if (error || !Array.isArray(data)) {
    input.queryTrace.push({
      variant: input.variant,
      filters: {
        tenant_id: input.tenantId,
        status: "available",
        enrichment_status: "ready",
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
      enrichment_status: "ready",
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
    },
    row_count: data.length,
    error: null,
  });

  return (data as unknown[])
    .map((row) => toInventoryFromDbRow(row))
    .filter((row): row is InventoryRug => row !== null);
}

function toInventoryFromDbRow(row: unknown): InventoryRug | null {
  const parsed = parseRugRecord(row);
  if (!parsed) return null;
  return {
    id: parsed.id,
    intake_label: parsed.intake_label,
    status: parsed.status,
    width_total_in: parsed.width_total_in,
    length_total_in: parsed.length_total_in,
    ai_description: parsed.ai_description,
    ai_structured_fields: parsed.ai_structured_fields,
    staff_overrides: parsed.staff_overrides,
  };
}

function isLikelyMissingColumnError(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("does not exist") ||
    normalized.includes("schema cache") ||
    normalized.includes("could not find the")
  );
}
