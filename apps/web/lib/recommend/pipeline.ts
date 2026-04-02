import { filterByHardConstraints } from "@/lib/filters/hard-constraints";
import { shapeCandidatesForAI } from "@/lib/filters/candidate-shaping";
import { getSizeBounds, type SizeWindow } from "@/lib/filters/size-bounds";
import { resolveEffectiveFields } from "@/lib/inventory/resolve-fields";
import { toSimilaritySizePreset } from "@/lib/inventory/size-presets";
import { parseRugRecord } from "@/lib/inventory/rug-record";
import { formatRugSize } from "@/lib/utils/format";
import {
  isReasonableLongSideRatio,
  isWithinRelaxedBucketDistance,
  resolveRequestedSizePreset,
} from "@/lib/recommend/size-similarity-policy";
import {
  expandColorRequestToFamily,
  normalizeColorList,
} from "@/lib/config/color-taxonomy";
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

const MIN_DYNAMIC_SQL_QUERY_LIMIT = 120;
const MAX_DYNAMIC_SQL_QUERY_LIMIT = 400;
const DEFAULT_DYNAMIC_SQL_QUERY_LIMIT = 220;
const AI_CANDIDATE_LIMIT = 40;
const BROADENED_NO_MATCH_NOTE_CODE = "BROADENED_SIZE_COLOR_STYLE";
const STYLE_RELAXATION_NOTE_CODE = "STYLE_RELAXED_TO_ORIGIN_OR_MOOD";
const STYLE_DROPPED_NOTE_CODE = "STYLE_DROPPED_AFTER_FALLBACK";
const SIZE_RELAX_SOFT_NOTE_CODE = "SIZE_RELAX_SOFT";
const SIZE_RELAX_MEDIUM_NOTE_CODE = "SIZE_RELAX_MEDIUM";
const SIZE_RELAX_STRONG_NOTE_CODE = "SIZE_RELAX_STRONG";
const CONSTRAINT_MISMATCH_EXPANDED_NOTE_CODE = "CONSTRAINT_MISMATCH_EXPANDED";
const THIN_RESULTS_STYLE_EXPANDED_NOTE_CODE = "THIN_RESULTS_STYLE_EXPANDED";
const MAX_REASONABLE_REQUEST_LONG_SIDE_IN = 240;

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
  priorResultMode?:
    | "recommendation"
    | "no_match"
    | "clarifying_question"
    | "disambiguation"
    | null;
  noMatchAttempts?: number;
  constraintConfidence?: "high" | "medium" | "low";
  discoveryRequested?: boolean;
  lastRecommendedSizeIn?: {
    width_in: number;
    length_in: number;
  } | null;
  promptContext?: {
    role?: "retail_customer" | "store_staff";
    discovery_mode?: boolean;
    chat_context?: {
      structured_state?: unknown;
      conversation_memory?: unknown;
      customer_context?: string[];
      recently_shown_rugs?: Array<{
        id: string;
        label: string;
        colors: string[];
        style: string | null;
        origin: string | null;
      }>;
      shown_rug_ids?: string[];
      liked_attributes?: {
        colors: string[];
        styles: string[];
        origins: string[];
      };
      recent_turns?: unknown[];
    };
    constraint_mismatch?: {
      expanded_from_zero_match: boolean;
      unmet_constraints: string[];
      disclosure_hint: string | null;
    };
    expanded_due_to_thin_results?: boolean;
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
        last_recommended_size_in?: {
          width_in: number;
          length_in: number;
        } | null;
        recently_shown_rugs?: Array<{
          id: string;
          label: string;
          colors: string[];
          style: string | null;
          origin: string | null;
        }>;
      };
    }
  | { ok: false; error: string };

type PipelineQueryTrace = {
  variant: string;
  query_variant_reason: string;
  filters: Record<string, unknown>;
  row_count: number;
  error: string | null;
};

type BroadeningStage =
  | "none"
  | "size_relaxation_ladder"
  | "size_relaxation_ladder_plus_color_style_relaxation"
  | "thin_results_style_relaxation"
  | "full_alternative_expansion";

type RecommendationSizeIn = {
  width_in: number;
  length_in: number;
};

const SIZE_RELAXATION_STEPS_IN = [4, 8, 12, 18, 24] as const;

type NoMatchTrace = {
  fallback_tier: "none" | "guided" | "terminal" | "expanded";
  reasonableness_gate: "not_applicable" | "passed" | "failed";
  reasonableness_gate_result: "not_applicable" | "passed" | "failed";
  terminal_reason_code: string | null;
};

function isDirectionalFollowupIntent(
  followupIntent:
    | "none"
    | "closest"
    | "larger"
    | "smaller"
    | "more_like_this"
    | "tighten"
): followupIntent is "closest" | "larger" | "smaller" {
  return (
    followupIntent === "closest" ||
    followupIntent === "larger" ||
    followupIntent === "smaller"
  );
}

function toSizeConstraint(
  size: RecommendationSizeIn | null | undefined
): NonNullable<HardConstraints["size"]> | null {
  if (!size) return null;
  return {
    widthIn: size.width_in,
    lengthIn: size.length_in,
  };
}

function buildSizeSearchWindow(input: {
  constraints: HardConstraints;
  followupIntent:
    | "none"
    | "closest"
    | "larger"
    | "smaller"
    | "more_like_this"
    | "tighten";
  lastRecommendedSizeIn?: RecommendationSizeIn | null;
}): {
  sizeReference: NonNullable<HardConstraints["size"]> | null;
  sizeWindow: SizeWindow | null;
} {
  if (input.constraints.size) {
    if (input.followupIntent === "smaller") {
      return {
        sizeReference: input.constraints.size,
        sizeWindow: {
          maxWidthIn: Math.max(1, input.constraints.size.widthIn - 1),
          maxLengthIn: Math.max(1, input.constraints.size.lengthIn - 1),
        },
      };
    }
    if (input.followupIntent === "larger") {
      return {
        sizeReference: input.constraints.size,
        sizeWindow: {
          minWidthIn: input.constraints.size.widthIn + 1,
          minLengthIn: input.constraints.size.lengthIn + 1,
        },
      };
    }
    const bounds = getSizeBounds(input.constraints.size);
    return {
      sizeReference: input.constraints.size,
      sizeWindow: bounds
        ? {
            minWidthIn: bounds.minWidthIn,
            maxWidthIn: bounds.maxWidthIn,
            minLengthIn: bounds.minLengthIn,
            maxLengthIn: bounds.maxLengthIn,
          }
        : null,
    };
  }

  const anchor = toSizeConstraint(input.lastRecommendedSizeIn);
  if (!anchor || !isDirectionalFollowupIntent(input.followupIntent)) {
    return {
      sizeReference: null,
      sizeWindow: null,
    };
  }

  if (input.followupIntent === "smaller") {
    return {
      sizeReference: anchor,
      sizeWindow: {
        maxWidthIn: anchor.widthIn,
        maxLengthIn: anchor.lengthIn,
      },
    };
  }

  if (input.followupIntent === "larger") {
    return {
      sizeReference: anchor,
      sizeWindow: {
        minWidthIn: anchor.widthIn,
        minLengthIn: anchor.lengthIn,
      },
    };
  }

  const bounds = getSizeBounds(anchor);
  return {
    sizeReference: anchor,
    sizeWindow: bounds
      ? {
          minWidthIn: bounds.minWidthIn,
          maxWidthIn: bounds.maxWidthIn,
          minLengthIn: bounds.minLengthIn,
          maxLengthIn: bounds.maxLengthIn,
        }
      : null,
  };
}

