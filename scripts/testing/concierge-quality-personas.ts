#!/usr/bin/env tsx

import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

type Role = "retail_customer";

type ChatApiPayload = {
  session_id: string;
  mode: "general_chat" | "recommendation";
  fine_mode: string;
  response: {
    assistant_message: string;
    recommendations?: Array<{
      rug_id: string;
      title: string;
      style: string | null;
      origin: string | null;
      size_text: string | null;
      match_reasons: string[];
    }>;
    notes?: string | null;
  };
};

type PersonaTurn = {
  message: string;
  expect: {
    mode?: "recommendation" | "general_chat";
    fineMode?: "recommendation" | "general_chat" | "disambiguation" | "no_match";
  };
};

type Persona = {
  id: string;
  name: string;
  profile: string;
  turns: PersonaTurn[];
};

type JudgeScore = {
  warmth: number;
  engagement: number;
  grounded: number;
  graceful_no_match: number;
  taste: number;
  notes: string;
};

type TurnScore = {
  persona: string;
  turn: number;
  message: string;
  assistant: string;
  mode: string;
  score: JudgeScore;
};

type AssertionFailure = {
  persona: string;
  turn: number;
  message: string;
  reason: string;
};

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const APP_DIR = path.resolve(REPO_ROOT, "apps", "web");
const PORT = 4114;
const RUN_ID = `concierge-quality-personas-${Date.now()}`;
const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";

const TRADITIONAL_TOKENS = [
  "traditional",
  "persian",
  "heriz",
  "serapi",
  "kashan",
  "tabriz",
  "isfahan",
  "tribal",
  "kazak",
  "shirvan",
  "baluch",
  "oushak",
];

