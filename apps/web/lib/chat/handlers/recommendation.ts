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
  const parsedFollowupIntent =
    input.followup_intent ??
    parseRecommendationFollowupIntent(input.message.toLowerCase().trim());
  let followupIntent = parsedFollowupIntent;
  const explicitReferenceSignal =
    /\b(more like|like (this|that|the)|same one|similar to)\b/i.test(
      input.message
    );
  if (
    followupIntent === "none" &&
    /\b(show me more|more like|similar to|like (the|this|that)|same direction)\b/i.test(
      input.message
    )
  ) {
    followupIntent = "more_like_this";
  }

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
        /\b(bigger|larger|smaller|shorter|different color|another color|more like|less busy|cleaner|not that color|color direction|pattern but not)\b/.test(
          normalizedMessage
        );
      const hasColorReferenceCue =
        /\b(the\s+(rust|red|blue|teal|green|ivory|gold|pink|purple|brown|gray|black|white)\s+one)\b/.test(
          normalizedMessage
        );
      const shouldProceedWithoutDisambiguation =
        (hasRefinementAsk && parsedFollowupIntent !== "none") ||
        hasColorReferenceCue ||
        (input.parsed_intent === "reaction" && hasRefinementAsk);
      if (shouldProceedWithoutDisambiguation) {
        // Continue into the recommendation pipeline so refinement turns can progress
        // instead of looping in repeated disambiguation.
      } else {
      const hydratedRecommendations = hasTenantId(input.tenant_id)
        ? await hydrateDisambiguationRecommendations({
            tenantId: input.tenant_id,
            candidates: ambiguousCandidates,
          })
        : [];
      return {
        mode: "disambiguation",
        assistant_message: hasRefinementAsk
          ? `I can do that next. For now I only have these same options in view until we confirm which rug you mean: did you mean ${labelText}?`
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
  }

  const promptRole = input.role === "developer" ? "store_staff" : input.role;

  let constraints = input.session.recommendation_state.hard_constraints;
  const cleanDirectionSignal = /\b(cleanest|cleaner|calmer|less busy|more like)\b/i.test(
    input.message
  );
  const runtimeLiked = input.session.recommendation_state.runtime?.liked_attributes;
  const referencedRug =
    input.referenced_rug_id &&
    input.session.recommendation_state.runtime?.recently_shown_rugs
      ? input.session.recommendation_state.runtime.recently_shown_rugs.find(
          (rug) => rug.id === input.referenced_rug_id
        ) ?? null
      : null;
  const lessLightDirection =
    /\b(less light colors|not light|no light colors|darker tones|deeper tones)\b/i.test(
      input.message
    );
  const colorDirectionPivot =
    /\b(not that color|different color|new color direction|shift color|another color)\b/i.test(
      input.message
    );
  if (lessLightDirection) {
    const existingAvoid = (
      constraints.avoid_preferences?.colors ?? []
    ).map((color) => color.trim().toLowerCase());
    const mergedAvoid = Array.from(new Set([...existingAvoid, "ivory", "white"]));
    constraints = {
      ...constraints,
      avoid_preferences: {
        ...(constraints.avoid_preferences ?? {}),
        colors: mergedAvoid,
      },
      strictness: {
        ...constraints.strictness,
        colors: "prefer",
      },
    };
  }
  if (colorDirectionPivot) {
    const recentShownColors = (
      input.session.recommendation_state.runtime?.recently_shown_rugs ?? []
    )
      .flatMap((rug) => rug.colors ?? [])
      .map((color) => color.trim().toLowerCase())
      .filter((color) => color.length > 0)
      .slice(0, 8);
    if (recentShownColors.length > 0) {
      const currentAvoidColors = (
        constraints.avoid_preferences?.colors ?? []
      ).map((color) => color.trim().toLowerCase());
      const mergedAvoidColors = Array.from(
        new Set([...currentAvoidColors, ...recentShownColors])
      );
      const currentColors = (constraints.colors ?? [])
        .map((color) => color.trim().toLowerCase())
        .filter((color) => color.length > 0);
      constraints = {
        ...constraints,
        colors: currentColors.filter((color) => !mergedAvoidColors.includes(color)),
        avoid_preferences: {
          ...(constraints.avoid_preferences ?? {}),
          colors: mergedAvoidColors,
        },
        strictness: {
          ...constraints.strictness,
          colors: "prefer",
        },
      };
    }
    if ((constraints.styles?.length ?? 0) === 0) {
      const recentStyles = Array.from(
        new Set(
          (input.session.recommendation_state.runtime?.recently_shown_rugs ?? [])
            .map((rug) => rug.style?.trim().toLowerCase() ?? "")
            .filter((style) => style.length > 0)
        )
      ).slice(0, 2);
      if (recentStyles.length > 0) {
        constraints = {
          ...constraints,
          styles: recentStyles,
          strictness: {
            ...(constraints.strictness ?? {}),
            styles: constraints.strictness?.styles ?? "prefer",
          },
        };
      }
    }
  }
  if (cleanDirectionSignal) {
    const referenceStyle =
      referencedRug?.style && referencedRug.style.trim().length > 0
        ? referencedRug.style.trim().toLowerCase()
        : null;
    const cleanDirectionStyles: string[] =
      (constraints.styles?.length ?? 0) > 0
        ? [...(constraints.styles ?? [])]
        : ["modern", "contemporary", "minimal", "transitional"];
    if (referenceStyle && !cleanDirectionStyles.includes(referenceStyle)) {
      cleanDirectionStyles.unshift(referenceStyle);
    }
    const normalizedCleanStyles = cleanDirectionStyles.map((style) =>
      style.trim().toLowerCase()
    );
    const hasExplicitModernDirection = normalizedCleanStyles.some((style) =>
      ["modern", "contemporary", "minimal", "minimalist"].includes(style)
    );
    constraints = {
      ...constraints,
      styles: cleanDirectionStyles,
      strictness: {
        ...(constraints.strictness ?? {}),
        styles: hasExplicitModernDirection ? "must" : "prefer",
      },
    };
  }
  const shouldCarryLikedDirection =
    (followupIntent !== "none" ||
      input.parsed_intent === "followup" ||
      input.parsed_intent === "reaction") &&
    !/\b(show me what you have|show me what you've got|just browsing|surprise me|anything)\b/i.test(
      input.message
    );
  if (shouldCarryLikedDirection) {
    const likedStyles = (runtimeLiked?.styles ?? [])
      .map((style) => style.trim().toLowerCase())
      .filter((style) => style.length > 0)
      .slice(0, 2);
    const likedColors = (runtimeLiked?.colors ?? [])
      .map((color) => color.trim().toLowerCase())
      .filter((color) => color.length > 0)
      .slice(0, 2);
    if ((constraints.styles?.length ?? 0) === 0 && likedStyles.length > 0) {
      constraints = {
        ...constraints,
        styles: likedStyles,
        strictness: {
          ...(constraints.strictness ?? {}),
          styles: constraints.strictness?.styles ?? "prefer",
        },
      };
    }
    if (!colorDirectionPivot && (constraints.colors?.length ?? 0) === 0 && likedColors.length > 0) {
      constraints = {
        ...constraints,
        colors: likedColors,
        strictness: {
          ...(constraints.strictness ?? {}),
          colors: constraints.strictness?.colors ?? "prefer",
        },
      };
    }
  }
  if (
    referencedRug &&
    (input.parsed_intent === "reaction" || followupIntent === "more_like_this")
  ) {
    const styleFromReference =
      referencedRug.style && referencedRug.style.trim().length > 0
        ? referencedRug.style.trim().toLowerCase()
        : null;
    const colorsFromReference = (referencedRug.colors ?? [])
      .map((color) => color.trim().toLowerCase())
      .filter((color) => color.length > 0)
      .slice(0, 2);
    const keepCurrentColorDirection =
      colorDirectionPivot ||
      /\b(different color|another color|new color|not that color)\b/i.test(
        input.message
      );
    constraints = {
      ...constraints,
      styles:
        (constraints.styles?.length ?? 0) > 0
          ? constraints.styles
          : styleFromReference
            ? [styleFromReference]
            : constraints.styles,
      colors:
        keepCurrentColorDirection || (constraints.colors?.length ?? 0) > 0
          ? constraints.colors
          : colorsFromReference.length > 0
            ? colorsFromReference
            : constraints.colors,
      strictness: {
        ...(constraints.strictness ?? {}),
        styles:
          (constraints.styles?.length ?? 0) > 0 || !styleFromReference
            ? constraints.strictness?.styles ?? "prefer"
            : "prefer",
        colors:
          keepCurrentColorDirection || (constraints.colors?.length ?? 0) > 0
            ? constraints.strictness?.colors ?? "prefer"
            : colorsFromReference.length > 0
              ? "prefer"
              : constraints.strictness?.colors ?? "prefer",
      },
    };
  }
  const priorResultMode = input.session.recommendation_state.runtime?.last_result_mode ?? null;
  const noMatchAttempts = Math.max(
    input.session.conversation_memory.no_match_attempts ?? 0,
    input.session.recommendation_state.runtime?.no_match_attempts ?? 0
  );
  const lastRecommendedSizeIn =
    input.session.recommendation_state.runtime?.last_recommended_size_in ?? null;
  const hasExplicitSizeMention =
    /\b\d{1,3}(?:\.\d+)?\s*(?:x|×|by)\s*\d{1,3}(?:\.\d+)?\b/i.test(input.message) ||
    /\b(?:exactly|around|about)\s+\d{1,3}(?:\.\d+)?\s*(?:ft|feet|')?\b/i.test(input.message);
  const hasRoomRescopeSignal =
    /\b(entryway|entry|hallway|kitchen|bedroom|living room|dining room|foyer)\b/i.test(
      input.message
    );
  const asksSmallerScale = /\b(smaller|shorter|more compact|downsized?)\b/i.test(
    input.message
  );
  const directionalFollowupWithoutSize =
    (followupIntent === "larger" ||
      followupIntent === "smaller" ||
      followupIntent === "closest" ||
      followupIntent === "tighten") &&
    !constraints.size &&
    lastRecommendedSizeIn &&
    typeof lastRecommendedSizeIn.width_in === "number" &&
    typeof lastRecommendedSizeIn.length_in === "number";
  if (directionalFollowupWithoutSize) {
    constraints = {
      ...constraints,
      size: {
        widthIn: lastRecommendedSizeIn.width_in,
        lengthIn: lastRecommendedSizeIn.length_in,
        toleranceIn: constraints.strictness?.size === "must" ? 0 : 10,
      },
      strictness: {
        ...(constraints.strictness ?? {}),
        size: constraints.strictness?.size ?? "prefer",
      },
    };
  }

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

  const practicalHistorySignal = input.session.chat_history
    .filter((message) => message.role === "user")
    .slice(-6)
    .some((message) =>
      /\b(kid|kids|child|children|dog|dogs|pet|pets|high traffic|durable|easy to clean|low maintenance|beach house|tough|practical)\b/i.test(
        message.content
      )
    );
  const baseCustomerContext = input.ai_context_packet?.customer_context ?? [];
  const customerContext = practicalHistorySignal
    ? Array.from(new Set([...baseCustomerContext, "practical: durable easy-clean needed"]))
    : baseCustomerContext;
  const chatContext = {
    structured_state: input.ai_context_packet?.structured_state,
    conversation_memory: input.ai_context_packet?.conversation_memory,
    customer_context: customerContext,
    recently_shown_rugs:
      input.ai_context_packet?.recently_shown_rugs ??
      input.session.recommendation_state.runtime?.recently_shown_rugs,
    shown_rug_ids:
      input.ai_context_packet?.shown_rug_ids ??
      input.session.recommendation_state.runtime?.shown_rug_ids,
    liked_attributes:
      input.ai_context_packet?.liked_attributes ??
      input.session.recommendation_state.runtime?.liked_attributes,
    recent_turns: input.ai_context_packet?.recent_turns,
  };

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
      chat_context: chatContext,
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
  const positiveReaction =
    Boolean(referencedRug) &&
    /\b(i like|i love|love that|love this|that one|this one|favorite|favourite)\b/i.test(
      input.message
    );
  const negativeReaction =
    Boolean(referencedRug) &&
    /\b(i don't like|i do not like|not my style|hate that|don't want that)\b/i.test(
      input.message
    );
  const referencedColors =
    positiveReaction && referencedRug
      ? (referencedRug.colors ?? [])
      : [];
  const referencedStyles =
    positiveReaction && referencedRug?.style ? [referencedRug.style] : [];
  const referencedOrigins =
    positiveReaction && referencedRug?.origin ? [referencedRug.origin] : [];
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
          ...referencedColors,
        ]),
        styles: uniqueLower([
          ...(previousLikedAttributes?.styles ?? []),
          ...requestedStyles,
          ...referencedStyles,
        ]),
        origins: uniqueLower([
          ...(previousLikedAttributes?.origins ?? []),
          ...referencedOrigins,
        ]),
      },
      shown_rug_ids: uniqueLower([
        ...previousShownRugIds,
        ...recentlyShownRugs.map((rug) => rug.id),
      ], 80),
      liked_rug_ids: uniqueLower(
        [
          ...(input.session.recommendation_state.runtime?.liked_rug_ids ?? []),
          ...(positiveReaction && input.referenced_rug_id
            ? [input.referenced_rug_id]
            : []),
        ],
        120
      ),
      dismissed_rug_ids: uniqueLower(
        [
          ...(input.session.recommendation_state.runtime?.dismissed_rug_ids ?? []),
          ...(negativeReaction && input.referenced_rug_id
            ? [input.referenced_rug_id]
            : []),
        ],
        120
      ),
    },
  };
}
