import { runRecommendationPipeline } from "@/lib/recommend/pipeline";
import { hasTenantId } from "@/lib/auth/tenant";
import { parseRecommendationFollowupIntent } from "@/lib/chat/router";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { fetchPrimaryRugImagesForRugs } from "@/lib/storage/rug-images";
import { parseRugRecord } from "@/lib/inventory/rug-record";
import { resolveEffectiveFields } from "@/lib/inventory/resolve-fields";
import { formatRugSize } from "@/lib/utils/format";
import type {
  ChatTurnHandlerInput,
  RecommendationTurnResponse,
} from "@/lib/chat/types";

async function hydrateDisambiguationRecommendations(input: {
  tenantId: string;
  candidates: Array<{
    id: string;
    label: string;
    colors: string[];
    style: string | null;
    origin: string | null;
  }>;
}): Promise<RecommendationTurnResponse["recommendations"]> {
  const ids = input.candidates.map((candidate) => candidate.id);
  if (ids.length === 0) return [];

  const { data, error } = await supabaseAdmin
    .from("rugs")
    .select(
      "id, tenant_id, intake_label, status, width_total_in, length_total_in, ai_description, ai_structured_fields, staff_overrides, enrichment_status, review_reason_code"
    )
    .eq("tenant_id", input.tenantId)
    .in("id", ids);

  const parsedRows = Array.isArray(data) && !error
    ? data
        .map((row) => parseRugRecord(row))
        .filter((row): row is NonNullable<ReturnType<typeof parseRugRecord>> => row !== null)
    : [];

  const byId = new Map(parsedRows.map((row) => [row.id, row]));
  const imageMap = await fetchPrimaryRugImagesForRugs({
    supabase: supabaseAdmin,
    tenantId: input.tenantId,
    rugIds: ids,
  });

  return input.candidates.slice(0, 3).map((candidate) => {
    const row = byId.get(candidate.id);
    const effectiveFields = row
      ? resolveEffectiveFields(
          row.intake_label,
          row.ai_structured_fields,
          row.staff_overrides,
          row.ai_description
        )
      : null;
    const image = imageMap.get(candidate.id);
    return {
      rug_id: candidate.id,
      sku: null,
      title:
        effectiveFields?.label ??
        row?.intake_label ??
        candidate.label,
      origin: effectiveFields?.origin ?? candidate.origin ?? null,
      style: effectiveFields?.style ?? candidate.style ?? null,
      mood: effectiveFields?.mood ?? null,
      primary_image_url: image?.primary_image_url ?? null,
      primary_image_caption: image?.primary_image_caption ?? null,
      size_text:
        row &&
        typeof row.width_total_in === "number" &&
        typeof row.length_total_in === "number"
          ? formatRugSize(row.width_total_in, row.length_total_in)
          : null,
      match_reasons: ["Please confirm which rug you meant."],
      confidence: 0.6,
      confidence_tier: "medium" as const,
      confidence_factors: ["Reference clarification requested"],
      why_not: [],
    };
  });
}

function buildDisambiguationChoiceLabel(
  candidate: {
    label: string;
    colors: string[];
    style: string | null;
    origin: string | null;
  },
  duplicateLabelCount: number
): string {
  const base = candidate.label.trim();
  if (duplicateLabelCount <= 1) return base;
  const detailParts = [
    candidate.style,
    candidate.origin,
    candidate.colors[0] ?? null,
  ].filter((value): value is string => Boolean(value && value.trim().length > 0));
  if (detailParts.length === 0) return base;
  return `${base} (${detailParts.join(", ")})`;
}

