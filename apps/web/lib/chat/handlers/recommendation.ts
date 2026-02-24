import { runRecommendationPipeline } from "@/lib/recommend/pipeline";
import { hasTenantId } from "@/lib/auth/tenant";
import type {
  ChatTurnHandlerInput,
  RecommendationTurnResponse,
} from "@/lib/chat/types";

// Recommendation mode handler now uses the shared SQL-first backend pipeline.
export async function handleRecommendationTurn(
  input: ChatTurnHandlerInput
): Promise<RecommendationTurnResponse> {
  const promptRole = input.role === "developer" ? "store_staff" : input.role;

  if (input.review_action === "approve") {
    return {
      mode: "recommendation",
      assistant_message:
        "Approved. I will keep these recommendations as the current set.",
      questions: [],
      recommendations: input.session.review_state.last_recommendations,
      notes: "REVIEW_ACTION_APPROVE",
    };
  }

  if (input.review_action === "reject") {
    return {
      mode: "recommendation",
      assistant_message:
        "Rejected. I can regenerate another set when you are ready.",
      questions: [],
      recommendations: [],
      notes: "REVIEW_ACTION_REJECT",
    };
  }

  if (input.review_action === "override") {
    const priorRecommendations = input.session.review_state.last_recommendations;
    const selectedIds = new Set(input.override?.selected_rug_ids ?? []);
    const overriddenRecommendations =
      selectedIds.size > 0
        ? priorRecommendations.filter((item) => selectedIds.has(item.rug_id))
        : priorRecommendations;
    const overrideMessage = input.override?.assistant_message?.trim();
    const staffMessage =
      overrideMessage && overrideMessage.length > 0
        ? overrideMessage
        : "Updated by store staff review.";

    return {
      mode: "recommendation",
      assistant_message: staffMessage,
      questions: [],
      recommendations: overriddenRecommendations,
      notes: input.override?.notes?.trim() || "REVIEW_ACTION_OVERRIDE",
    };
  }

  const globalConstraints = input.session.recommendation_state.hard_constraints;
  const activeRoom = input.session.project_context.active_room_id
    ? input.session.project_context.rooms.find(
        (room) => room.room_id === input.session.project_context.active_room_id
      ) ?? null
    : null;
  const constraints = {
    ...globalConstraints,
    ...(activeRoom?.constraints ?? {}),
  };

  const regenerateInstruction =
    input.review_action === "regenerate" &&
    input.session.review_state.last_recommendations.length > 0
      ? "\n\nPlease generate a different mix from the previous set where possible."
      : "";

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
    userMessage: `${input.message}${regenerateInstruction}`.trim(),
    constraints,
    promptContext: {
      role: promptRole,
      trade_preferences:
        promptRole === "trade_client"
          ? input.session.trade_context.preferences
          : undefined,
      project_context: {
        project_name: input.session.project_context.name,
        active_room: activeRoom?.room_name ?? null,
        room_count: input.session.project_context.rooms.length,
        rooms: input.session.project_context.rooms.map((room) => ({
          room_name: room.room_name,
          constraints: room.constraints,
        })),
      },
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
  return {
    ...aiResponse,
    mode:
      aiResponse.mode === "recommendations"
        ? "recommendation"
        : aiResponse.mode,
  };
}
