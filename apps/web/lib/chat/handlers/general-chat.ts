import { buildPromptLayers } from "@/lib/chat/prompt-builder";
import type { ChatTurnHandlerInput, GeneralChatResponse } from "@/lib/chat/types";

// Placeholder handler for general/freeform chat mode.
export async function handleGeneralChatTurn(
  input: ChatTurnHandlerInput
): Promise<GeneralChatResponse> {
  const layers = buildPromptLayers({
    mode: "general_chat",
    role: input.role,
    session: input.session,
    userMessage: input.message,
  });

  // TODO: replace placeholder with real OpenAI freeform call.
  return {
    mode: "general_chat",
    assistant_message:
      "General chat handler placeholder. This turn did not require inventory recommendation mode.",
    notes: `Prompt layers assembled: ${layers.join(" -> ")}`,
  };
}

