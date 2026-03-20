import type { ChatMode, SessionData, SessionMessage } from "@/lib/chat/types";

const MAX_SUMMARY_CHARS = 900;
const MAX_STABLE_FACTS = 12;
const MAX_STABLE_FACT_CHARS = 90;
const MAX_OPEN_THREADS = 6;
const MAX_OPEN_THREAD_CHARS = 120;
const DEFAULT_HISTORY_LIMIT = 20;

const ROOM_TERMS = [
  "living room",
  "dining room",
  "bedroom",
  "kitchen",
  "hallway",
  "entryway",
  "office",
  "bathroom",
  "nursery",
];

const PRACTICAL_TERMS = [
  "pets",
  "kids",
  "high traffic",
  "low pile",
  "easy to clean",
  "durable",
  "allergies",
  "maintenance",
];

const STYLE_TERMS = [
  "kazak",
  "oushak",
  "serapi",
  "moroccan",
  "modern",
  "traditional",
  "vintage",
  "minimal",
  "tribal",
];

const PALETTE_TERMS = [
  "neutral",
  "earthy",
  "ivory",
  "beige",
  "brown",
  "blue",
  "green",
  "red",
  "purple",
  "gold",
  "muted",
  "warm",
  "cool",
];

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function trimToChars(value: string, maxChars: number): string {
  const normalized = normalizeText(value);
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, maxChars - 1).trimEnd()}…`;
}

function dedupeCaseInsensitive(values: string[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values) {
    const normalized = normalizeText(value);
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(normalized);
  }
  return output;
}

function compactList(values: string[], maxItems: number, maxChars: number): string[] {
  return dedupeCaseInsensitive(values)
    .map((value) => trimToChars(value, maxChars))
    .slice(0, maxItems);
}

function summarizeExchange(userMessage: string, assistantMessage: string): string {
  const user = trimToChars(userMessage || "(no user message)", 180);
  const assistant = trimToChars(assistantMessage || "(no assistant message)", 220);
  return `User: ${user} | Assistant: ${assistant}`;
}

function mergeSummary(previousSummary: string, exchangeSummary: string): string {
  const joined = previousSummary
    ? `${normalizeText(previousSummary)} || ${exchangeSummary}`
    : exchangeSummary;
  if (joined.length <= MAX_SUMMARY_CHARS) return joined;
  return `…${joined.slice(joined.length - (MAX_SUMMARY_CHARS - 1)).trimStart()}`;
}

function extractPreferenceStatement(userMessage: string): string | null {
  const match = userMessage.match(
    /\b(?:i\s+(?:like|prefer|want)|we\s+(?:like|prefer|want)|my\s+client\s+(?:likes|prefers|wants))\b([^.!?]{3,120})/i
  );
  if (!match) return null;
  return trimToChars(`preference ${match[0]}`, MAX_STABLE_FACT_CHARS);
}

function extractQuestionSentences(value: string): string[] {
  return value
    .split(/(?<=[.!?])\s+/)
    .map((part) => normalizeText(part))
    .filter((part) => part.endsWith("?"));
}

export function buildInitialConversationMemory(now = new Date().toISOString()) {
  return {
    summary_text: "",
    stable_facts: [] as string[],
    open_threads: [] as string[],
    last_user_intent: "unknown" as const,
    updated_at: now,
    version: "v1" as const,
  };
}

export function trimChatHistory(
  messages: SessionMessage[],
  limit = DEFAULT_HISTORY_LIMIT
): SessionMessage[] {
  if (messages.length <= limit) return messages;
  return messages.slice(-limit);
}

export function extractStableFactsFromUserMessage(userMessage: string): string[] {
  const text = userMessage.toLowerCase();
  const facts: string[] = [];

  for (const room of ROOM_TERMS) {
    if (text.includes(room)) facts.push(`room ${room}`);
  }

  for (const term of PRACTICAL_TERMS) {
    if (term === "maintenance") {
      if (
        /\bmaintenance\b/.test(text) ||
        /\brug care\b/.test(text) ||
        /\bcare instructions?\b/.test(text) ||
        /\bhow (do i|to) care for\b/.test(text)
      ) {
        facts.push(`practical ${term}`);
      }
      continue;
    }
    if (text.includes(term)) facts.push(`practical ${term}`);
  }

  for (const term of STYLE_TERMS) {
    if (text.includes(term)) facts.push(`style ${term}`);
  }

  for (const term of PALETTE_TERMS) {
    if (text.includes(term)) facts.push(`palette ${term}`);
  }

  const preference = extractPreferenceStatement(userMessage);
  if (preference) facts.push(preference);

  return compactList(facts, MAX_STABLE_FACTS, MAX_STABLE_FACT_CHARS);
}

export function extractOpenThreadSignals(
  userMessage: string,
  assistantMessage: string
): string[] {
  const threads: string[] = [];

  if (userMessage.includes("?")) {
    threads.push(...extractQuestionSentences(userMessage));
  } else if (/\b(?:how|what|which|can you|should i|do you think)\b/i.test(userMessage)) {
    threads.push(trimToChars(userMessage, MAX_OPEN_THREAD_CHARS));
  }

  threads.push(...extractQuestionSentences(assistantMessage));

  return compactList(threads, MAX_OPEN_THREADS, MAX_OPEN_THREAD_CHARS);
}

export function mergeConversationMemory(
  previous: SessionData["conversation_memory"] | null | undefined,
  input: {
    userMessage: string;
    assistantMessage: string;
    lastUserIntent: ChatMode;
    memoryHints?: string[];
    now?: string;
  }
): SessionData["conversation_memory"] {
  const nextNow = input.now ?? new Date().toISOString();
  const base = previous ?? buildInitialConversationMemory(nextNow);

  const extractedFacts = extractStableFactsFromUserMessage(input.userMessage);
  const memoryHints = compactList(input.memoryHints ?? [], MAX_STABLE_FACTS, MAX_STABLE_FACT_CHARS);
  const stableFacts = compactList(
    [...extractedFacts, ...memoryHints, ...base.stable_facts],
    MAX_STABLE_FACTS,
    MAX_STABLE_FACT_CHARS
  );

  const extractedThreads = extractOpenThreadSignals(
    input.userMessage,
    input.assistantMessage
  );
  const openThreads = compactList(
    [...extractedThreads, ...base.open_threads],
    MAX_OPEN_THREADS,
    MAX_OPEN_THREAD_CHARS
  );

  const exchange = summarizeExchange(input.userMessage, input.assistantMessage);
  const summaryText = mergeSummary(base.summary_text, exchange);

  return {
    summary_text: summaryText,
    stable_facts: stableFacts,
    open_threads: openThreads,
    last_user_intent: input.lastUserIntent,
    updated_at: nextNow,
    version: "v1",
  };
}

export function toAiMemoryPacket(memory: SessionData["conversation_memory"]) {
  return {
    summary_text: trimToChars(memory.summary_text, MAX_SUMMARY_CHARS),
    stable_facts: compactList(
      memory.stable_facts,
      MAX_STABLE_FACTS,
      MAX_STABLE_FACT_CHARS
    ),
    open_threads: compactList(
      memory.open_threads,
      MAX_OPEN_THREADS,
      MAX_OPEN_THREAD_CHARS
    ),
    last_user_intent: memory.last_user_intent,
    version: memory.version,
  };
}

export function ensureConversationMemory(
  memory: SessionData["conversation_memory"] | null | undefined
): SessionData["conversation_memory"] {
  if (!memory) return buildInitialConversationMemory();

  return {
    summary_text: trimToChars(memory.summary_text ?? "", MAX_SUMMARY_CHARS),
    stable_facts: compactList(memory.stable_facts ?? [], MAX_STABLE_FACTS, MAX_STABLE_FACT_CHARS),
    open_threads: compactList(memory.open_threads ?? [], MAX_OPEN_THREADS, MAX_OPEN_THREAD_CHARS),
    last_user_intent:
      memory.last_user_intent === "general_chat" ||
      memory.last_user_intent === "recommendation"
        ? memory.last_user_intent
        : "unknown",
    updated_at: typeof memory.updated_at === "string" ? memory.updated_at : new Date().toISOString(),
    version: "v1",
  };
}
