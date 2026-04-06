import { getRecommendationPromptBundle } from "@/lib/ai/prompt-library";
import {
  endsWithSentenceBoundary,
  getMaxOutputTokens,
  normalizeText,
  postOpenAiResponses,
  shouldRetryAfterAttempt,
  toPreviewText,
  withRetryInstruction,
} from "@/lib/ai/response-quality";
import type { ChatAiContextPacket } from "@/lib/chat/context-packet";
import type { RoleType } from "@/lib/chat/types";
import {
  ENABLE_GENERAL_CHAT_AI,
  OPENAI_API_KEY,
  OPENAI_CHAT_MODEL,
} from "@/lib/config";
import {
  buildGeneralChatPromptSections,
  getRolePrompt,
  groupGeneralChatSectionsByRole,
} from "@/lib/prompts/general-chat-stack";
import type { PromptLayerId } from "@/lib/prompts/layer-ids";

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const MAX_ASSISTANT_MESSAGE_CHARS = 700;
const MAX_NOTE_CHARS = 220;
const MAX_HINTS = 6;
const MAX_HINT_CHARS = 90;
const RETRY_SYSTEM_INSTRUCTION =
  "Retry and return one complete JSON object that matches the schema exactly. Keep wording concise and finish all sentences.";

const GENERAL_CHAT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["assistant_message", "notes", "memory_hints"],
  properties: {
    assistant_message: { type: "string", minLength: 1, maxLength: MAX_ASSISTANT_MESSAGE_CHARS },
    notes: { type: ["string", "null"], maxLength: MAX_NOTE_CHARS },
    memory_hints: {
      type: "array",
      minItems: 0,
      maxItems: MAX_HINTS,
      items: { type: "string", maxLength: MAX_HINT_CHARS },
    },
  },
} as const;

export type GeneralChatModelResponse = {
  assistant_message: string;
  notes: string | null;
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
  incomplete_detected: boolean;
  retry_attempted: boolean;
  retry_succeeded: boolean;
  text_postprocess_applied: boolean;
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
  max_output_tokens: number | null;
};

export type GeneralChatResponsePayloadPreview = {
  has_output_text: boolean;
  output_items: number;
  content_blocks: number;
  has_error: boolean;
  error_type: string | null;
};

