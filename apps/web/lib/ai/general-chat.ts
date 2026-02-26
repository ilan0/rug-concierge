import { getRecommendationPromptBundle } from "@/lib/ai/prompt-library";
import type { ChatAiContextPacket } from "@/lib/chat/context-packet";
import type { RoleType } from "@/lib/chat/types";
import {
  buildGeneralChatPromptSections,
  getRolePrompt,
  groupGeneralChatSectionsByRole,
} from "@/lib/prompts/general-chat-stack";
import type { PromptLayerId } from "@/lib/prompts/layer-ids";

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const OPENAI_MODEL = process.env.OPENAI_MODEL ?? "gpt-4.1-nano";
const MAX_ASSISTANT_MESSAGE_CHARS = 260;
const MAX_NOTE_CHARS = 220;
const MAX_HINTS = 6;
const MAX_HINT_CHARS = 90;

const GENERAL_CHAT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["assistant_message", "notes", "follow_up_question", "memory_hints"],
  properties: {
    assistant_message: { type: "string" },
    notes: { type: ["string", "null"] },
    follow_up_question: { type: ["string", "null"] },
    memory_hints: {
      type: "array",
      minItems: 0,
      maxItems: MAX_HINTS,
      items: { type: "string" },
    },
  },
} as const;

export type GeneralChatModelResponse = {
  assistant_message: string;
  notes: string | null;
  follow_up_question: string | null;
  memory_hints: string[];
};

export type GeneralChatAiTrace = {
  called: boolean;
  model: string;
  prompt_layers: {
    id: PromptLayerId;
    role: "system" | "user";
    chars: number;
    preview: string;
  }[];
  request_payload: unknown | null;
  response_status: number | null;
  response_payload: unknown | null;
  parsed_response: GeneralChatModelResponse | null;
  fallback_reason: string | null;
  error: string | null;
};

export type GeneralChatRequestPayloadPreview = {
  model: string | null;
  message_groups: number;
  system_groups: number;
  user_groups: number;
  system_blocks: number;
  user_blocks: number;
  schema_name: string | null;
  schema_strict: boolean | null;
};