const PERSONAS: Persona[] = [
  {
    id: "p01",
    name: "Decisive Buyer",
    profile: "Needs a formal dining-room piece with concrete specs.",
    turns: [
      { message: "I need a 9x12 traditional Persian for my formal dining room.", expect: { mode: "recommendation" } },
      { message: "Show me more with richer reds.", expect: { mode: "recommendation" } },
      { message: "I like the first one but slightly larger if possible.", expect: { mode: "recommendation" } },
    ],
  },
  {
    id: "p02",
    name: "Vague Browser",
    profile: "Open browse, wants inspiration first.",
    turns: [
      { message: "I'm just looking. Show me what you have.", expect: { mode: "recommendation" } },
      { message: "These are nice. Show something bolder.", expect: { mode: "recommendation" } },
      { message: "Maybe less busy than that.", expect: { mode: "recommendation" } },
    ],
  },
  {
    id: "p03",
    name: "Minimalist",
    profile: "Modern, understated, anti-traditional.",
    turns: [
      { message: "I want a modern 8x10, understated, nothing traditional.", expect: { mode: "recommendation" } },
      { message: "Show me more like the cleanest one.", expect: { mode: "recommendation" } },
      { message: "What is the difference between modern and transitional?", expect: { mode: "general_chat" } },
    ],
  },
  {
    id: "p04",
    name: "Practical Parent",
    profile: "Durability and easy-clean priorities.",
    turns: [
      { message: "We have two kids and a dog. Need something easy to clean for the living room.", expect: { mode: "recommendation" } },
      { message: "Prefer mid-size around 6x9.", expect: { mode: "recommendation" } },
      { message: "Less light colors please.", expect: { mode: "recommendation" } },
    ],
  },
  {
    id: "p05",
    name: "Designer",
    profile: "Warm terracotta + cream palette anchor search.",
    turns: [
      { message: "I'm redesigning a room with terracotta and cream. Need an anchor rug.", expect: { mode: "recommendation" } },
      { message: "Show me larger options.", expect: { mode: "recommendation" } },
      { message: "I like the pattern but not that color direction.", expect: { mode: "recommendation" } },
    ],
  },
  {
    id: "p06",
    name: "Gift Buyer",
    profile: "Traditional taste for entryway gift.",
    turns: [
      { message: "I want a gift rug for my mother, entryway size, traditional taste.", expect: { mode: "recommendation" } },
      { message: "Can you show more elegant ones?", expect: { mode: "recommendation" } },
    ],
  },
  {
    id: "p07",
    name: "Skeptic",
    profile: "Doubts AI can help; needs confidence and clarity.",
    turns: [
      { message: "I don't think an AI can help, but show me a few options for a living room.", expect: { mode: "recommendation" } },
      { message: "Okay maybe around 8x10 then.", expect: { mode: "recommendation" } },
    ],
  },
  {
    id: "p08",
    name: "First Timer",
    profile: "Overwhelmed beginner.",
    turns: [
      { message: "I've never bought a rug before. I don't know where to start.", expect: { mode: "recommendation" } },
      { message: "It's for my bedroom.", expect: { mode: "recommendation" } },
      { message: "Show me calmer options.", expect: { mode: "recommendation" } },
    ],
  },
  {
    id: "p09",
    name: "Size Specific",
    profile: "Strict fit requirement.",
    turns: [
      { message: "It has to be exactly 6x9. Very precise space.", expect: { mode: "recommendation" } },
      { message: "If exact isn't available, show closest.", expect: { mode: "recommendation" } },
    ],
  },
  {
    id: "p10",
    name: "Budget Constrained",
    profile: "Budget-conscious, still wants style.",
    turns: [
      { message: "I can only spend 400 max. Need something for my kitchen.", expect: { mode: "recommendation" } },
      { message: "Show runner options around 2x8.", expect: { mode: "recommendation" } },
    ],
  },
  {
    id: "p11",
    name: "Neutral Shopper",
    profile: "Neutral palette, low risk.",
    turns: [
      { message: "I need something neutral that goes with everything.", expect: { mode: "recommendation" } },
      { message: "No bold reds please.", expect: { mode: "recommendation" } },
    ],
  },
  {
    id: "p12",
    name: "Color Lover",
    profile: "Wants personality and color.",
    turns: [
      { message: "I want personality, not beige. Surprise me.", expect: { mode: "recommendation" } },
      { message: "Leaning blue or teal now.", expect: { mode: "recommendation" } },
    ],
  },
  {
    id: "p13",
    name: "Runner Seeker",
    profile: "Hallway runner with tight dimensions.",
    turns: [
      { message: "I need a hallway runner about 3 by 12.", expect: { mode: "recommendation" } },
      { message: "Show slightly shorter options too.", expect: { mode: "recommendation" } },
    ],
  },
  {
    id: "p14",
    name: "High Traffic",
    profile: "Beach house durability.",
    turns: [
      { message: "This is for a beach house, high traffic. Need tough options.", expect: { mode: "recommendation" } },
      { message: "Prefer larger anchor sizes.", expect: { mode: "recommendation" } },
    ],
  },
  {
    id: "p15",
    name: "Followup Navigator",
    profile: "Starts broad then narrows quickly.",
    turns: [
      { message: "Show me what you've got.", expect: { mode: "recommendation" } },
      { message: "I like the rust one.", expect: { mode: "recommendation" } },
      { message: "More like that but bigger.", expect: { mode: "recommendation" } },
    ],
  },
  {
    id: "p16",
    name: "Style Switcher",
    profile: "Changes mind mid-conversation.",
    turns: [
      { message: "Show modern options around 8x10.", expect: { mode: "recommendation" } },
      { message: "Actually forget modern, show me something more traditional.", expect: { mode: "recommendation" } },
    ],
  },
  {
    id: "p17",
    name: "Purchase Ready",
    profile: "Ready to buy after shortlist.",
    turns: [
      { message: "Show me traditional 8x10 options.", expect: { mode: "recommendation" } },
      { message: "I love the third one. I'll take it.", expect: { mode: "general_chat" } },
    ],
  },
  {
    id: "p18",
    name: "Multi-room Shopper",
    profile: "Needs bedroom and entryway.",
    turns: [
      { message: "I need something for my bedroom and also an entryway rug.", expect: { mode: "recommendation" } },
      { message: "Start with bedroom anchor options.", expect: { mode: "recommendation" } },
      { message: "Now show entryway sized options.", expect: { mode: "recommendation" } },
    ],
  },
  {
    id: "p19",
    name: "Knowledge Tester",
    profile: "Education then shopping bridge.",
    turns: [
      { message: "What's the difference between a Heriz and a Serapi?", expect: { mode: "general_chat" } },
      { message: "Great, now show me Heriz options.", expect: { mode: "recommendation" } },
    ],
  },
  {
    id: "p20",
    name: "Impossible Request",
    profile: "Unreasonable dimensions should be handled honestly.",
    turns: [
      { message: "I need a 50 by 50 rug.", expect: { mode: "recommendation" } },
      { message: "Okay show me the closest biggest options.", expect: { mode: "recommendation" } },
    ],
  },
];

