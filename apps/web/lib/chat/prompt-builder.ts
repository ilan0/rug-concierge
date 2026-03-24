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
    const runtime = input.session.recommendation_state.runtime;
    return getRecommendationLayerPreview({
      role: input.role,
      discoveryMode: false,
      hasChatMemoryContext: true,
      hasCustomerContext: input.session.conversation_memory.stable_facts.length > 0,
      hasRecentlyShownContext: (runtime?.recently_shown_rugs?.length ?? 0) > 0,
      hasLikedAttributesContext:
        (runtime?.liked_attributes?.colors?.length ?? 0) > 0 ||
        (runtime?.liked_attributes?.styles?.length ?? 0) > 0 ||
        (runtime?.liked_attributes?.origins?.length ?? 0) > 0,
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
