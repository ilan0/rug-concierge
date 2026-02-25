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
  contextProject: "PROJECT_CONTEXT",
  contextChatMemory: "CHAT_MEMORY_CONTEXT",
  contextRecentTurns: "RECENT_TURNS_CONTEXT",
  contextInventory: "INVENTORY_CONTEXT",
  contextChatHistory: "CHAT_HISTORY_CONTEXT",
  latestUserMessage: "LATEST_USER_MESSAGE",
  latestUserWithConstraints: "LATEST_USER_MESSAGE_WITH_HARD_AND_PROJECT_CONTEXT",
} as const;

export type PromptLayerId = (typeof PROMPT_LAYER)[keyof typeof PROMPT_LAYER];