function loadEnvFile(filePath: string): Record<string, string> {
  const env: Record<string, string> = {};
  if (!fs.existsSync(filePath)) return env;
  const content = fs.readFileSync(filePath, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

function buildServerEnv(): Record<string, string> {
  const localEnv = loadEnvFile(path.resolve(APP_DIR, ".env.local"));
  const chatModel =
    process.env.OPENAI_CHAT_MODEL ??
    localEnv.OPENAI_CHAT_MODEL ??
    localEnv.OPENAI_MODEL ??
    "gpt-4.1-mini";

  return {
    ...process.env,
    ...localEnv,
    NODE_ENV: "development",
    OPENAI_CHAT_MODEL: chatModel,
    OPENAI_VISION_MODEL:
      process.env.OPENAI_VISION_MODEL ?? localEnv.OPENAI_VISION_MODEL ?? chatModel,
    ENABLE_GENERAL_CHAT_AI:
      process.env.ENABLE_GENERAL_CHAT_AI ?? localEnv.ENABLE_GENERAL_CHAT_AI ?? "true",
    UPSTASH_REDIS_REST_URL:
      process.env.UPSTASH_REDIS_REST_URL ??
      localEnv.UPSTASH_REDIS_REST_URL ??
      "https://example.upstash.io",
    UPSTASH_REDIS_REST_TOKEN:
      process.env.UPSTASH_REDIS_REST_TOKEN ??
      localEnv.UPSTASH_REDIS_REST_TOKEN ??
      "dummy",
  };
}

async function waitForServerReady(baseUrl: string, timeoutMs = 180000): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(`${baseUrl}/api/manifest`);
      if (response.ok) return;
    } catch {
      // retry
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`Server did not become ready at ${baseUrl}.`);
}

async function startServer(): Promise<{ baseUrl: string; stop: () => Promise<void> }> {
  const baseUrl = `http://127.0.0.1:${PORT}`;
  const env = buildServerEnv();

  const child = spawn(
    "npm",
    ["--workspace", "apps/web", "run", "dev", "--", "--port", String(PORT)],
    {
      cwd: REPO_ROOT,
      env,
      stdio: ["ignore", "ignore", "pipe"],
    }
  );

  let stderrTail = "";
  child.stderr?.on("data", (chunk) => {
    stderrTail = `${stderrTail}${chunk.toString()}`.slice(-4000);
  });

  await waitForServerReady(baseUrl).catch((error) => {
    child.kill("SIGTERM");
    throw new Error(`${String(error)}\nServer stderr tail:\n${stderrTail}`);
  });

  return {
    baseUrl,
    stop: async () => {
      if (child.killed || child.exitCode !== null) return;
      child.kill("SIGTERM");
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          if (!child.killed) child.kill("SIGKILL");
          resolve();
        }, 6000);
        child.once("exit", () => {
          clearTimeout(timer);
          resolve();
        });
      });
    },
  };
}

