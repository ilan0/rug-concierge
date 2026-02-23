import type { ChatMode, RoleType, SessionData } from "@/lib/chat/types";
import {
  getChatLayerPreview,
  getRecommendationLayerPreview,
} from "@/lib/prompts/layers";

type BuildPromptLayersInput = {
  mode: ChatMode;
  role: RoleType;
  session: SessionData;
  userMessage: string;
};

// Placeholder to show where prompt layering is assembled each turn.
export function buildPromptLayers(input: BuildPromptLayersInput): string[] {
  if (input.mode === "recommendation") {
    return getRecommendationLayerPreview({
      role: input.role,
      hasTradePreferences: Object.keys(input.session.trade_context.preferences).length > 0,
    });
  }

  return getChatLayerPreview({
    mode: input.mode,
    role: input.role,
    hasChatHistory: input.session.chat_history.length > 0,
  });
}
