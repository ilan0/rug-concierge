import "server-only";

type NodeEnv = "development" | "production" | "test";

type RequiredEnvName =
  | "SUPABASE_URL"
  | "SUPABASE_SECRET_KEY"
  | "OPENAI_API_KEY"
  | "OPENAI_CHAT_MODEL"
  | "OPENAI_VISION_MODEL"
  | "UPSTASH_REDIS_REST_URL"
  | "UPSTASH_REDIS_REST_TOKEN"
  | "ENABLE_GENERAL_CHAT_AI";

function readTrimmedEnv(name: string): string | null {
  const raw = process.env[name];
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function formatConfigError(messages: string[]): Error {
  return new Error(
    [
      "[config] Invalid apps/web runtime configuration:",
      ...messages.map((message) => `- ${message}`),
    ].join("\n")
  );
}

function requireString(name: RequiredEnvName, errors: string[]): string {
  const value = readTrimmedEnv(name);
  if (!value) {
    errors.push(`Missing required environment variable: ${name}`);
    return "";
  }
  return value;
}

function requireHttpUrl(name: RequiredEnvName, errors: string[]): string {
  const value = requireString(name, errors);
  if (!value) return value;

  try {
    const parsed = new URL(value);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return value;
    }
  } catch {
    // Validation error handled below.
  }

  errors.push(`${name} must be a valid http(s) URL.`);
  return value;
}

function requireBoolean(name: RequiredEnvName, errors: string[]): boolean {
  const value = requireString(name, errors).toLowerCase();
  if (value === "1" || value === "true") return true;
  if (value === "0" || value === "false") return false;

  errors.push(`Invalid value for ${name}: expected one of 1, 0, true, false.`);
  return false;
}

function parseNodeEnv(): NodeEnv {
  const value = readTrimmedEnv("NODE_ENV");
  if (!value) return "development";
  if (value === "development" || value === "production" || value === "test") {
    return value;
  }
  throw formatConfigError([
    `NODE_ENV must be one of: development, production, test. Received "${value}".`,
  ]);
}

const NODE_ENV = parseNodeEnv();
const errors: string[] = [];

const SUPABASE_URL = requireHttpUrl("SUPABASE_URL", errors);
const SUPABASE_SECRET_KEY = requireString("SUPABASE_SECRET_KEY", errors);
const OPENAI_API_KEY = requireString("OPENAI_API_KEY", errors);
const OPENAI_CHAT_MODEL = requireString("OPENAI_CHAT_MODEL", errors);
const OPENAI_VISION_MODEL = requireString("OPENAI_VISION_MODEL", errors);
const UPSTASH_REDIS_REST_URL = requireHttpUrl("UPSTASH_REDIS_REST_URL", errors);
const UPSTASH_REDIS_REST_TOKEN = requireString(
  "UPSTASH_REDIS_REST_TOKEN",
  errors
);
const ENABLE_GENERAL_CHAT_AI = requireBoolean(
  "ENABLE_GENERAL_CHAT_AI",
  errors
);

if (errors.length > 0) {
  throw formatConfigError(errors);
}

export { NODE_ENV };

export const IS_PRODUCTION = NODE_ENV === "production";

export {
  ENABLE_GENERAL_CHAT_AI,
  OPENAI_API_KEY,
  OPENAI_CHAT_MODEL,
  OPENAI_VISION_MODEL,
  SUPABASE_SECRET_KEY,
  SUPABASE_URL,
  UPSTASH_REDIS_REST_TOKEN,
  UPSTASH_REDIS_REST_URL,
};

export const CHAT_MEMORY_V1 = true;
export const CHAT_MEMORY_ENABLED = CHAT_MEMORY_V1;
export const CHAT_PERSISTENCE_FAIL_OPEN = true;
export const DEFAULT_STORE_NAME = "Rug Concierge";
export const MAX_IN_MEMORY_SESSIONS = 500;
export const OPENAI_MAX_OUTPUT_TOKENS_GENERAL_CHAT = 500;
export const OPENAI_MAX_OUTPUT_TOKENS_RECOMMENDATION = 800;
export const OPENAI_MAX_OUTPUT_TOKENS_VISION_ENRICHMENT = 450;
export const OPENAI_RETRY_ATTEMPTS = 2;
export const OPENAI_RETRY_ATTEMPTS_GENERAL_CHAT = 2;
export const OPENAI_RETRY_ATTEMPTS_RECOMMENDATION = 1;
export const OPENAI_RETRY_ATTEMPTS_VISION_ENRICHMENT = 2;
export const OPENAI_RETRY_BASE_MS = 350;
export const OPENAI_TIMEOUT_MS = 30_000;
export const OPENAI_TIMEOUT_MS_GENERAL_CHAT = 20_000;
export const OPENAI_TIMEOUT_MS_RECOMMENDATION = 8_000;
export const OPENAI_TIMEOUT_MS_VISION_ENRICHMENT = 30_000;
