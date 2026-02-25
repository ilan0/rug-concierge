import { buildPromptLayers } from "@/lib/chat/prompt-builder";
import { generateGeneralChatResponse } from "@/lib/ai/general-chat";
import { buildAiContextPacket } from "@/lib/chat/context-packet";
import type { ChatTurnHandlerInput, GeneralChatResponse } from "@/lib/chat/types";

// General/freeform chat mode.
export async function handleGeneralChatTurn(
  input: ChatTurnHandlerInput
): Promise<GeneralChatResponse> {
  const layers = buildPromptLayers({
    mode: "general_chat",
    role: input.role,
    session: input.session,
    userMessage: input.message,
  });

  const contextPacket =
    input.ai_context_packet ??
    buildAiContextPacket({
      session: input.session,
      latestUserMessage: input.message,
    });

  const modelResponse = await generateGeneralChatResponse({
    role: input.role,
    contextPacket,
  });

  return {
    mode: "general_chat",
    assistant_message: modelResponse.assistant_message,
    notes: [
      modelResponse.notes ?? "GENERAL_CHAT_AI_RUNTIME:real",
      `Prompt layers assembled: ${layers.join(" -> ")}`,
    ].join(" | "),
  };
}
