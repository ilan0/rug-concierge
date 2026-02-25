import type { ChatMode, RoleType } from "@/lib/chat/types";
import { PROMPT_LAYER, type PromptLayerId } from "@/lib/prompts/layer-ids";
import { getGeneralChatLayerPreview } from "@/lib/prompts/general-chat-stack";
import { getRecommendationLayerPreview } from "@/lib/prompts/recommendation-stack";

export { PROMPT_LAYER };
export type { PromptLayerId };

export function getChatLayerPreview(input: {
  mode: ChatMode;
  role: RoleType;
  hasTradePreferences: boolean;
  hasProjectContext: boolean;
  hasChatMemoryContext: boolean;
  hasRecentTurnsContext: boolean;
}): PromptLayerId[] {
  if (input.mode === "recommendation") {
    return getRecommendationLayerPreview({
      role: input.role,
      hasTradePreferences: input.hasTradePreferences,
      hasProjectContext: input.hasProjectContext,
      hasChatMemoryContext: input.hasChatMemoryContext,
      hasRecentTurnsContext: input.hasRecentTurnsContext,
    });
  }

  if (input.mode === "general_chat") {
    return getGeneralChatLayerPreview({
      role: input.role,
      hasTradePreferences: input.hasTradePreferences,
      hasProjectContext: input.hasProjectContext,
      hasMemoryContext: input.hasChatMemoryContext,
      hasRecentTurns: input.hasRecentTurnsContext,
    });
  }

  const layers: PromptLayerId[] = [PROMPT_LAYER.systemBase];
  if (input.role === "trade_client") {
    layers.push(PROMPT_LAYER.roleTrade);
  } else if (input.role === "store_staff" || input.role === "developer") {
    layers.push(PROMPT_LAYER.roleStaff);
  } else {
    layers.push(PROMPT_LAYER.roleRetail);
  }

  if (
    input.mode === "appraisal" &&
    input.role !== "store_staff" &&
    input.role !== "developer"
  ) {
    layers.push(PROMPT_LAYER.securityRoleModeMismatch);
  } else if (input.mode === "appraisal") {
    layers.push(PROMPT_LAYER.taskAppraisal);
  } else {
    layers.push(PROMPT_LAYER.taskGeneral);
  }

  if (input.hasChatMemoryContext) {
    layers.push(PROMPT_LAYER.contextChatMemory);
  }

  if (input.hasRecentTurnsContext) {
    layers.push(PROMPT_LAYER.contextRecentTurns);
  }

  layers.push(PROMPT_LAYER.latestUserMessage);
  return layers;
}
