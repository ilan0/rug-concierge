import { runRecommendationPipeline } from "@/lib/recommend/pipeline";
import type {
  ChatTurnHandlerInput,
  RecommendationTurnResponse,
} from "@/lib/chat/types";

// Recommendation mode handler now uses the shared SQL-first backend pipeline.
export async function handleRecommendationTurn(
  input: ChatTurnHandlerInput
): Promise<RecommendationTurnResponse> {
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

  const result = await runRecommendationPipeline({
    tenantId: input.tenant_id,
    userMessage: input.message,
    constraints,
    promptContext: {
      role: input.role,
      trade_preferences:
        input.role === "trade_client"
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
