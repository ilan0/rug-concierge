import type { ChatMode, RoleType, SessionData } from "@/lib/chat/types";

type BuildPromptLayersInput = {
  mode: ChatMode;
  role: RoleType;
  session: SessionData;
  userMessage: string;
};

// Placeholder to show where prompt layering is assembled each turn.
export function buildPromptLayers(input: BuildPromptLayersInput): string[] {
  const layers: string[] = [];

  layers.push("SYSTEM_PROMPT");

  if (input.role === "trade_client") {
    layers.push("ROLE_PROMPT_TRADE_CLIENT");
  } else if (input.role === "store_staff") {
    layers.push("ROLE_PROMPT_STORE_STAFF");
  } else {
    layers.push("ROLE_PROMPT_RETAIL_CUSTOMER");
  }

  if (input.mode === "appraisal" && input.role !== "store_staff") {
    layers.push("SECURITY_BLOCK_ROLE_MODE_MISMATCH");
  } else if (input.mode === "recommendation" && input.role === "trade_client") {
    layers.push("TASK_PROMPT_TRADE_SUPPORT");
  } else if (input.mode === "recommendation") {
    layers.push("TASK_PROMPT_RECOMMENDATION");
  } else if (input.mode === "appraisal") {
    layers.push("TASK_PROMPT_APPRAISAL");
  } else {
    layers.push("TASK_PROMPT_GENERAL_CHAT");
  }

  if (input.role === "trade_client") {
    if (Object.keys(input.session.trade_context.preferences).length > 0) {
      layers.push("TRADE_PREFERENCES_CONTEXT");
    }
    if (input.session.trade_context.trade_client_id) {
      layers.push("TRADE_CLIENT_CONTEXT");
    }
  }

  if (input.session.project_context.rooms.length > 0) {
    layers.push("PROJECT_CONTEXT");
  }

  // In production this should be a compact summary window, not full unbounded history.
  if (input.session.chat_history.length > 0) {
    layers.push("CHAT_HISTORY_CONTEXT");
  }

  layers.push("LATEST_USER_MESSAGE");
  return layers;
}
