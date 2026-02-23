import type { ChatMode, RoleType } from "@/lib/chat/types";

export const PROMPT_LAYER = {
  systemBase: "SYSTEM_PROMPT_BASE",
  roleRetail: "ROLE_PROMPT_RETAIL_CUSTOMER",
  roleTrade: "ROLE_PROMPT_TRADE_CLIENT",
  roleStaff: "ROLE_PROMPT_STORE_STAFF",
  taskGeneral: "TASK_PROMPT_GENERAL_CHAT",
  taskRecommendation: "TASK_PROMPT_RECOMMENDATION",
  taskTradeSupport: "TASK_PROMPT_TRADE_SUPPORT",
  taskAppraisal: "TASK_PROMPT_APPRAISAL",
  structuredRecommendation: "STRUCTURED_OUTPUT_RECOMMENDATION",
  securityRoleModeMismatch: "SECURITY_BLOCK_ROLE_MODE_MISMATCH",
  contextTradePreferences: "TRADE_PREFERENCES_CONTEXT",
  contextInventory: "INVENTORY_CONTEXT",
  contextChatHistory: "CHAT_HISTORY_CONTEXT",
  latestUserMessage: "LATEST_USER_MESSAGE",
  latestUserWithConstraints: "LATEST_USER_MESSAGE_WITH_HARD_AND_PROJECT_CONTEXT",
} as const;

export type PromptLayerId = (typeof PROMPT_LAYER)[keyof typeof PROMPT_LAYER];

export function getRecommendationLayerPreview(input: {
  role: RoleType;
  hasTradePreferences: boolean;
}): PromptLayerId[] {
  const layers: PromptLayerId[] = [
    PROMPT_LAYER.systemBase,
    PROMPT_LAYER.taskRecommendation,
    PROMPT_LAYER.structuredRecommendation,
  ];

  if (input.role === "trade_client") {
    layers.push(PROMPT_LAYER.taskTradeSupport);
  }

  if (input.hasTradePreferences) {
    layers.push(PROMPT_LAYER.contextTradePreferences);
  }

  layers.push(PROMPT_LAYER.contextInventory);
  layers.push(PROMPT_LAYER.latestUserWithConstraints);
  return layers;
}

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