async function sendChatTurn(input: {
  baseUrl: string;
  caseId: string;
  sessionId: string;
  message: string;
  role?: Role;
}): Promise<ChatApiPayload> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120000);
  let response: Response;
  try {
    response = await fetch(`${input.baseUrl}/api/chat`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-e2e-trace-run": RUN_ID,
        "x-e2e-trace-case": input.caseId,
        "x-forwarded-host": "jjrugs.rugdesk.app",
      },
      body: JSON.stringify({
        session_id: input.sessionId,
        message: input.message,
        role: input.role ?? "retail_customer",
      }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Chat failed ${response.status} (${input.caseId}): ${text}`);
  }

  const payload = JSON.parse(text) as ChatApiPayload;
  return payload;
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function parseRequestedSizeLongSideIn(message: string): number | null {
  const match = message
    .toLowerCase()
    .match(/(\d{1,3}(?:\.\d+)?)\s*(?:ft|feet|')?\s*(?:x|×|by)\s*(\d{1,3}(?:\.\d+)?)\s*(?:ft|feet|')?/i);
  if (!match) return null;
  const width = Number(match[1]);
  const length = Number(match[2]);
  if (!Number.isFinite(width) || !Number.isFinite(length)) return null;
  const hasFeet = /\b(ft|feet)\b|'/i.test(message);
  const widthIn = hasFeet ? Math.round(width * 12) : Math.round(width);
  const lengthIn = hasFeet ? Math.round(length * 12) : Math.round(length);
  return Math.max(widthIn, lengthIn);
}

function parseSizeTextLongSideIn(sizeText: string | null | undefined): number | null {
  if (!sizeText) return null;
  const parseDimensionIn = (part: string): number | null => {
    const feetMatch = part.match(/(\d+)\s*'/);
    const inchMatch = part.match(/'(\d+)\"/);
    if (feetMatch || inchMatch) {
      const feet = feetMatch ? Number(feetMatch[1]) : 0;
      const inches = inchMatch ? Number(inchMatch[1]) : 0;
      const total = feet * 12 + inches;
      return Number.isFinite(total) ? total : null;
    }
    const asNum = Number(part.replace(/[^0-9.]/g, ""));
    return Number.isFinite(asNum) ? asNum : null;
  };
  const parts = sizeText.split(/x|×/i).map((p) => p.trim());
  if (parts.length !== 2) return null;
  const a = parseDimensionIn(parts[0]);
  const b = parseDimensionIn(parts[1]);
  if (a === null || b === null) return null;
  return Math.max(a, b);
}

function hasDisclosure(text: string): boolean {
  return /don't have|do not have|closest|exact match|not available|unavailable|showing alternatives/i.test(
    text
  );
}

function extractRoom(message: string): string | null {
  const text = normalizeText(message);
  if (/living room/.test(text)) return "living room";
  if (/dining room/.test(text)) return "dining room";
  if (/bedroom/.test(text)) return "bedroom";
  if (/hallway|hall/.test(text)) return "hallway";
  if (/entryway|entry/.test(text)) return "entryway";
  if (/kitchen/.test(text)) return "kitchen";
  if (/office/.test(text)) return "office";
  return null;
}

function runDeterministicChecks(input: {
  persona: Persona;
  turnIndex: number;
  turn: PersonaTurn;
  payload: ChatApiPayload;
  knownRoom: string | null;
  hadPriorRecommendations: boolean;
}): AssertionFailure[] {
  const failures: AssertionFailure[] = [];
  const { persona, turnIndex, turn, payload } = input;
  const assistant = payload.response.assistant_message ?? "";
  const recs = payload.response.recommendations ?? [];
  const normalizedMessage = normalizeText(turn.message);
  const disclosure = hasDisclosure(assistant);

  if (turn.expect.mode && payload.mode !== turn.expect.mode) {
    failures.push({
      persona: persona.name,
      turn: turnIndex + 1,
      message: turn.message,
      reason: `Expected mode=${turn.expect.mode}, got mode=${payload.mode}`,
    });
  }

  if (turn.expect.fineMode && payload.fine_mode !== turn.expect.fineMode) {
    failures.push({
      persona: persona.name,
      turn: turnIndex + 1,
      message: turn.message,
      reason: `Expected fine_mode=${turn.expect.fineMode}, got ${payload.fine_mode}`,
    });
  }

  const modernPositiveSignal =
    /\bmodern|contemporary|minimal|minimalist\b/.test(normalizedMessage) &&
    !/\b(forget modern|not modern|more traditional|instead traditional)\b/.test(
      normalizedMessage
    );
  if (modernPositiveSignal && recs.length > 0 && !disclosure) {
    const hasTraditional = recs.some((rec) => {
      const hay = normalizeText(`${rec.title} ${rec.style ?? ""} ${rec.origin ?? ""}`);
      return TRADITIONAL_TOKENS.some((token) => hay.includes(token));
    });
    if (hasTraditional) {
      failures.push({
        persona: persona.name,
        turn: turnIndex + 1,
        message: turn.message,
        reason: "Modern request returned traditional cards without disclosure.",
      });
    }
  }

  const requestedLongSide = parseRequestedSizeLongSideIn(turn.message);
  if (requestedLongSide && recs.length > 0 && !disclosure) {
    const hasTooSmall = recs.some((rec) => {
      const cardLong = parseSizeTextLongSideIn(rec.size_text);
      return cardLong !== null && cardLong < requestedLongSide - 24;
    });
    if (hasTooSmall) {
      failures.push({
        persona: persona.name,
        turn: turnIndex + 1,
        message: turn.message,
        reason: "Returned cards are >24in smaller than requested without disclosure.",
      });
    }
  }

  if (/\brunner\b/.test(normalizedMessage) && recs.length > 0 && !disclosure) {
    const parseDimensionIn = (part: string): number | null => {
      const feetMatch = part.match(/(\d+)\s*'/);
      const inchMatch = part.match(/'(\d+)\"/);
      if (feetMatch || inchMatch) {
        const feet = feetMatch ? Number(feetMatch[1]) : 0;
        const inches = inchMatch ? Number(inchMatch[1]) : 0;
        const total = feet * 12 + inches;
        return Number.isFinite(total) ? total : null;
      }
      const asNum = Number(part.replace(/[^0-9.]/g, ""));
      return Number.isFinite(asNum) ? asNum : null;
    };
    const hasNonRunner = recs.some((rec) => {
      const longSide = parseSizeTextLongSideIn(rec.size_text);
      if (!longSide) return false;
      const size = rec.size_text ?? "";
      const parts = size.split(/x|×/i).map((p) => p.trim());
      if (parts.length !== 2) return true;
      const a = parseDimensionIn(parts[0]);
      const b = parseDimensionIn(parts[1]);
      if (a === null || b === null) return true;
      const short = Math.min(a, b);
      const long = Math.max(a, b);
      return !(short <= 42 && long >= 84 && long / short >= 2.2);
    });
    if (hasNonRunner) {
      failures.push({
        persona: persona.name,
        turn: turnIndex + 1,
        message: turn.message,
        reason: "Runner request returned non-runner cards without disclosure.",
      });
    }
  }

  if (input.knownRoom && /what kind of space are you decorating/i.test(assistant)) {
    failures.push({
      persona: persona.name,
      turn: turnIndex + 1,
      message: turn.message,
      reason: "Asked for room type even though room context was already known.",
    });
  }

  const isReferenceTurn = /\b(first|second|third|that one|this one|that rug)\b/i.test(
    turn.message
  );
  const isPurchaseTurn = /\b(i'll take|i will take|buy|checkout|check out|go with that)\b/i.test(
    normalizedMessage
  );
  if (isReferenceTurn && input.hadPriorRecommendations) {
    const hasReferenceAwareness = /you liked|you asked|that one|similar|larger|smaller|closest/i.test(
      assistant
    );
    if (!hasReferenceAwareness && !isPurchaseTurn) {
      failures.push({
        persona: persona.name,
        turn: turnIndex + 1,
        message: turn.message,
        reason: "Followup reference did not show context awareness.",
      });
    }
  }

  if ((payload.response.notes ?? "").includes("SIZE_RELAX_STRONG") && !disclosure) {
    failures.push({
      persona: persona.name,
      turn: turnIndex + 1,
      message: turn.message,
      reason: "Strong size relaxation occurred without front disclosure.",
    });
  }

  return failures;
}

async function judgeTurnQuality(input: {
  persona: Persona;
  history: Array<{ role: "user" | "assistant"; text: string }>;
  userMessage: string;
  payload: ChatApiPayload;
  model: string;
  apiKey: string;
}): Promise<JudgeScore> {
  const parseOutputText = (payload: Record<string, unknown>): string | null => {
    if (typeof payload.output_text === "string" && payload.output_text.trim().length > 0) {
      return payload.output_text;
    }
    const output = Array.isArray(payload.output) ? payload.output : [];
    for (const item of output) {
      if (!item || typeof item !== "object") continue;
      const content = Array.isArray((item as Record<string, unknown>).content)
        ? ((item as Record<string, unknown>).content as unknown[])
        : [];
      for (const part of content) {
        if (!part || typeof part !== "object") continue;
        const text = (part as Record<string, unknown>).text;
        if (typeof text === "string" && text.trim().length > 0) {
          return text;
        }
        const json = (part as Record<string, unknown>).json;
        if (json && typeof json === "object") {
          return JSON.stringify(json);
        }
      }
    }
    return null;
  };

  const judgeSchema = {
    type: "object",
    additionalProperties: false,
    required: [
      "warmth",
      "engagement",
      "grounded",
      "graceful_no_match",
      "taste",
      "notes",
    ],
    properties: {
      warmth: { type: "integer", minimum: 1, maximum: 5 },
      engagement: { type: "integer", minimum: 1, maximum: 5 },
      grounded: { type: "integer", minimum: 1, maximum: 5 },
      graceful_no_match: { type: "integer", minimum: 1, maximum: 5 },
      taste: { type: "integer", minimum: 1, maximum: 5 },
      notes: { type: "string", maxLength: 280 },
    },
  } as const;

  const requestPayload = {
    model: input.model,
    max_output_tokens: 220,
    input: [
      {
        role: "system",
        content: [
          {
            type: "input_text",
            text:
              "You are a strict evaluator for a retail rug concierge response. Score only what is provided. Do not be generous.",
          },
        ],
      },
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: JSON.stringify(
              {
                persona: {
                  name: input.persona.name,
                  profile: input.persona.profile,
                },
                conversation_history: input.history.slice(-8),
                user_message: input.userMessage,
                assistant_message: input.payload.response.assistant_message,
                response_mode: input.payload.fine_mode,
                recommendations: (input.payload.response.recommendations ?? []).map((rec) => ({
                  title: rec.title,
                  style: rec.style,
                  origin: rec.origin,
                  size_text: rec.size_text,
                  reasons: rec.match_reasons,
                })),
              },
              null,
              2
            ),
          },
        ],
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "quality_judge",
        strict: true,
        schema: judgeSchema,
      },
    },
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000);
  let response: Response;
  try {
    response = await fetch(OPENAI_RESPONSES_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${input.apiKey}`,
      },
      body: JSON.stringify(requestPayload),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }

  const payload = (await response.json()) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(`Judge API failed (${response.status})`);
  }

  const outputText = parseOutputText(payload);
  if (!outputText) {
    throw new Error("Judge response missing output_text");
  }

  const tryParse = (text: string): JudgeScore | null => {
    try {
      return JSON.parse(text) as JudgeScore;
    } catch {
      return null;
    }
  };

  let parsed = tryParse(outputText);
  if (!parsed) {
    const firstBrace = outputText.indexOf("{");
    const lastBrace = outputText.lastIndexOf("}");
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      parsed = tryParse(outputText.slice(firstBrace, lastBrace + 1));
    }
  }
  if (!parsed) {
    const pickScore = (label: string): number | null => {
      const match = new RegExp(`${label}[^0-9]{0,20}([1-5])`, "i").exec(outputText);
      if (!match) return null;
      const value = Number(match[1]);
      return Number.isFinite(value) ? value : null;
    };
    parsed = {
      warmth: pickScore("warmth") ?? 3,
      engagement: pickScore("engagement") ?? 3,
      grounded: pickScore("grounded") ?? 3,
      graceful_no_match: pickScore("graceful") ?? 3,
      taste: pickScore("taste") ?? 3,
      notes: "Judge returned non-JSON output; used fallback parse.",
    };
  }
  return parsed;
}

