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

  const constraints = input.session.recommendation_state.hard_constraints;

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
    promptContext: {
      role: promptRole,
      chat_context: input.ai_context_packet
        ? {
            structured_state: input.ai_context_packet.structured_state,
            conversation_memory: input.ai_context_packet.conversation_memory,
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
  return {
    ...aiResponse,
    mode:
      aiResponse.mode === "recommendations"
        ? "recommendation"
        : aiResponse.mode,
  };
}
