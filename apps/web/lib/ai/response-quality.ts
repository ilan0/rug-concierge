const DEFAULT_PREVIEW_MAX_CHARS = 120;
const DEFAULT_OPENAI_TIMEOUT_MS = 20_000;
const DEFAULT_OPENAI_RETRY_ATTEMPTS = 3;
const DEFAULT_OPENAI_RETRY_BASE_MS = 350;

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

function getOpenAiTimeoutMs(): number {
  return (
    parsePositiveInt(process.env.OPENAI_TIMEOUT_MS) ??
    DEFAULT_OPENAI_TIMEOUT_MS
  );
}

function getOpenAiRetryAttempts(): number {
  const parsed = parsePositiveInt(process.env.OPENAI_RETRY_ATTEMPTS);
  if (!parsed) return DEFAULT_OPENAI_RETRY_ATTEMPTS;
  return Math.min(parsed, 5);
}

function getOpenAiRetryBaseMs(): number {
  return (
    parsePositiveInt(process.env.OPENAI_RETRY_BASE_MS) ??
    DEFAULT_OPENAI_RETRY_BASE_MS
  );
}

function isRetryableOpenAiStatus(status: number): boolean {
  return status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

function retryDelayMs(attemptNumber: number): number {
  const base = getOpenAiRetryBaseMs();
  const exponent = Math.max(0, attemptNumber - 1);
  const backoff = base * 2 ** exponent;
  const jitter = Math.floor(Math.random() * base);
  return Math.min(backoff + jitter, 5_000);
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export function getMaxOutputTokens(surface: OpenAiSurface): number {
  const defaultBySurface: Record<OpenAiSurface, number> = {
    general_chat: 300,
    recommendation: 500,
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
  const maxAttempts = getOpenAiRetryAttempts();

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), getOpenAiTimeoutMs());
    const response = await fetch(input.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${input.apiKey}`,
      },
      body: JSON.stringify(input.requestPayload),
      signal: controller.signal,
    }).catch(() => null);
    clearTimeout(timeout);

    if (!response) {
      if (attempt < maxAttempts) {
        await sleep(retryDelayMs(attempt));
        continue;
      }
      return {
        response_status: null,
        response_payload: null,
        error: "OpenAI request failed: network error or timeout",
        incomplete_detected: false,
        ok: false,
      };
    }

    const payload = (await response.json().catch(() => null)) as unknown;
    const incompleteDetected = detectIncompleteResponsePayload(payload);

    if (!response.ok) {
      if (attempt < maxAttempts && isRetryableOpenAiStatus(response.status)) {
        await sleep(retryDelayMs(attempt));
        continue;
      }
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

  return {
    response_status: null,
    response_payload: null,
    error: "OpenAI request failed after retries",
    incomplete_detected: false,
    ok: false,
  };
}
