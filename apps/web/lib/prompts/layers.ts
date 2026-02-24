import type { ChatMode, RoleType } from "@/lib/chat/types";
import { PROMPT_LAYER, type PromptLayerId } from "@/lib/prompts/layer-ids";
import { getRecommendationLayerPreview } from "@/lib/prompts/recommendation-stack";

export { PROMPT_LAYER };
export type { PromptLayerId };

export function getChatLayerPreview(input: {
  mode: ChatMode;
  role: RoleType;
  hasChatHistory: boolean;
}): PromptLayerId[] {
  if (input.mode === "recommendation") {
    return getRecommendationLayerPreview({
      role: input.role,
      hasTradePreferences: false,
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

  if (input.hasChatHistory) {
    layers.push(PROMPT_LAYER.contextChatHistory);
  }

  layers.push(PROMPT_LAYER.latestUserMessage);
  return layers;
}
