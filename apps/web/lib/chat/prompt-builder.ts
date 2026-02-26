import type { ChatMode, RoleType, SessionData } from "@/lib/chat/types";
import { getChatLayerPreview } from "@/lib/prompts/layers";
import { getRecommendationLayerPreview } from "@/lib/prompts/recommendation-stack";

type BuildPromptLayersInput = {
  mode: ChatMode;
  role: RoleType;
  session: SessionData;
  userMessage: string;
};

// Placeholder to show where prompt layering is assembled each turn.
export function buildPromptLayers(input: BuildPromptLayersInput): string[] {
  const hasMemoryContext =
    input.session.conversation_memory.summary_text.length > 0 ||
    input.session.conversation_memory.stable_facts.length > 0 ||
    input.session.conversation_memory.open_threads.length > 0;

  if (input.mode === "recommendation") {
    return getRecommendationLayerPreview({
      role: input.role,
      hasTradePreferences: Object.keys(input.session.trade_context.preferences).length > 0,
      hasProjectContext:
        Boolean(input.session.project_context.name) ||
        Boolean(input.session.project_context.active_room_id) ||
        input.session.project_context.rooms.length > 0,
      hasChatMemoryContext: true,
      hasRecentTurnsContext: input.session.chat_history.length > 0,
    });
  }

  return getChatLayerPreview({
    mode: input.mode,
    role: input.role,
    hasTradePreferences: Object.keys(input.session.trade_context.preferences).length > 0,
    hasProjectContext:
      Boolean(input.session.project_context.name) ||
      Boolean(input.session.project_context.active_room_id) ||
      input.session.project_context.rooms.length > 0,
    hasRecommendationHardConstraints:
      Boolean(input.session.recommendation_state.hard_constraints.size) ||
      typeof input.session.recommendation_state.hard_constraints.budgetMax ===
        "number",
    hasChatMemoryContext: hasMemoryContext,
    hasRecentTurnsContext: input.session.chat_history.length > 0,
  });
}