function toRuntimeSizeIn(
  size: RecommendationSizeIn | null | undefined
): { width_in: number; length_in: number } | null {
  if (!size) return null;
  return {
    width_in: size.width_in,
    length_in: size.length_in,
  };
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function dedupeCandidatesByVisualSignature(
  candidates: InventoryRug[]
): InventoryRug[] {
  if (candidates.length <= 1) return candidates;

  const unique: InventoryRug[] = [];
  const seenImageKeys = new Set<string>();
  const seenFallbackKeys = new Set<string>();

  for (const rug of candidates) {
    const effective = rug.effective_fields
      ? rug.effective_fields
      : resolveEffectiveFields(
          rug.intake_label ?? null,
          rug.ai_structured_fields ?? null,
          rug.staff_overrides ?? null,
          rug.ai_description ?? null
        );
    const fallbackKey = normalizeText(
      [
        effective.label ?? rug.intake_label ?? "",
        effective.style ?? "",
        effective.origin ?? "",
        String(rug.width_total_in ?? ""),
        String(rug.length_total_in ?? ""),
      ].join("|")
    );

    const imageKey =
      typeof rug.primary_image_url === "string"
        ? normalizeText(rug.primary_image_url)
        : "";

    if (seenFallbackKeys.has(fallbackKey)) continue;
    if (imageKey && seenImageKeys.has(imageKey)) continue;

    seenFallbackKeys.add(fallbackKey);
    if (imageKey) seenImageKeys.add(imageKey);
    unique.push(rug);
  }

  return unique;
}

function candidateDominantColors(
  rug: InventoryRug
): ReturnType<typeof normalizeColorList> {
  const fields =
    rug.effective_fields ??
    resolveEffectiveFields(
      rug.intake_label ?? null,
      rug.ai_structured_fields ?? null,
      rug.staff_overrides ?? null,
      rug.ai_description ?? null
    );
  return normalizeColorList((fields.primary_colors ?? []).slice(0, 2), 2);
}

function applyAvoidColorPreference(input: {
  candidates: InventoryRug[];
  constraints: HardConstraints;
}): {
  candidates: InventoryRug[];
  avoidedColorsApplied: boolean;
  avoidColorsUnmet: boolean;
} {
  const avoidColors = normalizeColorList(
    input.constraints.avoid_preferences?.colors ?? [],
    8
  );
  if (avoidColors.length === 0 || input.candidates.length === 0) {
    return {
      candidates: input.candidates,
      avoidedColorsApplied: false,
      avoidColorsUnmet: false,
    };
  }

  const avoidFamilyTokens = new Set(expandColorRequestToFamily(avoidColors));
  const filtered = input.candidates.filter((rug) => {
    const dominant = candidateDominantColors(rug);
    if (dominant.length === 0) return true;
    return dominant.every((token) => !avoidFamilyTokens.has(token));
  });

  if (filtered.length > 0) {
    return {
      candidates: filtered,
      avoidedColorsApplied: true,
      avoidColorsUnmet: false,
    };
  }

  return {
    candidates: input.candidates,
    avoidedColorsApplied: false,
    avoidColorsUnmet: true,
  };
}

function applyAvoidStylePreference(input: {
  candidates: InventoryRug[];
  constraints: HardConstraints;
}): {
  candidates: InventoryRug[];
  avoidedStylesApplied: boolean;
  avoidStylesUnmet: boolean;
} {
  const avoidStyles = Array.from(
    new Set(
      (input.constraints.avoid_preferences?.styles ?? [])
        .map((value) => normalizeText(value))
        .filter((value) => value.length > 0)
    )
  );
  if (avoidStyles.length === 0 || input.candidates.length === 0) {
    return {
      candidates: input.candidates,
      avoidedStylesApplied: false,
      avoidStylesUnmet: false,
    };
  }

  const filtered = input.candidates.filter((rug) => {
    const fields =
      rug.effective_fields ??
      resolveEffectiveFields(
        rug.intake_label ?? null,
        rug.ai_structured_fields ?? null,
        rug.staff_overrides ?? null,
        rug.ai_description ?? null
      );
    const haystack = normalizeText(
      [
        fields.label ?? "",
        fields.style ?? "",
        fields.origin ?? "",
        fields.mood ?? "",
        ...(fields.pattern ?? []),
        rug.intake_label ?? "",
        rug.ai_description ?? "",
      ].join(" ")
    );
    return avoidStyles.every((token) => !haystack.includes(token));
  });

  if (filtered.length > 0) {
    return {
      candidates: filtered,
      avoidedStylesApplied: true,
      avoidStylesUnmet: false,
    };
  }

  return {
    candidates: input.candidates,
    avoidedStylesApplied: false,
    avoidStylesUnmet: true,
  };
}

function isPracticalRequest(userMessage: string, customerContext?: string[]): boolean {
  const signalText = [userMessage, ...(customerContext ?? [])].join(" ");
  return /\b(kid|kids|child|children|dog|dogs|pet|pets|high traffic|durable|easy to clean|low maintenance|beach house|tough|practical)\b/i.test(
    signalText
  );
}

function isPracticalUnsuitableRug(rug: InventoryRug): boolean {
  const fields =
    rug.effective_fields ??
    resolveEffectiveFields(
      rug.intake_label ?? null,
      rug.ai_structured_fields ?? null,
      rug.staff_overrides ?? null,
      rug.ai_description ?? null
    );
  const haystack = normalizeText(
    [
      fields.label ?? "",
      fields.style ?? "",
      fields.origin ?? "",
      fields.mood ?? "",
      ...(fields.pattern ?? []),
      rug.intake_label ?? "",
      rug.ai_description ?? "",
    ].join(" ")
  );
  return /\b(antique|semi-antique|fragile|delicate|silk|museum)\b/i.test(
    haystack
  ) ||
    /\b(traditional|persian|heriz|serapi|kashan|tabriz|isfahan|sultanabad|caucasian|kazak|shirvan)\b/i.test(
      haystack
    );
}

function applyPracticalSuitabilityFilter(input: {
  candidates: InventoryRug[];
  userMessage: string;
  customerContext?: string[];
}): {
  candidates: InventoryRug[];
  practicalFilterApplied: boolean;
  practicalUnmet: boolean;
} {
  if (
    !isPracticalRequest(input.userMessage, input.customerContext) ||
    input.candidates.length === 0
  ) {
    return {
      candidates: input.candidates,
      practicalFilterApplied: false,
      practicalUnmet: false,
    };
  }
  const filtered = input.candidates.filter((rug) => !isPracticalUnsuitableRug(rug));
  if (filtered.length > 0) {
    return {
      candidates: filtered,
      practicalFilterApplied: true,
      practicalUnmet: false,
    };
  }
  return {
    candidates: input.candidates,
    practicalFilterApplied: false,
    practicalUnmet: true,
  };
}

function hasAnyStyleMatches(
  candidates: InventoryRug[],
  styles: string[]
): boolean {
  if (styles.length === 0) return true;
  const normalizedStyles = styles
    .map((style) => normalizeText(style))
    .filter((style) => style.length > 0);
  if (normalizedStyles.length === 0) return true;

  return candidates.some((rug) => {
    const fields =
      rug.effective_fields ??
      resolveEffectiveFields(
        rug.intake_label ?? null,
        rug.ai_structured_fields ?? null,
        rug.staff_overrides ?? null,
        rug.ai_description ?? null
      );
    const haystack = normalizeText(
      [
        fields.style ?? "",
        fields.origin ?? "",
        fields.mood ?? "",
        ...(fields.pattern ?? []),
        rug.ai_description ?? "",
        rug.intake_label ?? "",
      ].join(" ")
    );
    return normalizedStyles.some((token) => haystack.includes(token));
  });
}

function hasAnyRequestedConstraints(constraints: HardConstraints): boolean {
  return Boolean(
    constraints.size ||
      (constraints.colors && constraints.colors.length > 0) ||
      (constraints.styles && constraints.styles.length > 0) ||
      constraints.shape
  );
}

function isDiscoveryMode(input: {
  discoveryRequested: boolean;
}): boolean {
  return input.discoveryRequested;
}

function constraintStrictness(
  constraints: HardConstraints,
  key: "size" | "colors" | "styles" | "shape"
): "must" | "prefer" {
  return constraints.strictness?.[key] === "must" ? "must" : "prefer";
}

function resolveColorSqlPrefilterTokens(input: {
  constraints: HardConstraints;
  discoveryMode: boolean;
  confidence: "high" | "medium" | "low";
}): string[] {
  if (input.discoveryMode) {
    return [];
  }
  if (input.confidence === "low") {
    return [];
  }
  if (!input.constraints.colors || input.constraints.colors.length === 0) {
    return [];
  }
  return expandColorRequestToFamily(input.constraints.colors).slice(0, 10);
}

function canDropColors(constraints: HardConstraints): boolean {
  return (
    Boolean(constraints.colors && constraints.colors.length > 0) &&
    constraintStrictness(constraints, "colors") !== "must"
  );
}

const STYLE_TO_ORIGIN_FAMILY: Record<string, string[]> = {
  heriz: ["Persian"],
  serapi: ["Persian"],
  kashan: ["Persian"],
  isfahan: ["Persian"],
  tabriz: ["Persian"],
  kerman: ["Persian"],
  nain: ["Persian"],
  qom: ["Persian"],
  bidjar: ["Persian"],
  malayer: ["Persian"],
  sarouk: ["Persian"],
  sultanabad: ["Persian"],
  bakhtiari: ["Persian"],
  hamadan: ["Persian"],
  mashad: ["Persian"],
  qashqai: ["Persian"],
  oushak: ["Turkish"],
  kazak: ["Caucasian"],
  shirvan: ["Caucasian"],
  karabagh: ["Caucasian"],
  bokhara: ["Central Asian"],
  turkmen: ["Central Asian"],
  baluch: ["Central Asian", "Afghan"],
  gabbeh: ["Afghan"],
  beniourain: ["Moroccan"],
  azilal: ["Moroccan"],
};

const MOOD_ADJACENCY: Record<string, string[]> = {
  traditional: ["transitional", "eclectic"],
  transitional: ["traditional", "eclectic", "modern"],
  eclectic: ["transitional", "traditional", "modern"],
  modern: ["eclectic", "transitional"],
};

function normalizeStyleToken(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function applyStyleFallback(input: {
  inventory: InventoryRug[];
  constraints: HardConstraints;
  sizeWindow: SizeWindow | null;
}): {
  constraints: HardConstraints;
  candidates: InventoryRug[];
  stage: "none" | "origin_or_mood_family" | "style_dropped";
} {
  if (
    !input.constraints.styles ||
    input.constraints.styles.length === 0 ||
    constraintStrictness(input.constraints, "styles") === "must"
  ) {
    return {
      constraints: input.constraints,
      candidates: filterByHardConstraints(
        input.inventory,
        input.constraints,
        input.sizeWindow
      ),
      stage: "none",
    };
  }

  const styleAgnosticConstraints: HardConstraints = {
    ...input.constraints,
    styles: undefined,
  };
  const styleAgnosticCandidates = filterByHardConstraints(
    input.inventory,
    styleAgnosticConstraints,
    input.sizeWindow
  );

  if (styleAgnosticCandidates.length === 0) {
    return {
      constraints: styleAgnosticConstraints,
      candidates: [],
      stage: "style_dropped",
    };
  }

  const originTargets = new Set<string>();
  const moodTargets = new Set<string>();
  for (const rawStyle of input.constraints.styles) {
    const normalizedStyle = normalizeStyleToken(rawStyle);
    if (STYLE_TO_ORIGIN_FAMILY[normalizedStyle]) {
      for (const origin of STYLE_TO_ORIGIN_FAMILY[normalizedStyle]) {
        originTargets.add(origin.toLowerCase());
      }
    }
    if (MOOD_ADJACENCY[normalizedStyle]) {
      moodTargets.add(normalizedStyle);
      for (const adjacent of MOOD_ADJACENCY[normalizedStyle]) {
        moodTargets.add(adjacent);
      }
    }
  }

  const adjacencyCandidates = styleAgnosticCandidates.filter((rug) => {
    const fields = rug.effective_fields;
    const origin = (fields?.origin ?? "").toLowerCase();
    const mood = (fields?.mood ?? "").toLowerCase();
    const originMatch = originTargets.size > 0 && originTargets.has(origin);
    const moodMatch = moodTargets.size > 0 && moodTargets.has(mood);
    return originMatch || moodMatch;
  });

  if (adjacencyCandidates.length > 0) {
    return {
      constraints: styleAgnosticConstraints,
      candidates: adjacencyCandidates,
      stage: "origin_or_mood_family",
    };
  }

  return {
    constraints: styleAgnosticConstraints,
    candidates: styleAgnosticCandidates,
    stage: "style_dropped",
  };
}

function applyPreferSizeReasonablenessGuard(
  candidates: InventoryRug[],
  constraints: HardConstraints
): InventoryRug[] {
  if (!constraints.size) return candidates;
  if (constraintStrictness(constraints, "size") === "must") return candidates;

  const requestedPreset = resolveRequestedSizePreset({
    widthIn: constraints.size.widthIn,
    lengthIn: constraints.size.lengthIn,
  });
  const requestedLongSide = Math.max(
    constraints.size.widthIn,
    constraints.size.lengthIn
  );

  return candidates.filter((rug) => {
    if (
      typeof rug.width_total_in !== "number" ||
      typeof rug.length_total_in !== "number"
    ) {
      return false;
    }
    const candidatePreset = toSimilaritySizePreset({
      widthIn: rug.width_total_in,
      lengthIn: rug.length_total_in,
    });
    const candidateLongSide = Math.max(rug.width_total_in, rug.length_total_in);

    return (
      isWithinRelaxedBucketDistance({
        requestedPreset,
        candidatePreset,
      }) &&
      isReasonableLongSideRatio({
        requestedLongSideIn: requestedLongSide,
        candidateLongSideIn: candidateLongSide,
      })
    );
  });
}

function resolveDynamicSqlQueryLimit(input: {
  roughInventorySize: number | null;
  hasConstraints: boolean;
}): number {
  if (input.roughInventorySize === null) {
    return DEFAULT_DYNAMIC_SQL_QUERY_LIMIT;
  }

  const size = Math.max(0, input.roughInventorySize);
  let limit = DEFAULT_DYNAMIC_SQL_QUERY_LIMIT;

  if (size <= 500) {
    // For small-to-mid inventories, pull the full tenant set (up to cap) so
    // candidate shaping sees the real distribution instead of a partial slice.
    limit = Math.min(MAX_DYNAMIC_SQL_QUERY_LIMIT, Math.max(size, 160));
  } else if (size <= 1500) {
    limit = input.hasConstraints ? 300 : 240;
  } else if (size <= 3000) {
    limit = input.hasConstraints ? 360 : 300;
  } else {
    limit = 400;
  }

  return Math.max(
    MIN_DYNAMIC_SQL_QUERY_LIMIT,
    Math.min(MAX_DYNAMIC_SQL_QUERY_LIMIT, limit)
  );
}

function toActiveHardConstraints(constraints: HardConstraints): HardConstraints {
  return {
    size: constraints.size ?? undefined,
    // Color is never a hard exclusion. It is handled as SQL prefilter + ranking signal.
    colors: undefined,
    styles:
      constraints.styles && constraints.styles.length > 0
        ? constraints.styles
        : undefined,
    shape: constraints.shape ?? undefined,
    strictness: constraints.strictness,
    avoid_preferences: constraints.avoid_preferences,
  };
}

function hasFollowupFlowIntent(
  followupIntent: RunRecommendationPipelineInput["followupIntent"]
): boolean {
  return (
    followupIntent === "more_like_this" ||
    followupIntent === "closest" ||
    followupIntent === "larger" ||
    followupIntent === "smaller" ||
    followupIntent === "tighten"
  );
}

function appendNotesCode(
  notes: string | null | undefined,
  code: string
): string {
  if (!notes || notes.trim().length === 0) {
    return code;
  }
  if (notes.includes(code)) {
    return notes;
  }
  return `${notes} | ${code}`;
}

function summarizeQueryRows(queryTrace: PipelineQueryTrace[]) {
  const byVariant = queryTrace.map((entry) => ({
    variant: entry.variant,
    query_variant_reason: entry.query_variant_reason,
    row_count: entry.row_count,
    error: entry.error,
  }));
  const sqlRowsTotal = queryTrace.reduce((sum, entry) => sum + entry.row_count, 0);
  return {
    sql_rows_total: sqlRowsTotal,
    sql_rows_by_variant: byVariant,
  };
}

function sizeRelaxationDisclosureCode(
  relaxedToleranceIn: number | null
): string | null {
  if (typeof relaxedToleranceIn !== "number") return null;
  if (relaxedToleranceIn <= 8) return SIZE_RELAX_SOFT_NOTE_CODE;
  if (relaxedToleranceIn <= 18) return SIZE_RELAX_MEDIUM_NOTE_CODE;
  return SIZE_RELAX_STRONG_NOTE_CODE;
}

function hasDirectionalSizeCoverage(input: {
  candidates: InventoryRug[];
  followupIntent:
    | "none"
    | "closest"
    | "larger"
    | "smaller"
    | "more_like_this"
    | "tighten";
  anchorSize?: RecommendationSizeIn | null;
}): boolean {
  if (!input.anchorSize) return true;
  if (input.followupIntent !== "larger" && input.followupIntent !== "smaller") {
    return true;
  }
  const anchorLongSide = Math.max(
    input.anchorSize.width_in,
    input.anchorSize.length_in
  );
  return input.candidates.some((rug) => {
    const width = rug.width_total_in;
    const length = rug.length_total_in;
    if (typeof width !== "number" || typeof length !== "number") return false;
    const longSide = Math.max(width, length);
    return input.followupIntent === "larger"
      ? longSide > anchorLongSide
      : longSide < anchorLongSide;
  });
}

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
  let dynamicLimit = DEFAULT_DYNAMIC_SQL_QUERY_LIMIT;
  let colorSqlPrefilterTokens: string[] = [];
  let discoveryMode = false;
  let queryVariantReason = "no_size_window_base_query";
  let policySqlFilters: Record<string, unknown> = {};
  let noMatchTrace: NoMatchTrace = {
    fallback_tier: "none",
    reasonableness_gate: "not_applicable",
    reasonableness_gate_result: "not_applicable",
    terminal_reason_code: null,
  };
  let broadeningApplied = false;
  let broadeningStage: BroadeningStage = "none";
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
    const followupIntent = input.followupIntent ?? "none";
    const sizeSearch = buildSizeSearchWindow({
      constraints: input.constraints,
      followupIntent,
      lastRecommendedSizeIn: input.lastRecommendedSizeIn ?? null,
    });
    const effectiveConstraints: HardConstraints =
      sizeSearch.sizeReference && !input.constraints.size
        ? {
            ...input.constraints,
            size: sizeSearch.sizeReference,
          }
        : input.constraints;
    const requestedConstraints: HardConstraints = effectiveConstraints;
    discoveryMode = isDiscoveryMode({
      discoveryRequested: Boolean(input.discoveryRequested),
    });
    const activeConstraints = toActiveHardConstraints(requestedConstraints);
    const forceSizeWindowByIntent =
      followupIntent === "closest" ||
      followupIntent === "larger" ||
      followupIntent === "smaller";
    const activeHardConstraints: HardConstraints =
      forceSizeWindowByIntent && requestedConstraints.size
        ? {
            ...activeConstraints,
            size: requestedConstraints.size,
          }
        : activeConstraints;
    const activeHardSizeWindow: SizeWindow | null =
      (forceSizeWindowByIntent || Boolean(activeHardConstraints.size)) &&
      sizeSearch.sizeWindow
        ? sizeSearch.sizeWindow
        : null;
    queryVariantReason = activeHardSizeWindow
      ? "size_window_active_query_direct_and_rotated"
      : "no_size_window_base_query";
    policySqlFilters = {
      tenant_id: input.tenantId,
      status: "available",
      enrichment_status: "ready",
      size_window: activeHardSizeWindow,
      hard_constraints: {
        size: Boolean(activeHardConstraints.size),
        styles: Boolean(activeHardConstraints.styles?.length),
        shape: Boolean(activeHardConstraints.shape),
      },
      image_sql_filter_active: true,
      color_prefilter_active: false,
      color_prefilter: "inactive",
      color_prefilter_state: "inactive",
      color_prefilter_tokens: [],
      discovery_mode: discoveryMode,
      confidence: input.constraintConfidence ?? "low",
    };

    const inventoryCountStart = Date.now();
    const roughInventorySize = await countRoughInventorySize(input.tenantId);
    timings.count_rough_inventory_size_ms = Date.now() - inventoryCountStart;
    dynamicLimit = resolveDynamicSqlQueryLimit({
      roughInventorySize,
      hasConstraints: hasAnyRequestedConstraints(effectiveConstraints),
    });
    colorSqlPrefilterTokens = resolveColorSqlPrefilterTokens({
      constraints: requestedConstraints,
      discoveryMode,
      confidence: input.constraintConfidence ?? "low",
    });
    policySqlFilters = {
      ...policySqlFilters,
      color_prefilter_active: colorSqlPrefilterTokens.length > 0,
      color_prefilter: colorSqlPrefilterTokens.length > 0 ? "active" : "inactive",
      color_prefilter_state: colorSqlPrefilterTokens.length > 0 ? "active" : "inactive",
      color_prefilter_tokens: colorSqlPrefilterTokens,
    };

    const sqlStart = Date.now();
    const inventory = await fetchInventoryCandidates({
      requestId,
      tenantId: input.tenantId,
      constraints: activeHardConstraints,
      sizeWindow: activeHardSizeWindow,
      limit: dynamicLimit,
      colorSqlPrefilterTokens,
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
        dynamic_limit: dynamicLimit,
        policy_sql_filters: policySqlFilters,
        query_variant_reason: queryVariantReason,
        row_counts: summarizeQueryRows(queryTrace),
        discovery_mode: discoveryMode,
        color_sql_prefilter_tokens: colorSqlPrefilterTokens,
        broadening_applied: broadeningApplied,
        broadening_stage: broadeningStage,
        no_match: noMatchTrace,
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

    let relaxedToleranceIn: number | null = null;
    let filteredByConstraints = activeHardConstraints;
    let filteredBySizeWindow = activeHardSizeWindow;
    let failedSizeReasonablenessGuard = false;
    let styleFallbackStage: "none" | "origin_or_mood_family" | "style_dropped" =
      "none";
    let expandedDueToThinResults = false;
    let constraintMismatchActive = false;
    let unmetConstraints: string[] = [];
    let mismatchDisclosureHint: string | null = null;

    const hardFilterStart = Date.now();
    let candidates = filterByHardConstraints(
      inventory,
      activeHardConstraints,
      activeHardSizeWindow
    );
    timings.filter_hard_constraints_ms = Date.now() - hardFilterStart;

    if (candidates.length > 0 && requestedConstraints.size) {
      const reasonedCandidates = applyPreferSizeReasonablenessGuard(
        candidates,
        requestedConstraints
      );
      if (reasonedCandidates.length > 0) {
        candidates = reasonedCandidates;
      } else if (constraintStrictness(requestedConstraints, "size") !== "must") {
        candidates = [];
        failedSizeReasonablenessGuard = true;
      }
    }
    if (requestedConstraints.size) {
      const reasonablenessGate = failedSizeReasonablenessGuard ? "failed" : "passed";
      noMatchTrace = {
        ...noMatchTrace,
        reasonableness_gate: reasonablenessGate,
        reasonableness_gate_result: reasonablenessGate,
      };
    }

    if (
      candidates.length === 0 &&
      shouldAttemptClosestRelaxation({
        followupIntent,
        priorResultMode: input.priorResultMode ?? null,
        constraints: activeHardConstraints,
      })
    ) {
      const relaxed = applyClosestRelaxationLadder(
        inventory,
        activeHardConstraints
      );
      candidates = relaxed.candidates;
      relaxedToleranceIn = relaxed.relaxedToleranceIn;
      filteredByConstraints = relaxed.constraints;
      filteredBySizeWindow = null;
      broadeningApplied = true;
      broadeningStage = "size_relaxation_ladder";
    }

    let blockers: string[] = [];

    if (
      candidates.length === 0 &&
      Boolean(filteredByConstraints.styles && filteredByConstraints.styles.length > 0) &&
      constraintStrictness(filteredByConstraints, "styles") !== "must"
    ) {
      const styleFallback = applyStyleFallback({
        inventory,
        constraints: filteredByConstraints,
        sizeWindow: filteredBySizeWindow,
      });
      filteredByConstraints = styleFallback.constraints;
      candidates = styleFallback.candidates;
      styleFallbackStage = styleFallback.stage;
      broadeningApplied = styleFallback.stage !== "none" || broadeningApplied;
    }

    if (
      candidates.length === 0 &&
      Boolean(filteredByConstraints.size) &&
      canDropColors(filteredByConstraints)
    ) {
      const broadenedConstraints: HardConstraints = {
        ...filteredByConstraints,
        colors:
          constraintStrictness(filteredByConstraints, "colors") === "must"
            ? filteredByConstraints.colors
            : undefined,
      };
      const broadenedCandidates = filterByHardConstraints(
        inventory,
        broadenedConstraints
      );
      filteredByConstraints = broadenedConstraints;
      filteredBySizeWindow = null;
      candidates = broadenedCandidates;
      broadeningApplied = true;
      broadeningStage =
        broadeningStage === "size_relaxation_ladder"
          ? "size_relaxation_ladder_plus_color_style_relaxation"
          : "size_relaxation_ladder_plus_color_style_relaxation";
    }

    if (candidates.length > 0 && requestedConstraints.size) {
      const reasonedCandidates = applyPreferSizeReasonablenessGuard(
        candidates,
        requestedConstraints
      );
      if (reasonedCandidates.length > 0) {
        candidates = reasonedCandidates;
      } else if (constraintStrictness(requestedConstraints, "size") !== "must") {
        candidates = [];
        failedSizeReasonablenessGuard = true;
      }
    }

    if (
      candidates.length > 0 &&
      candidates.length < 4 &&
      Boolean(filteredByConstraints.styles && filteredByConstraints.styles.length > 0)
    ) {
      const styleRelaxedConstraints: HardConstraints = {
        ...filteredByConstraints,
        styles: undefined,
      };
      const widenedForThinResults = filterByHardConstraints(
        inventory,
        styleRelaxedConstraints,
        filteredBySizeWindow
      );
      if (widenedForThinResults.length > candidates.length) {
        candidates = widenedForThinResults;
        filteredByConstraints = styleRelaxedConstraints;
        expandedDueToThinResults = true;
        if (constraintStrictness(requestedConstraints, "styles") === "must") {
          constraintMismatchActive = true;
          unmetConstraints = Array.from(new Set([...unmetConstraints, "styles"]));
          mismatchDisclosureHint = buildMismatchDisclosureHint(
            unmetConstraints,
            requestedConstraints,
            findLargestAvailableSizeText(inventory)
          );
        }
        broadeningApplied = true;
        broadeningStage = "thin_results_style_relaxation";
      }
    }

    if (candidates.length === 0) {
      blockers = detectHardConstraintBlockers(
        inventory,
        filteredByConstraints,
        filteredBySizeWindow
      );
      if (failedSizeReasonablenessGuard && !blockers.includes("size")) {
        blockers = ["size", ...blockers];
      }
      unmetConstraints =
        blockers.length > 0
          ? blockers
          : listActiveConstraintKeys(filteredByConstraints);
      mismatchDisclosureHint = buildMismatchDisclosureHint(
        unmetConstraints,
        filteredByConstraints,
        findLargestAvailableSizeText(inventory)
      );

      let broadenedCandidates = inventory;
      if (
        broadenedCandidates.length === 0 ||
        Boolean(filteredBySizeWindow) ||
        colorSqlPrefilterTokens.length > 0
      ) {
        const broadInventory = await fetchInventoryCandidates({
          requestId,
          tenantId: input.tenantId,
          constraints: {},
          sizeWindow: null,
          limit: dynamicLimit,
          colorSqlPrefilterTokens: [],
          queryTrace,
        });
        if (broadInventory !== null) {
          broadenedCandidates = broadInventory;
        }
      }

      if (broadenedCandidates.length === 0) {
        const response: RecommendationResponse = {
          mode: "no_match",
          assistant_message:
            "I don't have enough inventory available right now to make a reliable recommendation.",
          questions: [],
          recommendations: [],
          notes: "INVENTORY_EMPTY",
        };
        noMatchTrace = {
          ...noMatchTrace,
          fallback_tier: "terminal",
          terminal_reason_code: "INVENTORY_EMPTY",
        };

        const logStart = Date.now();
        await logRecommendationQaEvent({
          request_id: requestId,
          tenant_id: input.tenantId,
          user_message: input.userMessage,
          constraints: requestedConstraints,
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
          constraints: requestedConstraints,
          prompt_context: input.promptContext ?? null,
          query_trace: queryTrace,
          dynamic_limit: dynamicLimit,
          policy_sql_filters: policySqlFilters,
          query_variant_reason: queryVariantReason,
          row_counts: summarizeQueryRows(queryTrace),
          discovery_mode: discoveryMode,
          color_sql_prefilter_tokens: colorSqlPrefilterTokens,
          broadening_applied: broadeningApplied,
          broadening_stage: broadeningStage,
          no_match: noMatchTrace,
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
            last_recommended_size_in: toRuntimeSizeIn(null),
            recently_shown_rugs: [],
          },
        };
      }

      candidates = broadenedCandidates;
      constraintMismatchActive = true;
      broadeningApplied = true;
      broadeningStage = "full_alternative_expansion";
      noMatchTrace = {
        ...noMatchTrace,
        fallback_tier: "expanded",
        terminal_reason_code: null,
      };
    }

    if (
      candidates.length > 0 &&
      requestedConstraints.shape &&
      !activeHardConstraints.shape
    ) {
      const shapeMatchedCandidates = filterByHardConstraints(candidates, {
        shape: requestedConstraints.shape,
      });
      if (shapeMatchedCandidates.length === 0) {
        constraintMismatchActive = true;
        unmetConstraints = Array.from(new Set([...unmetConstraints, "shape"]));
        mismatchDisclosureHint = buildMismatchDisclosureHint(
          unmetConstraints,
          requestedConstraints,
          findLargestAvailableSizeText(inventory)
        );
        broadeningApplied = true;
        if (broadeningStage === "none") {
          broadeningStage = "full_alternative_expansion";
        }
      }
    }

    if (
      candidates.length > 0 &&
      requestedConstraints.styles &&
      requestedConstraints.styles.length > 0 &&
      constraintStrictness(requestedConstraints, "styles") !== "must" &&
      !hasAnyStyleMatches(candidates, requestedConstraints.styles)
    ) {
      constraintMismatchActive = true;
      unmetConstraints = Array.from(new Set([...unmetConstraints, "styles"]));
      mismatchDisclosureHint = buildMismatchDisclosureHint(
        unmetConstraints,
        requestedConstraints,
        findLargestAvailableSizeText(inventory)
      );
    }

    if (candidates.length > 0) {
      const practicalPass = applyPracticalSuitabilityFilter({
        candidates,
        userMessage: input.userMessage,
        customerContext: input.promptContext?.chat_context?.customer_context ?? [],
      });
      if (practicalPass.practicalFilterApplied) {
        candidates = practicalPass.candidates;
      } else if (practicalPass.practicalUnmet) {
        constraintMismatchActive = true;
        unmetConstraints = Array.from(new Set([...unmetConstraints, "styles"]));
        mismatchDisclosureHint = buildMismatchDisclosureHint(
          unmetConstraints,
          requestedConstraints,
          findLargestAvailableSizeText(inventory)
        );
      }
    }

    if (candidates.length > 0) {
      const avoidStylePass = applyAvoidStylePreference({
        candidates,
        constraints: requestedConstraints,
      });
      if (avoidStylePass.avoidedStylesApplied) {
        candidates = avoidStylePass.candidates;
      } else if (avoidStylePass.avoidStylesUnmet) {
        constraintMismatchActive = true;
        unmetConstraints = Array.from(new Set([...unmetConstraints, "styles"]));
        mismatchDisclosureHint = buildMismatchDisclosureHint(
          unmetConstraints,
          requestedConstraints,
          findLargestAvailableSizeText(inventory)
        );
      }
    }

    if (candidates.length > 0) {
      const avoidColorPass = applyAvoidColorPreference({
        candidates,
        constraints: requestedConstraints,
      });
      if (avoidColorPass.avoidedColorsApplied) {
        candidates = avoidColorPass.candidates;
      } else if (avoidColorPass.avoidColorsUnmet) {
        constraintMismatchActive = true;
        unmetConstraints = Array.from(new Set([...unmetConstraints, "colors"]));
        mismatchDisclosureHint = buildMismatchDisclosureHint(
          unmetConstraints,
          requestedConstraints,
          findLargestAvailableSizeText(inventory)
        );
      }
    }

    if (
      candidates.length > 0 &&
      !hasDirectionalSizeCoverage({
        candidates,
        followupIntent: input.followupIntent ?? "none",
        anchorSize: input.lastRecommendedSizeIn ?? null,
      })
    ) {
      constraintMismatchActive = true;
      unmetConstraints = Array.from(new Set([...unmetConstraints, "size"]));
      mismatchDisclosureHint = buildMismatchDisclosureHint(
        unmetConstraints,
        requestedConstraints.size
          ? requestedConstraints
          : {
              ...requestedConstraints,
              size: toSizeConstraint(input.lastRecommendedSizeIn ?? null) ?? undefined,
            },
        findLargestAvailableSizeText(inventory)
      );
    }

    candidates = dedupeCandidatesByVisualSignature(candidates);

    const previouslyShownIds = new Set([
      ...(input.promptContext?.chat_context?.shown_rug_ids ?? []),
      ...(input.promptContext?.chat_context?.recently_shown_rugs ?? []).map(
        (rug) => rug.id
      ),
    ]);
    const explicitlyRequestedRepeat =
      /\b(show (me )?(that|those|same).*(again)|again please|same one|show it again)\b/i.test(
        input.userMessage
      );
    const isFollowupFlow = hasFollowupFlowIntent(input.followupIntent ?? "none");
    if (
      !explicitlyRequestedRepeat &&
      previouslyShownIds.size > 0 &&
      candidates.length > 0
    ) {
      const unseenCandidates = candidates.filter((rug) => !previouslyShownIds.has(rug.id));
      const shouldPreferUnseen = isFollowupFlow
        ? unseenCandidates.length > 0
        : unseenCandidates.length >= Math.min(4, candidates.length) ||
          (unseenCandidates.length > 0 && candidates.length > 12);
      if (
        shouldPreferUnseen
      ) {
        candidates = unseenCandidates;
      }
    }

    const shapeStart = Date.now();
    const aiCandidates = shapeCandidatesForAI(candidates, {
      maxCandidates: AI_CANDIDATE_LIMIT,
      userMessage: input.userMessage,
      customerContext: input.promptContext?.chat_context?.customer_context ?? [],
      constraints: requestedConstraints,
      followupIntent: input.followupIntent ?? "none",
      discoveryMode,
    });
    timings.shape_candidates_ms = Date.now() - shapeStart;

    const aiPromptContext = {
      ...input.promptContext,
      discovery_mode: discoveryMode,
      expanded_due_to_thin_results: expandedDueToThinResults,
      constraint_mismatch: constraintMismatchActive
        ? {
            expanded_from_zero_match: true,
            unmet_constraints: unmetConstraints,
            disclosure_hint: mismatchDisclosureHint,
          }
        : undefined,
    };

    const aiStart = Date.now();
    const response = await rankAndExplain(
      aiCandidates,
      requestedConstraints,
      input.userMessage,
      aiPromptContext,
      aiTrace
    );
    timings.rank_and_explain_ms = Date.now() - aiStart;
    const lastRecommendedSizeIn = findLastRecommendedSizeIn(
      response.recommendations,
      candidates
    );
    const recentlyShownRugs = findRecentlyShownRugs(
      response.recommendations,
      candidates
    );
    if (
      broadeningStage ===
      "size_relaxation_ladder_plus_color_style_relaxation"
    ) {
      response.notes = appendNotesCode(
        response.notes,
        BROADENED_NO_MATCH_NOTE_CODE
      );
    }
    if (styleFallbackStage === "origin_or_mood_family") {
      response.notes = appendNotesCode(response.notes, STYLE_RELAXATION_NOTE_CODE);
    } else if (styleFallbackStage === "style_dropped") {
      response.notes = appendNotesCode(response.notes, STYLE_DROPPED_NOTE_CODE);
    }
    const sizeRelaxationCode = sizeRelaxationDisclosureCode(relaxedToleranceIn);
    if (sizeRelaxationCode) {
      response.notes = appendNotesCode(response.notes, sizeRelaxationCode);
    }
    if (constraintMismatchActive) {
      response.notes = appendNotesCode(
        response.notes,
        CONSTRAINT_MISMATCH_EXPANDED_NOTE_CODE
      );
    }
    if (expandedDueToThinResults) {
      response.notes = appendNotesCode(
        response.notes,
        THIN_RESULTS_STYLE_EXPANDED_NOTE_CODE
      );
    }

    const logStart = Date.now();
    await logRecommendationQaEvent({
      request_id: requestId,
      tenant_id: input.tenantId,
      user_message: input.userMessage,
      constraints: requestedConstraints,
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
      constraints: requestedConstraints,
      prompt_context: aiPromptContext ?? null,
      query_trace: queryTrace,
      dynamic_limit: dynamicLimit,
      policy_sql_filters: policySqlFilters,
      query_variant_reason: queryVariantReason,
      row_counts: summarizeQueryRows(queryTrace),
      discovery_mode: discoveryMode,
      color_sql_prefilter_tokens: colorSqlPrefilterTokens,
      broadening_applied: broadeningApplied,
      broadening_stage: broadeningStage,
      no_match: noMatchTrace,
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
        last_recommended_size_in: toRuntimeSizeIn(lastRecommendedSizeIn),
        recently_shown_rugs: recentlyShownRugs,
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
      dynamic_limit: dynamicLimit,
      policy_sql_filters: policySqlFilters,
      query_variant_reason: queryVariantReason,
      row_counts: summarizeQueryRows(queryTrace),
      discovery_mode: discoveryMode,
      color_sql_prefilter_tokens: colorSqlPrefilterTokens,
      broadening_applied: broadeningApplied,
      broadening_stage: broadeningStage,
      no_match: noMatchTrace,
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
  priorResultMode:
    | "recommendation"
    | "no_match"
    | "clarifying_question"
    | "disambiguation"
    | null;
  constraints: HardConstraints;
}): boolean {
  if (!input.constraints.size) return false;
  if (input.followupIntent === "closest") {
    return true;
  }
  if (input.followupIntent === "larger" || input.followupIntent === "smaller") {
    return input.priorResultMode === "no_match";
  }
  return false;
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

  let lastTriedConstraints = constraints;
  for (const tolerance of SIZE_RELAXATION_STEPS_IN) {
    const nextConstraints: HardConstraints = {
      ...constraints,
      size: {
        ...constraints.size,
        toleranceIn: tolerance,
      },
    };
    lastTriedConstraints = nextConstraints;
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
    constraints: lastTriedConstraints,
    candidates: [],
    relaxedToleranceIn: SIZE_RELAXATION_STEPS_IN[SIZE_RELAXATION_STEPS_IN.length - 1],
  };
}

function detectHardConstraintBlockers(
  inventory: InventoryRug[],
  constraints: HardConstraints,
  sizeWindow?: SizeWindow | null
): string[] {
  const blockers: string[] = [];
  const activeKeys: Array<keyof HardConstraints> = [];
  if (constraints.size) activeKeys.push("size");
  if (constraints.colors && constraints.colors.length > 0) activeKeys.push("colors");
  if (constraints.styles && constraints.styles.length > 0) activeKeys.push("styles");
  if (constraints.shape) activeKeys.push("shape");

  if (activeKeys.length === 0) return blockers;

  const baseline = filterByHardConstraints(inventory, constraints, sizeWindow);
  if (baseline.length > 0) return blockers;

  for (const key of activeKeys) {
    const relaxed: HardConstraints = {
      ...constraints,
      [key]: undefined,
    };
    const relaxedSizeWindow = key === "size" ? null : sizeWindow ?? null;
    const relaxedMatches = filterByHardConstraints(
      inventory,
      relaxed,
      relaxedSizeWindow
    );
    if (relaxedMatches.length > 0) {
      blockers.push(key);
    }
  }

  return blockers;
}

function blockerLabel(blocker: string): string {
  if (blocker === "colors") return "color";
  if (blocker === "styles") return "style";
  if (blocker === "shape") return "shape";
  return blocker;
}

function listActiveConstraintKeys(constraints: HardConstraints): string[] {
  const keys: string[] = [];
  if (constraints.size) keys.push("size");
  if (constraints.colors && constraints.colors.length > 0) keys.push("colors");
  if (constraints.styles && constraints.styles.length > 0) keys.push("styles");
  if (constraints.shape) keys.push("shape");
  return keys;
}

function findLargestAvailableSizeText(inventory: InventoryRug[]): string | null {
  let largest: { width: number; length: number; area: number } | null = null;
  for (const rug of inventory) {
    if (
      typeof rug.width_total_in !== "number" ||
      typeof rug.length_total_in !== "number"
    ) {
      continue;
    }
    const area = rug.width_total_in * rug.length_total_in;
    if (!largest || area > largest.area) {
      largest = {
        width: rug.width_total_in,
        length: rug.length_total_in,
        area,
      };
    }
  }
  if (!largest) return null;
  return formatRugSize(largest.width, largest.length);
}

function buildMismatchDisclosureHint(
  unmetConstraints: string[],
  constraints: HardConstraints,
  largestAvailableSizeText?: string | null
): string | null {
  if (unmetConstraints.length === 0) return null;
  if (unmetConstraints.includes("shape")) {
    if (constraints.shape === "runner") {
      return "We don't have any runners in the collection right now, so I'm showing the closest alternatives that could still work for a long, narrow space.";
    }
    if (constraints.shape === "round_oval") {
      return "We don't have round or oval rugs that match this request right now, so I'm showing the closest alternatives available.";
    }
    return "We don't have rugs in that requested shape right now, so I'm showing the closest alternatives available.";
  }
  if (unmetConstraints.includes("size") && constraints.size) {
    const requestedLongSide = Math.max(
      constraints.size.widthIn,
      constraints.size.lengthIn
    );
    const requestedText = formatRugSize(
      constraints.size.widthIn,
      constraints.size.lengthIn
    );
    if (requestedLongSide > MAX_REASONABLE_REQUEST_LONG_SIDE_IN) {
      return largestAvailableSizeText
        ? `We don't carry rugs at that scale. Our largest available pieces are around ${largestAvailableSizeText}, so I'm showing the biggest realistic alternatives.`
        : "We don't carry rugs at that scale, so I'm showing the biggest realistic alternatives available.";
    }
    return `We don't have an exact ${requestedText} match right now, so I'm showing the closest available alternatives.`;
  }
  if (
    unmetConstraints.includes("styles") &&
    constraints.styles &&
    constraints.styles.length > 0
  ) {
    return `We don't have exact ${constraints.styles.join(", ")} matches right now, so I'm showing the closest available alternatives.`;
  }
  if (
    unmetConstraints.includes("colors") &&
    constraints.colors &&
    constraints.colors.length > 0
  ) {
    return `We don't have exact ${constraints.colors.join(", ")} color matches right now, so I'm showing the closest available alternatives.`;
  }
  return "We don't have exact matches for all requested preferences right now, so I'm showing the closest available alternatives.";
}

function findLastRecommendedSizeIn(
  recommendations: RecommendationResponse["recommendations"],
  candidates: InventoryRug[]
): RecommendationSizeIn | null {
  for (const recommendation of recommendations) {
    const candidate = candidates.find((rug) => rug.id === recommendation.rug_id);
    if (
      candidate &&
      typeof candidate.width_total_in === "number" &&
      typeof candidate.length_total_in === "number"
    ) {
      return {
        width_in: candidate.width_total_in,
        length_in: candidate.length_total_in,
      };
    }
  }

  return null;
}

function findRecentlyShownRugs(
  recommendations: RecommendationResponse["recommendations"],
  candidates: InventoryRug[]
): Array<{
  id: string;
  label: string;
  colors: string[];
  style: string | null;
  origin: string | null;
}> {
  const byId = new Map(candidates.map((rug) => [rug.id, rug]));
  const output: Array<{
    id: string;
    label: string;
    colors: string[];
    style: string | null;
    origin: string | null;
  }> = [];

  for (const recommendation of recommendations) {
    const rug = byId.get(recommendation.rug_id);
    if (!rug) continue;
    const fields = rug.effective_fields ?? null;
    output.push({
      id: recommendation.rug_id,
      label: recommendation.title,
      colors:
        Array.isArray(fields?.primary_colors) &&
        fields.primary_colors.length > 0
          ? fields.primary_colors.slice(0, 6)
          : [],
      style: recommendation.style ?? fields?.style ?? null,
      origin: recommendation.origin ?? fields?.origin ?? null,
    });
  }

  return output.slice(0, 10);
}

async function countRoughInventorySize(
  tenantId: string
): Promise<number | null> {
  const supabase = await getSupabaseAdminSafe();
  if (!supabase) return null;

  const result = await supabase
    .from("rugs")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .eq("status", "available")
    .eq("enrichment_status", "ready");

  if (result.error) {
    return null;
  }

  return result.count ?? null;
}

async function fetchInventoryCandidates(input: {
  requestId: string;
  tenantId: string;
  constraints: HardConstraints;
  sizeWindow: SizeWindow | null;
  limit: number;
  colorSqlPrefilterTokens: string[];
  queryTrace: PipelineQueryTrace[];
}): Promise<InventoryRug[] | null> {
  const supabase = await getSupabaseAdminSafe();
  if (!supabase) return null;

  const variants = buildQueryVariants({
    hasSize: Boolean(input.sizeWindow || input.constraints.size),
  });

  const results = await Promise.all(
    variants.map((variant) =>
      runCandidateQuery({
        supabase,
        tenantId: input.tenantId,
        limit: input.limit,
        sizeWindow: input.sizeWindow,
        colorSqlPrefilterTokens: input.colorSqlPrefilterTokens,
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
      rug.staff_overrides ?? null,
      rug.ai_description ?? null
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

function describeQueryVariantReason(input: {
  variant: "base" | "size_direct" | "size_rotated";
  sizeWindow: SizeWindow | null;
}): string {
  if (input.variant === "base") {
    return "no_size_window_base_query";
  }
  if (input.variant === "size_rotated") {
    return input.sizeWindow
      ? "size_window_rotated_dimensions_query"
      : "size_query_without_window_rotated";
  }
  return input.sizeWindow
    ? "size_window_direct_dimensions_query"
    : "size_query_without_window_direct";
}

async function runCandidateQuery(input: {
  supabase: SupabaseClient;
  tenantId: string;
  limit: number;
  sizeWindow: SizeWindow | null;
  colorSqlPrefilterTokens: string[];
  variant: "base" | "size_direct" | "size_rotated";
  queryTrace: PipelineQueryTrace[];
}): Promise<InventoryRug[] | null> {
  const bounds = input.sizeWindow;
  const wantsSize = input.variant !== "base";
  const rotated = input.variant === "size_rotated";
  const queryVariantReason = describeQueryVariantReason({
    variant: input.variant,
    sizeWindow: input.sizeWindow,
  });

  const buildQuery = (selectColumns: string, enforceImageJoin: boolean) => {
    const projectedColumns = enforceImageJoin
      ? `${selectColumns}, rug_images!inner(path)`
      : selectColumns;
    let query = input.supabase
      .from("rugs")
      .select(projectedColumns)
      .eq("status", "available")
      .eq("enrichment_status", "ready")
      .order("id", { ascending: true })
      .limit(input.limit);

    query = query.eq("tenant_id", input.tenantId);
    if (enforceImageJoin) {
      query = query.not("rug_images.path", "is", null).neq("rug_images.path", "");
    }

    if (wantsSize && bounds) {
      const widthMin = rotated ? bounds.minLengthIn : bounds.minWidthIn;
      const widthMax = rotated ? bounds.maxLengthIn : bounds.maxWidthIn;
      const lengthMin = rotated ? bounds.minWidthIn : bounds.minLengthIn;
      const lengthMax = rotated ? bounds.maxWidthIn : bounds.maxLengthIn;

      if (typeof widthMin === "number") query = query.gte("width_total_in", widthMin);
      if (typeof widthMax === "number") query = query.lte("width_total_in", widthMax);
      if (typeof lengthMin === "number") query = query.gte("length_total_in", lengthMin);
      if (typeof lengthMax === "number") query = query.lte("length_total_in", lengthMax);
    }

    if (input.colorSqlPrefilterTokens.length > 0) {
      const terms = input.colorSqlPrefilterTokens
        .map((token) => token.trim().toLowerCase())
        .filter((token) => token.length > 0)
        .slice(0, 10)
        .flatMap((token) => [
          `ai_structured_fields->primary_colors.cs.[\"${token}\"]`,
          `staff_overrides->primary_colors.cs.[\"${token}\"]`,
          `ai_description.ilike.*${token}*`,
          `intake_label.ilike.*${token}*`,
        ]);

      if (terms.length > 0) {
        query = query.or(terms.join(","));
      }
    }

    return query;
  };

  const selectCandidates = [
    "id, tenant_id, intake_label, status, enrichment_status, review_reason_code, width_total_in, length_total_in, ai_description, ai_structured_fields, staff_overrides",
    "id, tenant_id, intake_label, status, enrichment_status, review_reason_code, width_total_in, length_total_in, ai_description, ai_structured_fields",
    "id, tenant_id, intake_label, status, enrichment_status, review_reason_code, width_total_in, length_total_in, ai_description",
  ];

  let imageJoinEnforced = true;
  let queryResult = await buildQuery(selectCandidates[0], true);
  for (const selectColumns of selectCandidates.slice(1)) {
    if (!queryResult.error) break;
    if (!isLikelyMissingColumnError(queryResult.error.message ?? "")) break;
    queryResult = await buildQuery(selectColumns, true);
  }

  if (
    queryResult.error &&
    /relationship|foreign key|rug_images|path/i.test(queryResult.error.message ?? "")
  ) {
    imageJoinEnforced = false;
    queryResult = await buildQuery(selectCandidates[0], false);
    for (const selectColumns of selectCandidates.slice(1)) {
      if (!queryResult.error) break;
      if (!isLikelyMissingColumnError(queryResult.error.message ?? "")) break;
      queryResult = await buildQuery(selectColumns, false);
    }
  }

  const { data, error } = queryResult;
  if (error || !Array.isArray(data)) {
    input.queryTrace.push({
      variant: input.variant,
      query_variant_reason: queryVariantReason,
      filters: {
        tenant_id: input.tenantId,
        status: "available",
        enrichment_status: "ready",
        limit: input.limit,
        size_bounds: bounds ? { ...bounds, rotated } : null,
        color_prefilter_active: input.colorSqlPrefilterTokens.length > 0,
        image_sql_filter_active: imageJoinEnforced,
        color_prefilter:
          input.colorSqlPrefilterTokens.length > 0 ? "active" : "inactive",
        color_prefilter_state:
          input.colorSqlPrefilterTokens.length > 0 ? "active" : "inactive",
        color_sql_prefilter_tokens:
          input.colorSqlPrefilterTokens.length > 0
            ? input.colorSqlPrefilterTokens
            : null,
      },
      row_count: 0,
      error: error?.message ?? "Unknown query failure",
    });
    return null;
  }

  input.queryTrace.push({
    variant: input.variant,
    query_variant_reason: queryVariantReason,
    filters: {
      tenant_id: input.tenantId,
      status: "available",
      enrichment_status: "ready",
      limit: input.limit,
      size_bounds: bounds ? { ...bounds, rotated } : null,
      color_prefilter_active: input.colorSqlPrefilterTokens.length > 0,
      image_sql_filter_active: imageJoinEnforced,
      color_prefilter:
        input.colorSqlPrefilterTokens.length > 0 ? "active" : "inactive",
      color_prefilter_state:
        input.colorSqlPrefilterTokens.length > 0 ? "active" : "inactive",
      color_sql_prefilter_tokens:
        input.colorSqlPrefilterTokens.length > 0
          ? input.colorSqlPrefilterTokens
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
