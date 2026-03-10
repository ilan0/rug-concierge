export const PROMPT_LAYER = {
  systemBase: "SYSTEM_PROMPT_BASE",
  roleRetail: "ROLE_PROMPT_RETAIL_CUSTOMER",
  roleStaff: "ROLE_PROMPT_STORE_STAFF",
  taskGeneral: "TASK_PROMPT_GENERAL_CHAT",
  taskRecommendation: "TASK_PROMPT_RECOMMENDATION",
  structuredRecommendation: "STRUCTURED_OUTPUT_RECOMMENDATION",
  securityRoleModeMismatch: "SECURITY_BLOCK_ROLE_MODE_MISMATCH",
  contextStructuredState: "STRUCTURED_STATE_CONTEXT",
  contextChatMemory: "CHAT_MEMORY_CONTEXT",
  contextRecentTurns: "RECENT_TURNS_CONTEXT",
  contextInventory: "INVENTORY_CONTEXT",
  contextChatHistory: "CHAT_HISTORY_CONTEXT",
  latestUserMessage: "LATEST_USER_MESSAGE",
  latestUserWithConstraints: "LATEST_USER_MESSAGE_WITH_HARD_CONSTRAINTS",
} as const;

export type PromptLayerId = (typeof PROMPT_LAYER)[keyof typeof PROMPT_LAYER];
