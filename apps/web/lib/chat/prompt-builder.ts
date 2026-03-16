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
      hasChatMemoryContext: true,
      hasRecentTurnsContext: input.session.chat_history.length > 0,
    });
  }

  return getChatLayerPreview({
    mode: input.mode,
    role: input.role,
    hasRecommendationHardConstraints: Boolean(
      input.session.recommendation_state.hard_constraints.size ||
        (input.session.recommendation_state.hard_constraints.colors?.length ?? 0) >
          0 ||
        (input.session.recommendation_state.hard_constraints.styles?.length ?? 0) >
          0 ||
        input.session.recommendation_state.hard_constraints.shape
    ),
    hasChatMemoryContext: hasMemoryContext,
    hasRecentTurnsContext: input.session.chat_history.length > 0,
  });
}