export type GeneralChatResponsePayloadPreview = {
  has_output_text: boolean;
  output_items: number;
  content_blocks: number;
  has_error: boolean;
  error_type: string | null;
};

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function trimToChars(value: string, maxChars: number): string {
  const normalized = normalizeText(value);
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, maxChars - 1).trimEnd()}…`;
}

function sectionPreview(value: string): string {
  return trimToChars(value, 120);
}

function parseOutputText(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const data = payload as Record<string, unknown>;

  if (typeof data.output_text === "string" && data.output_text.trim()) {
    return data.output_text;
  }

  if (!Array.isArray(data.output)) return null;

  for (const outputItem of data.output) {
    if (!outputItem || typeof outputItem !== "object") continue;
    const item = outputItem as Record<string, unknown>;
    if (!Array.isArray(item.content)) continue;

    for (const part of item.content) {
      if (!part || typeof part !== "object") continue;
      const block = part as Record<string, unknown>;
      if (typeof block.text === "string" && block.text.trim()) {
        return block.text;
      }
    }
  }

  return null;
}

export function toGeneralChatRequestPayloadPreview(
  payload: unknown
): GeneralChatRequestPayloadPreview | null {
  if (!payload || typeof payload !== "object") return null;
  const data = payload as Record<string, unknown>;
  const inputBlocks = Array.isArray(data.input) ? data.input : [];

  let systemGroups = 0;
  let userGroups = 0;
  let systemBlocks = 0;
  let userBlocks = 0;

  for (const block of inputBlocks) {
    if (!block || typeof block !== "object") continue;
    const item = block as Record<string, unknown>;
    const role = item.role === "system" || item.role === "user" ? item.role : null;
    if (!role) continue;

    const content = Array.isArray(item.content) ? item.content : [];
    if (role === "system") {
      systemGroups += 1;
      systemBlocks += content.length;
    } else {
      userGroups += 1;
      userBlocks += content.length;
    }
  }

  const text = data.text && typeof data.text === "object" ? (data.text as Record<string, unknown>) : null;
  const format =
    text?.format && typeof text.format === "object"
      ? (text.format as Record<string, unknown>)
      : null;

  return {
    model: typeof data.model === "string" ? data.model : null,
    message_groups: inputBlocks.length,
    system_groups: systemGroups,
    user_groups: userGroups,
    system_blocks: systemBlocks,
    user_blocks: userBlocks,
    schema_name: typeof format?.name === "string" ? format.name : null,
    schema_strict: typeof format?.strict === "boolean" ? format.strict : null,
  };
}

export function toGeneralChatResponsePayloadPreview(
  payload: unknown
): GeneralChatResponsePayloadPreview | null {
  if (!payload || typeof payload !== "object") return null;
  const data = payload as Record<string, unknown>;
  const output = Array.isArray(data.output) ? data.output : [];
  let contentBlocks = 0;

  for (const outputItem of output) {
    if (!outputItem || typeof outputItem !== "object") continue;
    const item = outputItem as Record<string, unknown>;
    if (!Array.isArray(item.content)) continue;
    contentBlocks += item.content.length;
  }

  const error =
    data.error && typeof data.error === "object"
      ? (data.error as Record<string, unknown>)
      : null;

  return {
    has_output_text:
      typeof data.output_text === "string" && data.output_text.trim().length > 0,
    output_items: output.length,
    content_blocks: contentBlocks,
    has_error: Boolean(error),
    error_type: typeof error?.type === "string" ? error.type : null,
  };
}

function isGeneralChatResponse(value: unknown): value is GeneralChatModelResponse {
  if (!value || typeof value !== "object") return false;
  const data = value as Record<string, unknown>;

  if (typeof data.assistant_message !== "string") return false;
  if (!(typeof data.notes === "string" || data.notes === null)) return false;
  if (!(typeof data.follow_up_question === "string" || data.follow_up_question === null)) {
    return false;
  }

  if (!Array.isArray(data.memory_hints)) return false;
  if (!data.memory_hints.every((item) => typeof item === "string")) return false;

  return true;
}

function parseGeneralChatResponse(payload: unknown): GeneralChatModelResponse | null {
  const text = parseOutputText(payload);
  if (!text) return null;

  try {
    const parsed = JSON.parse(text) as unknown;
    if (!isGeneralChatResponse(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function sanitizeHints(hints: string[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];

  for (const hint of hints) {
    const normalized = trimToChars(hint, MAX_HINT_CHARS);
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(normalized);
    if (output.length >= MAX_HINTS) break;
  }

  return output;
}

function sanitizeResponse(response: GeneralChatModelResponse): GeneralChatModelResponse {
  const assistantMessage = trimToChars(response.assistant_message, MAX_ASSISTANT_MESSAGE_CHARS);
  const followUp = response.follow_up_question
    ? trimToChars(response.follow_up_question, 120)
    : null;
  const notes = response.notes ? trimToChars(response.notes, MAX_NOTE_CHARS) : null;
  const mergedAssistant = (() => {
    if (!followUp) return assistantMessage;
    const assistantLower = assistantMessage.toLowerCase();
    const followUpLower = followUp.toLowerCase();
    if (assistantLower.endsWith(followUpLower)) {
      return assistantMessage;
    }
    return `${assistantMessage} ${followUp}`.replace(/\s+/g, " ").trim();
  })();

  return {
    assistant_message: mergedAssistant,
    notes,
    follow_up_question: followUp,
    memory_hints: sanitizeHints(response.memory_hints),
  };
}

function fallbackResponse(reason: string): GeneralChatModelResponse {
  return {
    assistant_message:
      "I can help with rug care, sizing, style guidance, and practical selection advice. Tell me what you want to focus on.",
    notes: reason,
    follow_up_question: null,
    memory_hints: [],
  };
}

export async function generateGeneralChatResponse(input: {
  role: RoleType;
  contextPacket: ChatAiContextPacket;
  trace?: GeneralChatAiTrace;
}): Promise<GeneralChatModelResponse> {
  const generalChatEnabled = process.env.ENABLE_GENERAL_CHAT_AI !== "0";
  if (!generalChatEnabled) {
    if (input.trace) {
      input.trace.called = false;
      input.trace.model = OPENAI_MODEL;
      input.trace.prompt_layers = [];
      input.trace.request_payload = null;
      input.trace.response_status = null;
      input.trace.response_payload = null;
      input.trace.parsed_response = null;
      input.trace.fallback_reason = "General chat AI disabled via ENABLE_GENERAL_CHAT_AI";
      input.trace.error = null;
    }
    return fallbackResponse("GENERAL_CHAT_AI_RUNTIME:fallback_disabled");
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    if (input.trace) {
      input.trace.called = false;
      input.trace.model = OPENAI_MODEL;
      input.trace.prompt_layers = [];
      input.trace.request_payload = null;
      input.trace.response_status = null;
      input.trace.response_payload = null;
      input.trace.parsed_response = null;
      input.trace.fallback_reason = "Missing OPENAI_API_KEY";
      input.trace.error = null;
    }
    return fallbackResponse("GENERAL_CHAT_AI_RUNTIME:fallback_missing_api_key");
  }

  const prompts = getRecommendationPromptBundle();
  const hasTradePreferences =
    Object.keys(input.contextPacket.structured_state.trade_context.preferences).length > 0;
  const projectContext = input.contextPacket.structured_state.project_context;
  const hasProjectContext =
    Boolean(projectContext.name) ||
    projectContext.rooms.length > 0 ||
    Boolean(projectContext.active_room_id);
  const hasMemoryContext =
    input.contextPacket.conversation_memory.summary_text.length > 0 ||
    input.contextPacket.conversation_memory.stable_facts.length > 0 ||
    input.contextPacket.conversation_memory.open_threads.length > 0;

  const promptSections = buildGeneralChatPromptSections({
    role: input.role,
    hasTradePreferences,
    hasProjectContext,
    hasMemoryContext,
    hasRecentTurns: input.contextPacket.recent_turns.length > 0,
    prompts: {
      system: prompts.system,
      generalChat: prompts.generalChat,
    },
    contextPacket: input.contextPacket,
    rolePrompt: getRolePrompt(input.role),
  });

  const requestPayload = {
    model: OPENAI_MODEL,
    input: groupGeneralChatSectionsByRole(promptSections),
    text: {
      format: {
        type: "json_schema",
        name: "general_chat_response",
        schema: GENERAL_CHAT_SCHEMA,
        strict: true,
      },
    },
  };

  if (input.trace) {
    input.trace.called = true;
    input.trace.model = OPENAI_MODEL;
    input.trace.prompt_layers = promptSections.map((section) => ({
      id: section.id,
      role: section.role,
      chars: section.text.length,
      preview: sectionPreview(section.text),
    }));
    input.trace.request_payload = requestPayload;
    input.trace.response_status = null;
    input.trace.response_payload = null;
    input.trace.parsed_response = null;
    input.trace.fallback_reason = null;
    input.trace.error = null;
  }

  const response = await fetch(OPENAI_RESPONSES_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(requestPayload),
  }).catch(() => null);

  if (!response || !response.ok) {
    if (input.trace) {
      input.trace.response_status = response ? response.status : null;
      input.trace.response_payload = null;
      input.trace.parsed_response = null;
      input.trace.fallback_reason = "OpenAI request failed";
      input.trace.error = response
        ? `OpenAI request failed with status ${response.status}`
        : "OpenAI request failed: network error";
    }
    return fallbackResponse("GENERAL_CHAT_AI_RUNTIME:fallback_request_failed");
  }

  const payload = (await response.json().catch(() => null)) as unknown;
  if (input.trace) {
    input.trace.response_status = response.status;
    input.trace.response_payload = payload;
  }

  const parsed = parseGeneralChatResponse(payload);
  if (!parsed) {
    if (input.trace) {
      input.trace.parsed_response = null;
      input.trace.fallback_reason = "OpenAI response parsing failed";
      input.trace.error = "OpenAI response parsing failed";
    }
    return fallbackResponse("GENERAL_CHAT_AI_RUNTIME:fallback_parse_failed");
  }

  const sanitized = sanitizeResponse(parsed);
  if (input.trace) {
    input.trace.parsed_response = sanitized;
    input.trace.fallback_reason = null;
    input.trace.error = null;
  }

  const runtimeNote = "GENERAL_CHAT_AI_RUNTIME:real";
  return {
    ...sanitized,
    notes: sanitized.notes ? `${runtimeNote}; ${sanitized.notes}` : runtimeNote,
  };
}
