import { runRecommendationPipeline } from "@/lib/recommend/pipeline";
import { hasTenantId } from "@/lib/auth/tenant";
import { parseRecommendationFollowupIntent } from "@/lib/chat/router";
import type {
  ChatTurnHandlerInput,
  RecommendationTurnResponse,
} from "@/lib/chat/types";

// Recommendation mode handler now uses the shared SQL-first backend pipeline.
export async function handleRecommendationTurn(
  input: ChatTurnHandlerInput
): Promise<RecommendationTurnResponse> {
  if (input.rug_reference_ambiguous) {
    const ambiguousCandidates =
      input.session.recommendation_state.runtime?.recently_shown_rugs?.slice(0, 3) ?? [];
    if (ambiguousCandidates.length > 0) {
      const labelText = ambiguousCandidates.map((rug) => rug.label).join(" or ");
      return {
        mode: "disambiguation",
        assistant_message: `I want to make sure I’m following correctly. Did you mean ${labelText}?`,
        questions: [],
        recommendations: ambiguousCandidates.map((rug) => ({
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
      liked_rug_ids:
        input.session.recommendation_state.runtime?.liked_rug_ids ?? [],
      dismissed_rug_ids:
        input.session.recommendation_state.runtime?.dismissed_rug_ids ?? [],
    },
  };
}