async function main(): Promise<void> {
  const localEnv = loadEnvFile(path.resolve(APP_DIR, ".env.local"));
  const apiKey = process.env.OPENAI_API_KEY ?? localEnv.OPENAI_API_KEY;
  const model =
    process.env.OPENAI_CHAT_MODEL ??
    localEnv.OPENAI_CHAT_MODEL ??
    localEnv.OPENAI_MODEL ??
    "gpt-4.1-mini";

  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is required for judge scoring.");
  }

  const server = await startServer();
  const failures: AssertionFailure[] = [];
  const judgeScores: JudgeScore[] = [];
  const turnScores: TurnScore[] = [];

  try {
    const totalTurns = PERSONAS.reduce((sum, persona) => sum + persona.turns.length, 0);
    let completedTurns = 0;
    for (const persona of PERSONAS) {
      const sessionId = randomUUID();
      let knownRoom: string | null = null;
      let hadRecommendations = false;
      const history: Array<{ role: "user" | "assistant"; text: string }> = [];

      for (let i = 0; i < persona.turns.length; i += 1) {
        const turn = persona.turns[i];
        const caseId = `${persona.id}-turn-${String(i + 1).padStart(2, "0")}`;
        const payload = await sendChatTurn({
          baseUrl: server.baseUrl,
          caseId,
          sessionId,
          message: turn.message,
        });

        failures.push(
          ...runDeterministicChecks({
            persona,
            turnIndex: i,
            turn,
            payload,
            knownRoom,
            hadPriorRecommendations: hadRecommendations,
          })
        );

        const score = await judgeTurnQuality({
          persona,
          history,
          userMessage: turn.message,
          payload,
          model,
          apiKey,
        });
        judgeScores.push(score);
        turnScores.push({
          persona: persona.name,
          turn: i + 1,
          message: turn.message,
          assistant: payload.response.assistant_message ?? "",
          mode: payload.fine_mode,
          score,
        });

        history.push({ role: "user", text: turn.message });
        history.push({ role: "assistant", text: payload.response.assistant_message ?? "" });

        const roomFromTurn = extractRoom(turn.message);
        if (roomFromTurn) knownRoom = roomFromTurn;
        hadRecommendations =
          payload.fine_mode === "recommendation" || payload.fine_mode === "disambiguation";
        completedTurns += 1;
        process.stdout.write(
          `\rPersona quality progress: ${completedTurns}/${totalTurns} turns`
        );
      }
    }
    process.stdout.write("\n");
  } finally {
    await server.stop();
  }

  const aggregate = judgeScores.reduce(
    (acc, score) => {
      acc.warmth += score.warmth;
      acc.engagement += score.engagement;
      acc.grounded += score.grounded;
      acc.graceful_no_match += score.graceful_no_match;
      acc.taste += score.taste;
      return acc;
    },
    { warmth: 0, engagement: 0, grounded: 0, graceful_no_match: 0, taste: 0 }
  );

  const count = Math.max(judgeScores.length, 1);
  const averages = {
    warmth: Number((aggregate.warmth / count).toFixed(2)),
    engagement: Number((aggregate.engagement / count).toFixed(2)),
    grounded: Number((aggregate.grounded / count).toFixed(2)),
    graceful_no_match: Number((aggregate.graceful_no_match / count).toFixed(2)),
    taste: Number((aggregate.taste / count).toFixed(2)),
  };

  console.log(`Persona turns evaluated: ${judgeScores.length}`);
  console.log(`Deterministic failures: ${failures.length}`);
  if (failures.length > 0) {
    for (const failure of failures.slice(0, 30)) {
      console.log(
        `[FAIL] ${failure.persona} turn ${failure.turn}: ${failure.reason} :: ${failure.message}`
      );
    }
  }
  console.log("AI judge averages:", averages);
  const lowestTurns = [...turnScores]
    .sort((a, b) => {
      const aMean =
        (a.score.warmth +
          a.score.engagement +
          a.score.grounded +
          a.score.graceful_no_match +
          a.score.taste) /
        5;
      const bMean =
        (b.score.warmth +
          b.score.engagement +
          b.score.grounded +
          b.score.graceful_no_match +
          b.score.taste) /
        5;
      return aMean - bMean;
    })
    .slice(0, 12);
  if (lowestTurns.length > 0) {
    console.log("Lowest-scored turns:");
    for (const item of lowestTurns) {
      const mean = (
        (item.score.warmth +
          item.score.engagement +
          item.score.grounded +
          item.score.graceful_no_match +
          item.score.taste) /
        5
      ).toFixed(2);
      console.log(
        `- ${item.persona} turn ${item.turn} [${item.mode}] mean=${mean} ` +
          `w=${item.score.warmth} e=${item.score.engagement} g=${item.score.grounded} ` +
          `n=${item.score.graceful_no_match} t=${item.score.taste} :: ${item.score.notes}`
      );
      console.log(`  user: ${item.message}`);
      console.log(`  assistant: ${item.assistant}`);
    }
  }

  const meetsThreshold =
    averages.warmth >= 4 &&
    averages.engagement >= 4 &&
    averages.grounded >= 4 &&
    averages.graceful_no_match >= 4 &&
    averages.taste >= 4;

  if (failures.length > 0 || !meetsThreshold) {
    process.exitCode = 1;
    return;
  }

  process.exitCode = 0;
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