function sectionPreview(value: string): string {
  return toPreviewText(value, 120);
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

  const text =
    data.text && typeof data.text === "object"
      ? (data.text as Record<string, unknown>)
      : null;
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
    max_output_tokens:
      typeof data.max_output_tokens === "number" ? data.max_output_tokens : null,
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
  const assistant = normalizeText(data.assistant_message);
  if (assistant.length === 0 || assistant.length > MAX_ASSISTANT_MESSAGE_CHARS) return false;

  if (!(typeof data.notes === "string" || data.notes === null)) return false;
  if (typeof data.notes === "string") {
    const notes = normalizeText(data.notes);
    if (notes.length > MAX_NOTE_CHARS) return false;
  }

  if (!Array.isArray(data.memory_hints)) return false;
  if (data.memory_hints.length > MAX_HINTS) return false;
  if (
    !data.memory_hints.every(
      (item) =>
        typeof item === "string" && normalizeText(item).length > 0 && normalizeText(item).length <= MAX_HINT_CHARS
    )
  ) {
    return false;
  }

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

function toPlainText(value: string): string {
  return normalizeText(
    value
      .replace(/\*\*/g, "")
      .replace(/[_`#]/g, "")
      .replace(/^\s*[-*•]+\s*/gm, "")
  );
}

function clampAssistantMessage(message: string): string {
  const plain = toPlainText(message);
  if (plain.length <= MAX_ASSISTANT_MESSAGE_CHARS) return plain;

  const truncated = plain.slice(0, MAX_ASSISTANT_MESSAGE_CHARS).trim();
  const boundaryMatches = [...truncated.matchAll(/[.!?]/g)];
  const lastBoundary = boundaryMatches.at(-1);
  if (
    lastBoundary &&
    typeof lastBoundary.index === "number" &&
    lastBoundary.index >= Math.floor(MAX_ASSISTANT_MESSAGE_CHARS * 0.55)
  ) {
    return truncated.slice(0, lastBoundary.index + 1).trim();
  }

  const lastSpace = truncated.lastIndexOf(" ");
  if (lastSpace > Math.floor(MAX_ASSISTANT_MESSAGE_CHARS * 0.45)) {
    return `${truncated.slice(0, lastSpace).trim()}...`;
  }

  return `${truncated.slice(0, MAX_ASSISTANT_MESSAGE_CHARS - 3).trim()}...`;
}

function sanitizeHints(hints: string[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];

  for (const hint of hints) {
    const normalized = toPlainText(hint);
    if (!normalized || normalized.length > MAX_HINT_CHARS) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(normalized);
    if (output.length >= MAX_HINTS) break;
  }

  return output;
}

function sanitizeResponse(
  response: GeneralChatModelResponse,
  _latestUserMessage: string
): GeneralChatModelResponse {
  return {
    assistant_message: clampAssistantMessage(toPlainText(response.assistant_message)),
    notes: response.notes ? toPlainText(response.notes) : null,
    memory_hints: sanitizeHints(response.memory_hints),
  };
}

function warnIfLikelyTruncatedAssistantMessage(message: string): void {
  if (endsWithSentenceBoundary(message)) return;
  console.warn("[general_chat] assistant message may be truncated", {
    assistant_preview: sectionPreview(message),
  });
}

function fallbackResponse(
  reason: string,
  _latestUserMessage: string
): GeneralChatModelResponse {
  return {
    assistant_message:
      "I can help with rug care, sizing, style guidance, and practical selection advice. Tell me what you want to focus on.",
    notes: reason,
    memory_hints: [],
  };
}

export async function generateGeneralChatResponse(input: {
  role: RoleType;
  contextPacket: ChatAiContextPacket;
  forceClarification?: boolean;
  trace?: GeneralChatAiTrace;
}): Promise<GeneralChatModelResponse> {
  if (!ENABLE_GENERAL_CHAT_AI) {
    if (input.trace) {
      input.trace.called = false;
      input.trace.model = OPENAI_CHAT_MODEL;
      input.trace.prompt_layers = [];
      input.trace.request_payload = null;
      input.trace.response_status = null;
      input.trace.response_payload = null;
      input.trace.parsed_response = null;
      input.trace.fallback_reason = "General chat AI disabled by configuration";
      input.trace.error = null;
      input.trace.incomplete_detected = false;
      input.trace.retry_attempted = false;
      input.trace.retry_succeeded = false;
      input.trace.text_postprocess_applied = false;
    }
    return fallbackResponse(
      "GENERAL_CHAT_AI_RUNTIME:fallback_disabled",
      input.contextPacket.latest_user_message
    );
  }

  const prompts = getRecommendationPromptBundle();
  const hasRecommendationHardConstraints = Boolean(
    input.contextPacket.structured_state.recommendation_state.hard_constraints.size ||
      (input.contextPacket.structured_state.recommendation_state.hard_constraints
        .colors?.length ?? 0) > 0 ||
      (input.contextPacket.structured_state.recommendation_state.hard_constraints
        .styles?.length ?? 0) > 0 ||
      input.contextPacket.structured_state.recommendation_state.hard_constraints
        .shape
  );
  const hasStructuredStateContext = hasRecommendationHardConstraints;
  const hasMemoryContext =
    input.contextPacket.conversation_memory.summary_text.length > 0 ||
    input.contextPacket.conversation_memory.stable_facts.length > 0 ||
    input.contextPacket.conversation_memory.open_threads.length > 0;

  const promptSections = buildGeneralChatPromptSections({
    role: input.role,
    hasStructuredStateContext,
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
    model: OPENAI_CHAT_MODEL,
    input: [
      ...groupGeneralChatSectionsByRole(promptSections),
      ...(input.forceClarification
        ? [
            {
              role: "system" as const,
              content: [
                {
                  type: "input_text" as const,
                  text:
                    "Routing context: the user shared constraints but intent is unclear. Ask one concise clarifying question to choose between inventory recommendations vs general advice.",
                },
              ],
            },
          ]
        : []),
    ],
    max_output_tokens: getMaxOutputTokens("general_chat"),
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
    input.trace.model = OPENAI_CHAT_MODEL;
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
    input.trace.incomplete_detected = false;
    input.trace.retry_attempted = false;
    input.trace.retry_succeeded = false;
    input.trace.text_postprocess_applied = false;
  }

  const firstAttempt = await postOpenAiResponses({
    url: OPENAI_RESPONSES_URL,
    apiKey: OPENAI_API_KEY,
    requestPayload,
    surface: "general_chat",
  });

  if (input.trace) {
    input.trace.response_status = firstAttempt.response_status;
    input.trace.response_payload = firstAttempt.response_payload;
    input.trace.incomplete_detected = firstAttempt.incomplete_detected;
  }

  if (!firstAttempt.ok) {
    if (input.trace) {
      input.trace.parsed_response = null;
      input.trace.fallback_reason = "OpenAI request failed";
      input.trace.error = firstAttempt.error;
    }
    return fallbackResponse(
      "GENERAL_CHAT_AI_RUNTIME:fallback_request_failed",
      input.contextPacket.latest_user_message
    );
  }

  let parsed = parseGeneralChatResponse(firstAttempt.response_payload);

  const shouldRetry = shouldRetryAfterAttempt({
    attempt: firstAttempt,
    parseSucceeded: Boolean(parsed),
    alreadyRetried: false,
  });

  if (shouldRetry) {
    if (input.trace) {
      input.trace.retry_attempted = true;
    }

    const retryPayload = withRetryInstruction(
      requestPayload,
      RETRY_SYSTEM_INSTRUCTION
    );
    const retryAttempt = await postOpenAiResponses({
      url: OPENAI_RESPONSES_URL,
      apiKey: OPENAI_API_KEY,
      requestPayload: retryPayload,
      surface: "general_chat",
    });

    if (input.trace) {
      input.trace.response_status = retryAttempt.response_status;
      input.trace.response_payload = retryAttempt.response_payload;
      input.trace.incomplete_detected =
        firstAttempt.incomplete_detected || retryAttempt.incomplete_detected;
    }

    if (retryAttempt.ok) {
      parsed = parseGeneralChatResponse(retryAttempt.response_payload);
      if (input.trace) {
        input.trace.retry_succeeded = Boolean(parsed);
      }
    }
  }

  if (!parsed) {
    if (input.trace) {
      input.trace.parsed_response = null;
      input.trace.fallback_reason = "OpenAI response parsing failed";
      input.trace.error = "OpenAI response parsing failed";
    }
    return fallbackResponse(
      "GENERAL_CHAT_AI_RUNTIME:fallback_parse_failed",
      input.contextPacket.latest_user_message
    );
  }

  const sanitized = sanitizeResponse(parsed, input.contextPacket.latest_user_message);
  if (input.trace) {
    input.trace.parsed_response = sanitized;
    input.trace.fallback_reason = null;
    input.trace.error = null;
  }

  const runtimeNote = "GENERAL_CHAT_AI_RUNTIME:real";
  warnIfLikelyTruncatedAssistantMessage(sanitized.assistant_message);
  return {
    ...sanitized,
    notes: sanitized.notes ? `${runtimeNote}; ${sanitized.notes}` : runtimeNote,
  };
}

const OPENAI_CHAT_COMPLETIONS_URL = "https://api.openai.com/v1/chat/completions";

/**
 * Streams a general chat response via Chat Completions API (stream: true).
 *
 * Calls `onChunk` for every text delta as it arrives — giving ~500 ms first-token
 * latency instead of the 4–6 s full-JSON wait imposed by the Responses API.
 *
 * Returns the fully assembled GeneralChatModelResponse when the stream ends.
 * Falls back to the non-streaming Responses-API path on any fetch/parse error.
 */
export async function streamGeneralChatMessage(input: {
  role: RoleType;
  contextPacket: ChatAiContextPacket;
  forceClarification?: boolean;
  onChunk: (chunk: string) => void;
}): Promise<GeneralChatModelResponse> {
  if (!ENABLE_GENERAL_CHAT_AI) {
    const fb = fallbackResponse(
      "GENERAL_CHAT_AI_RUNTIME:fallback_disabled",
      input.contextPacket.latest_user_message
    );
    input.onChunk(fb.assistant_message);
    return fb;
  }

  const prompts = getRecommendationPromptBundle();
  const hasRecommendationHardConstraints = Boolean(
    input.contextPacket.structured_state.recommendation_state.hard_constraints.size ||
      (input.contextPacket.structured_state.recommendation_state.hard_constraints.colors?.length ?? 0) > 0 ||
      (input.contextPacket.structured_state.recommendation_state.hard_constraints.styles?.length ?? 0) > 0 ||
      input.contextPacket.structured_state.recommendation_state.hard_constraints.shape
  );
  const hasStructuredStateContext = hasRecommendationHardConstraints;
  const hasMemoryContext =
    input.contextPacket.conversation_memory.summary_text.length > 0 ||
    input.contextPacket.conversation_memory.stable_facts.length > 0 ||
    input.contextPacket.conversation_memory.open_threads.length > 0;

  const promptSections = buildGeneralChatPromptSections({
    role: input.role,
    hasStructuredStateContext,
    hasMemoryContext,
    hasRecentTurns: input.contextPacket.recent_turns.length > 0,
    prompts: { system: prompts.system, generalChat: prompts.generalChat },
    contextPacket: input.contextPacket,
    rolePrompt: getRolePrompt(input.role),
  });

  // Convert Responses-API section list to Chat Completions messages.
  // Consecutive sections of the same role are merged with a double newline.
  type ChatMessage = { role: "system" | "user"; content: string };
  const messages: ChatMessage[] = [];
  for (const section of promptSections) {
    const last = messages[messages.length - 1];
    if (last && last.role === section.role) {
      last.content += "\n\n" + section.text;
    } else {
      messages.push({ role: section.role, content: section.text });
    }
  }
  if (input.forceClarification) {
    messages.push({
      role: "system",
      content:
        "Routing context: the user shared constraints but intent is unclear. Ask one concise clarifying question to choose between inventory recommendations vs general advice.",
    });
  }

  let response: Response;
  try {
    response = await fetch(OPENAI_CHAT_COMPLETIONS_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: OPENAI_CHAT_MODEL,
        messages,
        stream: true,
        max_tokens: getMaxOutputTokens("general_chat"),
      }),
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    // Network / timeout — fall back to the Responses-API path (blocking).
    const fb = await generateGeneralChatResponse({
      role: input.role,
      contextPacket: input.contextPacket,
      forceClarification: input.forceClarification,
    });
    input.onChunk(fb.assistant_message);
    return fb;
  }

  if (!response.ok || !response.body) {
    const fb = await generateGeneralChatResponse({
      role: input.role,
      contextPacket: input.contextPacket,
      forceClarification: input.forceClarification,
    });
    input.onChunk(fb.assistant_message);
    return fb;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let fullText = "";
  let buffer = "";

  try {
    outer: while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data: ")) continue;
        const data = trimmed.slice(6);
        if (data === "[DONE]") break outer;
        try {
          const parsed = JSON.parse(data) as {
            choices?: Array<{ delta?: { content?: string }; finish_reason?: string }>;
          };
          const delta = parsed.choices?.[0]?.delta?.content;
          if (typeof delta === "string" && delta.length > 0) {
            fullText += delta;
            input.onChunk(delta);
          }
        } catch {
          // Ignore malformed SSE data lines.
        }
      }
    }
  } finally {
    try { reader.releaseLock(); } catch { /* ignore */ }
  }

  const finalMessage = clampAssistantMessage(toPlainText(fullText));
  if (!finalMessage) {
    const fb = fallbackResponse(
      "GENERAL_CHAT_AI_RUNTIME:stream_empty",
      input.contextPacket.latest_user_message
    );
    // Don't call onChunk again — we already streamed whatever arrived.
    return fb;
  }

  return {
    assistant_message: finalMessage,
    notes: "GENERAL_CHAT_AI_RUNTIME:real:streamed",
    memory_hints: [],
  };
}
