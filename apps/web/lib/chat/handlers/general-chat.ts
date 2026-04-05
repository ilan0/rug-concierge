import { buildPromptLayers } from "@/lib/chat/prompt-builder";
import {
  generateGeneralChatResponse,
  toGeneralChatRequestPayloadPreview,
  toGeneralChatResponsePayloadPreview,
  type GeneralChatAiTrace,
} from "@/lib/ai/general-chat";
import {
  buildAiContextPacket,
  getAiContextPacketStats,
} from "@/lib/chat/context-packet";
import { OPENAI_CHAT_MODEL } from "@/lib/config";
import type { ChatTurnHandlerInput, GeneralChatResponse } from "@/lib/chat/types";
import { writeE2eTraceArtifact } from "@/lib/qa/e2e-trace";

function roomLabelFromSessionFact(value: string): string | null {
  const normalized = value.toLowerCase().trim();
  const match = normalized.match(
    /\b(living room|dining room|bedroom|kitchen|hallway|entryway|office)\b/
  );
  return match?.[1] ?? null;
}

function roomLabelFromPreference(
  room: ChatTurnHandlerInput["session"]["recommendation_state"]["soft_preferences"]["room"]
): string | null {
  if (!room) return null;
  return room.replace(/_/g, " ");
}

function resolveBrowsingPivot(input: ChatTurnHandlerInput): string | null {
  const fromPreference = roomLabelFromPreference(
    input.session.recommendation_state.soft_preferences.room
  );
  if (fromPreference) return fromPreference;

  const stableFacts = input.session.conversation_memory.stable_facts ?? [];
  for (const fact of stableFacts) {
    const room = roomLabelFromSessionFact(fact);
    if (room) return room;
  }
  return null;
}

// General/freeform chat mode.
export async function handleGeneralChatTurn(
  input: ChatTurnHandlerInput
): Promise<GeneralChatResponse> {
  if (input.parsed_intent === "purchase") {
    const recentlyShown = input.session.recommendation_state.runtime?.recently_shown_rugs ?? [];
    const selected =
      (input.referenced_rug_id
        ? recentlyShown.find((rug) => rug.id === input.referenced_rug_id)
        : undefined) ?? null;
    const selectedLabel =
      selected?.label && selected.label.trim().length > 0 ? selected.label.trim() : null;
    const browsingPivot = resolveBrowsingPivot(input);
    const continuedBrowsingLine = browsingPivot
      ? `While staff handles that one, want me to pull a few options for your ${browsingPivot} too?`
      : "While staff handles that one, want me to keep exploring a few more options with you?";
    return {
      mode: "general_chat",
      assistant_message:
        selectedLabel
          ? `Great pick on ${selectedLabel}. A staff member can finalize pricing and next steps with you now. ${continuedBrowsingLine}`
          : `Great choice. A staff member can finalize pricing and next steps with you now. ${continuedBrowsingLine}`,
      notes: "PURCHASE_INTENT_HANDOFF",
    };
  }

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

  const aiTrace: GeneralChatAiTrace = {
    called: false,
    model: OPENAI_CHAT_MODEL,
    prompt_layers: [],
    request_payload: null,
    response_status: null,
    response_payload: null,
    parsed_response: null,
    fallback_reason: null,
    error: null,
    incomplete_detected: false,
    retry_attempted: false,
    retry_succeeded: false,
    text_postprocess_applied: false,
  };
  const startedAt = Date.now();

  const modelResponse = await generateGeneralChatResponse({
    role: input.role,
    contextPacket,
    forceClarification: Boolean(input.needs_clarification),
    trace: aiTrace,
  });
  const generationTimeMs = Date.now() - startedAt;

  if (input.trace_meta) {
    await writeE2eTraceArtifact({
      meta: {
        run_id: input.trace_meta.run_id,
        case_id: input.trace_meta.case_id,
      },
      channel: "general-chat-ai",
      trace_id: crypto.randomUUID(),
      payload: {
        mode: "general_chat",
        flow_path: [
          "handleGeneralChatTurn",
          "buildPromptLayers",
          "generateGeneralChatResponse",
        ],
        ai_trace: {
          called: aiTrace.called,
          model: aiTrace.model,
          prompt_layers: aiTrace.prompt_layers,
          request_payload_preview: toGeneralChatRequestPayloadPreview(
            aiTrace.request_payload
          ),
          response_status: aiTrace.response_status,
          response_payload_preview: toGeneralChatResponsePayloadPreview(
            aiTrace.response_payload
          ),
          parsed_response: aiTrace.parsed_response,
          fallback_reason: aiTrace.fallback_reason,
          error: aiTrace.error,
          incomplete_detected: aiTrace.incomplete_detected,
          retry_attempted: aiTrace.retry_attempted,
          retry_succeeded: aiTrace.retry_succeeded,
          text_postprocess_applied: aiTrace.text_postprocess_applied,
        },
        context_packet_stats: getAiContextPacketStats(contextPacket),
        timing_ms: {
          generate_general_chat_ms: generationTimeMs,
        },
      },
    });
  }

  return {
    mode: input.needs_clarification ? "clarifying_question" : "general_chat",
    assistant_message: modelResponse.assistant_message,
    notes: [
      modelResponse.notes ?? "GENERAL_CHAT_AI_RUNTIME:real",
      `Prompt layers assembled: ${layers.join(" -> ")}`,
    ].join(" | "),
  };
}