// Recommendation mode handler now uses the shared SQL-first backend pipeline.
export async function handleRecommendationTurn(
  input: ChatTurnHandlerInput
): Promise<RecommendationTurnResponse> {
  if (input.rug_reference_ambiguous) {
    const ambiguousCandidates =
      input.session.recommendation_state.runtime?.recently_shown_rugs?.slice(0, 3) ?? [];
    if (ambiguousCandidates.length > 0) {
      const duplicateCount = new Map<string, number>();
      for (const rug of ambiguousCandidates) {
        const key = rug.label.trim().toLowerCase();
        duplicateCount.set(key, (duplicateCount.get(key) ?? 0) + 1);
      }
      const labelText = ambiguousCandidates
        .map((rug) =>
          buildDisambiguationChoiceLabel(
            rug,
            duplicateCount.get(rug.label.trim().toLowerCase()) ?? 1
          )
        )
        .join(" or ");
      const normalizedMessage = input.message.toLowerCase();
      const hasRefinementAsk =
        /\b(bigger|larger|smaller|shorter|different color|another color|more like|less busy|cleaner)\b/.test(
          normalizedMessage
        );
      const hydratedRecommendations = hasTenantId(input.tenant_id)
        ? await hydrateDisambiguationRecommendations({
            tenantId: input.tenant_id,
            candidates: ambiguousCandidates,
          })
        : [];
      return {
        mode: "disambiguation",
        assistant_message: hasRefinementAsk
          ? `I can do that next. First, I want to make sure I’m following correctly: did you mean ${labelText}?`
          : `I want to make sure I’m following correctly. Did you mean ${labelText}?`,
        questions: [],
        recommendations:
          hydratedRecommendations.length > 0
            ? hydratedRecommendations
            : ambiguousCandidates.map((rug) => ({
                rug_id: rug.id,
                sku: null,
                title: rug.label,
                origin: rug.origin ?? null,
                style: rug.style ?? null,
                mood: null,
                primary_image_url: null,
                primary_image_caption: null,
                size_text: null,
                match_reasons: ["Please confirm which rug you meant."],
                confidence: 0.6,
                confidence_tier: "medium",
                confidence_factors: ["Reference clarification requested"],
                why_not: [],
              })),
        notes: "RUG_REFERENCE_DISAMBIGUATION",
        runtime_update: {
          recently_shown_rugs: ambiguousCandidates,
          liked_attributes:
            input.session.recommendation_state.runtime?.liked_attributes ?? {
              colors: [],
              styles: [],
              origins: [],
            },
          liked_rug_ids:
            input.session.recommendation_state.runtime?.liked_rug_ids ?? [],
          dismissed_rug_ids:
            input.session.recommendation_state.runtime?.dismissed_rug_ids ?? [],
          shown_rug_ids:
            input.session.recommendation_state.runtime?.shown_rug_ids ?? [],
        },
      };
    }
  }

  const promptRole = input.role === "developer" ? "store_staff" : input.role;

  const constraints = input.session.recommendation_state.hard_constraints;
  const followupIntent =
    input.followup_intent ??
    parseRecommendationFollowupIntent(input.message.toLowerCase().trim());
  const priorResultMode = input.session.recommendation_state.runtime?.last_result_mode ?? null;
  const noMatchAttempts = Math.max(
    input.session.conversation_memory.no_match_attempts ?? 0,
    input.session.recommendation_state.runtime?.no_match_attempts ?? 0
  );
  const lastRecommendedSizeIn =
    input.session.recommendation_state.runtime?.last_recommended_size_in ?? null;

  if (!hasTenantId(input.tenant_id)) {
    return {
      mode: "no_match",
      assistant_message:
        "I need tenant context before I can query inventory recommendations.",
      questions: [],
      recommendations: [],
      notes: "TENANT_CONTEXT_REQUIRED",
    };
  }

  const result = await runRecommendationPipeline({
    tenantId: input.tenant_id,
    userMessage: input.message.trim(),
    constraints,
    followupIntent,
    priorResultMode,
    noMatchAttempts,
    lastRecommendedSizeIn,
    constraintConfidence: input.constraint_confidence ?? "low",
    discoveryRequested: Boolean(input.is_discovery_turn),
    promptContext: {
      role: promptRole,
      chat_context: input.ai_context_packet
        ? {
            structured_state: input.ai_context_packet.structured_state,
            conversation_memory: input.ai_context_packet.conversation_memory,
            customer_context: input.ai_context_packet.customer_context,
            recently_shown_rugs: input.ai_context_packet.recently_shown_rugs,
            shown_rug_ids: input.ai_context_packet.shown_rug_ids,
            liked_attributes: input.ai_context_packet.liked_attributes,
            recent_turns: input.ai_context_packet.recent_turns,
          }
        : undefined,
    },
    traceMeta: input.trace_meta
      ? {
          ...input.trace_meta,
          source_route: "/api/chat",
          session_id: input.session.session_id,
          role: promptRole,
        }
      : undefined,
  });

  if (!result.ok) {
    return {
      mode: "no_match",
      assistant_message:
        "I could not access inventory right now, so I can’t return reliable recommendations yet.",
      questions: ["Would you like to try again in a moment?"],
      recommendations: [],
      notes: `RECOMMENDATION_HANDLER_FALLBACK: ${result.error}`,
    };
  }

  const aiResponse = result.response;
  const recentlyShownRugs = result.meta?.recently_shown_rugs ?? [];
  const previousLikedAttributes =
    input.session.recommendation_state.runtime?.liked_attributes;
  const previousShownRugIds =
    input.session.recommendation_state.runtime?.shown_rug_ids ?? [];
  const requestedColors = input.session.recommendation_state.hard_constraints.colors ?? [];
  const requestedStyles = input.session.recommendation_state.hard_constraints.styles ?? [];
  const uniqueLower = (values: string[], maxItems = 8) =>
    Array.from(
      new Set(
        values
          .map((value) => value.trim().toLowerCase())
          .filter((value) => value.length > 0)
      )
    ).slice(0, maxItems);

  return {
    ...aiResponse,
    mode:
      aiResponse.mode === "recommendations"
        ? "recommendation"
        : aiResponse.mode,
    runtime_update: {
      relaxed_size_tolerance_in:
        result.meta?.relaxed_size_tolerance_in ?? null,
      blockers: result.meta?.blockers ?? [],
      ...(result.meta?.last_recommended_size_in
        ? {
            last_recommended_size_in: result.meta.last_recommended_size_in,
          }
        : {}),
      recently_shown_rugs: recentlyShownRugs.slice(0, 10),
      liked_attributes: {
        colors: uniqueLower([
          ...(previousLikedAttributes?.colors ?? []),
          ...requestedColors,
        ]),
        styles: uniqueLower([
          ...(previousLikedAttributes?.styles ?? []),
          ...requestedStyles,
        ]),
        origins: uniqueLower(previousLikedAttributes?.origins ?? []),
      },
      shown_rug_ids: uniqueLower([
        ...previousShownRugIds,
        ...recentlyShownRugs.map((rug) => rug.id),
      ], 80),
      liked_rug_ids:
        input.session.recommendation_state.runtime?.liked_rug_ids ?? [],
      dismissed_rug_ids:
        input.session.recommendation_state.runtime?.dismissed_rug_ids ?? [],
    },
  };
}
