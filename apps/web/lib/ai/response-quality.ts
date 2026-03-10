const DEFAULT_PREVIEW_MAX_CHARS = 120;

export type OpenAiSurface = "general_chat" | "recommendation";

export type OpenAiAttempt = {
  response_status: number | null;
  response_payload: unknown | null;
  error: string | null;
  incomplete_detected: boolean;
  ok: boolean;
};

function parsePositiveInt(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

export function getMaxOutputTokens(surface: OpenAiSurface): number {
  const defaultBySurface: Record<OpenAiSurface, number> = {
    general_chat: 300,
    recommendation: 700,
  };

  const envBySurface: Record<OpenAiSurface, string | undefined> = {
    general_chat: process.env.OPENAI_MAX_OUTPUT_TOKENS_GENERAL_CHAT,
    recommendation: process.env.OPENAI_MAX_OUTPUT_TOKENS_RECOMMENDATION,
  };

  return parsePositiveInt(envBySurface[surface]) ?? defaultBySurface[surface];
}

export function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function toPreviewText(value: string, maxChars = DEFAULT_PREVIEW_MAX_CHARS): string {
  const normalized = normalizeText(value);
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, maxChars - 1).trimEnd()}…`;
}

export function detectIncompleteResponsePayload(payload: unknown): boolean {
  if (!payload || typeof payload !== "object") return false;
  const data = payload as Record<string, unknown>;
  if (data.status === "incomplete") return true;
  if (data.incomplete_details && typeof data.incomplete_details === "object") return true;
  return false;
}

export function shouldRetryAfterAttempt(input: {
  attempt: OpenAiAttempt;
  parseSucceeded: boolean;
  alreadyRetried: boolean;
}): boolean {
  if (input.alreadyRetried) return false;
  if (!input.attempt.ok) return false;
  return input.attempt.incomplete_detected || !input.parseSucceeded;
}

export function withRetryInstruction<T extends { input?: unknown }>(
  payload: T,
  instruction: string
): T {
  const inputBlocks = Array.isArray(payload.input) ? payload.input : [];
  return {
    ...payload,
    input: [
      ...inputBlocks,
      {
        role: "system",
        content: [
          {
            type: "input_text",
            text: instruction,
          },
        ],
      },
    ],
  };
}

export async function postOpenAiResponses(input: {
  url: string;
  apiKey: string;
  requestPayload: unknown;
}): Promise<OpenAiAttempt> {
  const response = await fetch(input.url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${input.apiKey}`,
    },
    body: JSON.stringify(input.requestPayload),
  }).catch(() => null);

  if (!response) {
    return {
      response_status: null,
      response_payload: null,
      error: "OpenAI request failed: network error",
      incomplete_detected: false,
      ok: false,
    };
  }

  const payload = (await response.json().catch(() => null)) as unknown;
  const incompleteDetected = detectIncompleteResponsePayload(payload);

  if (!response.ok) {
    return {
      response_status: response.status,
      response_payload: payload,
      error: `OpenAI request failed with status ${response.status}`,
      incomplete_detected: incompleteDetected,
      ok: false,
    };
  }

  return {
    response_status: response.status,
    response_payload: payload,
    error: null,
    incomplete_detected: incompleteDetected,
    ok: true,
  };
}
