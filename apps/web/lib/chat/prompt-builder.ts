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

  layers.push(
    input.mode === "recommendation"
      ? "TASK_PROMPT_RECOMMENDATION"
      : "TASK_PROMPT_GENERAL_CHAT"
  );

  // In production this should be a compact summary window, not full unbounded history.
  if (input.session.chat_history.length > 0) {
    layers.push("CHAT_HISTORY_CONTEXT");
  }

  layers.push("LATEST_USER_MESSAGE");
  return layers;
}

