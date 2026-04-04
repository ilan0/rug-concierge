#!/usr/bin/env tsx

import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import http from "node:http";

type Role = "retail_customer";

type ChatApiPayload = {
  session_id: string;
  mode: "general_chat" | "recommendation";
  fine_mode: string;
  response: {
    assistant_message: string;
    recommendations?: Array<Record<string, unknown>>;
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
  overall: number;
  overall_reason: string;
  warmth: number;
  engagement: number;
  recommendation_fit: number;
  honest_disclosure: number;
  no_repeat: number;
  practical_signal: number | null;
  graceful_no_match: number | null;
  taste: number;
  contradiction_detected: boolean;
  contradiction_quote: string | null;
  notes: string;
};

type JudgeVisibleCard = {
  title: string;
  size_text: string;
  origin: string | null;
  style: string | null;
};

type JudgeHistoryTurn = {
  turn: number;
  user_message: string;
  assistant_message: string;
  cards: JudgeVisibleCard[];
};

type TurnScore = {
  persona: string;
  turn: number;
  message: string;
  assistant: string;
  mode: string;
  card_ids: string[];
  score: JudgeScore;
};

const DIAGNOSTIC_SCORE_DIMENSIONS = [
  "warmth",
  "engagement",
  "recommendation_fit",
  "honest_disclosure",
  "no_repeat",
  "taste",
] as const;

const CONDITIONAL_SCORE_DIMENSIONS = ["practical_signal", "graceful_no_match"] as const;

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const APP_DIR = path.resolve(REPO_ROOT, "apps", "web");
const PORT = 4114;
const RUN_ID = `concierge-quality-personas-${Date.now()}`;
const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
let SERVER_OUTPUT_TAIL = "";
let SERVER_EXITED = false;

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
    name: "Kitchen Shopper",
    profile: "Needs practical kitchen sizing and easy upkeep.",
    turns: [
      { message: "Need something practical for my kitchen.", expect: { mode: "recommendation" } },
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
  const chatModel = process.env.OPENAI_CHAT_MODEL ?? localEnv.OPENAI_CHAT_MODEL;
  const recommendationModel =
    process.env.OPENAI_RECOMMENDATION_MODEL ?? localEnv.OPENAI_RECOMMENDATION_MODEL;
  const visionModel =
    process.env.OPENAI_VISION_MODEL ?? localEnv.OPENAI_VISION_MODEL;
  const enableGeneralChatAi =
    process.env.ENABLE_GENERAL_CHAT_AI ?? localEnv.ENABLE_GENERAL_CHAT_AI;
  const upstashUrl =
    process.env.UPSTASH_REDIS_REST_URL ?? localEnv.UPSTASH_REDIS_REST_URL;
  const upstashToken =
    process.env.UPSTASH_REDIS_REST_TOKEN ?? localEnv.UPSTASH_REDIS_REST_TOKEN;
  if (!chatModel) {
    throw new Error(
      "OPENAI_CHAT_MODEL is required for concierge quality harness server env."
    );
  }
  if (!recommendationModel) {
    throw new Error(
      "OPENAI_RECOMMENDATION_MODEL is required for concierge quality harness server env."
    );
  }
  if (!visionModel) {
    throw new Error(
      "OPENAI_VISION_MODEL is required for concierge quality harness server env."
    );
  }
  if (!enableGeneralChatAi) {
    throw new Error(
      "ENABLE_GENERAL_CHAT_AI is required for concierge quality harness server env."
    );
  }
  if (!upstashUrl) {
    throw new Error(
      "UPSTASH_REDIS_REST_URL is required for concierge quality harness server env."
    );
  }
  if (!upstashToken) {
    throw new Error(
      "UPSTASH_REDIS_REST_TOKEN is required for concierge quality harness server env."
    );
  }

  return {
    ...process.env,
    ...localEnv,
    NODE_ENV: "production",
    E2E_TRACE_BYPASS_RATE_LIMIT: "1",
    OPENAI_CHAT_MODEL: chatModel,
    OPENAI_RECOMMENDATION_MODEL: recommendationModel,
    OPENAI_VISION_MODEL: visionModel,
    ENABLE_GENERAL_CHAT_AI: enableGeneralChatAi,
    UPSTASH_REDIS_REST_URL: upstashUrl,
    UPSTASH_REDIS_REST_TOKEN: upstashToken,
  };
}

function ensureBuiltApp(): void {
  const result = spawnSync(
    "npm",
    ["--workspace", "apps/web", "run", "build"],
    {
      cwd: REPO_ROOT,
      env: buildServerEnv(),
      stdio: "pipe",
      encoding: "utf8",
    }
  );
  if (result.status !== 0) {
    throw new Error(
      `Failed to build apps/web before persona harness.\n${result.stderr || result.stdout || ""}`
    );
  }
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
  SERVER_OUTPUT_TAIL = "";
  SERVER_EXITED = false;

  const child = spawn(
    "npm",
    ["--workspace", "apps/web", "run", "start", "--", "--port", String(PORT)],
    {
      cwd: REPO_ROOT,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    }
  );

  const appendTail = (chunk: unknown): void => {
    SERVER_OUTPUT_TAIL = `${SERVER_OUTPUT_TAIL}${String(chunk)}`.slice(-12000);
  };
  child.stdout?.on("data", appendTail);
  child.stderr?.on("data", appendTail);
  child.on("exit", () => {
    SERVER_EXITED = true;
  });

  await waitForServerReady(baseUrl).catch((error) => {
    child.kill("SIGTERM");
    throw new Error(`${String(error)}\nServer output tail:\n${SERVER_OUTPUT_TAIL}`);
  });

  try {
    await postLocalJson({
      baseUrl,
      path: "/api/chat",
      headers: {
        "x-e2e-trace-run": RUN_ID,
        "x-e2e-trace-case": "warmup",
        "x-forwarded-host": "jjrugs.rugdesk.app",
      },
      body: {
        session_id: randomUUID(),
        message: "hello",
        role: "retail_customer",
      },
      timeoutMs: 240000,
    }).catch(() => null);
  } catch {
    // Warmup is best-effort only.
  }

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
      SERVER_EXITED = true;
    },
  };
}

async function postLocalJson(input: {
  baseUrl: string;
  path: string;
  headers?: Record<string, string>;
  body: Record<string, unknown>;
  timeoutMs: number;
}): Promise<{ status: number; text: string }> {
  const target = new URL(input.path, input.baseUrl);
  const payload = JSON.stringify(input.body);

  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port,
        path: `${target.pathname}${target.search}`,
        method: "POST",
        headers: {
          "content-type": "application/json",
          "content-length": Buffer.byteLength(payload),
          ...(input.headers ?? {}),
        },
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk) => {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
        });
        response.on("end", () => {
          resolve({
            status: response.statusCode ?? 0,
            text: Buffer.concat(chunks).toString("utf8"),
          });
        });
      }
    );

    request.setTimeout(input.timeoutMs, () => {
      request.destroy(new Error(`HTTP timeout after ${input.timeoutMs}ms`));
    });
    request.on("error", reject);
    request.write(payload);
    request.end();
  });
}

async function sendChatTurn(input: {
  baseUrl: string;
  caseId: string;
  sessionId: string;
  message: string;
  role?: Role;
}): Promise<ChatApiPayload> {
  let lastError: unknown = null;
  const maxAttempts = 4;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await postLocalJson({
        baseUrl: input.baseUrl,
        path: "/api/chat",
        headers: {
          "x-e2e-trace-run": RUN_ID,
          "x-e2e-trace-case": input.caseId,
          "x-forwarded-host": "jjrugs.rugdesk.app",
        },
        body: {
          session_id: input.sessionId,
          message: input.message,
          role: input.role ?? "retail_customer",
        },
        timeoutMs: 45000,
      });
      if (response.status < 200 || response.status >= 300) {
        if ((response.status === 429 || response.status >= 500) && attempt < maxAttempts) {
          const delayMs =
            response.status === 429
              ? Math.min(45_000, 8_000 * attempt)
              : 2_000 * attempt;
          await new Promise((resolve) =>
            setTimeout(resolve, delayMs)
          );
          continue;
        }
        throw new Error(`Chat failed ${response.status} (${input.caseId}): ${response.text}`);
      }
      return JSON.parse(response.text) as ChatApiPayload;
    } catch (error) {
      lastError = error;
      const isRetryable =
        error instanceof Error &&
        /timeout|socket|fetch failed|econnreset|econnrefused|headers timeout|und_err/i.test(
          error.message.toLowerCase()
        );
      if (!isRetryable || attempt === maxAttempts) {
        if (SERVER_EXITED) {
          throw new Error(
            `${error instanceof Error ? error.message : String(error)}\nServer exited during run.\nServer output tail:\n${SERVER_OUTPUT_TAIL}`
          );
        }
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 1500 * attempt));
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Chat call failed after retries.");
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function recommendationId(rec: Record<string, unknown>, index: number): string {
  const candidates = [rec.id, rec.rug_id, rec.inventory_id, rec.slug];
  for (const value of candidates) {
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return `card-${index + 1}`;
}

function recommendationSizeText(rec: Record<string, unknown>): string {
  const sizeText = rec.size_text;
  if (typeof sizeText === "string" && sizeText.trim().length > 0) return sizeText;
  const width = typeof rec.width_in === "number" ? rec.width_in : null;
  const length = typeof rec.length_in === "number" ? rec.length_in : null;
  if (width && length) {
    const toFeet = (value: number): string => `${Math.round(value / 12)}'`;
    return `${toFeet(width)} x ${toFeet(length)}`;
  }
  return "";
}

function toNullableText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toJudgeVisibleCard(rec: Record<string, unknown>): JudgeVisibleCard {
  return {
    title: asString(rec.title) || "Untitled",
    size_text: recommendationSizeText(rec) || "-",
    origin: toNullableText(rec.origin),
    style: toNullableText(rec.style),
  };
}

function toJudgeVisibleCards(
  recs: Array<Record<string, unknown>> | undefined
): JudgeVisibleCard[] {
  return (recs ?? []).map((rec) => toJudgeVisibleCard(rec));
}

function sameCardIdSet(a: string[], b: string[]): boolean {
  if (a.length === 0 || b.length === 0 || a.length !== b.length) return false;
  const sa = [...a].sort();
  const sb = [...b].sort();
  return sa.every((value, index) => value === sb[index]);
}


async function judgeTurnQuality(input: {
  persona: Persona;
  history: JudgeHistoryTurn[];
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
      "overall",
      "overall_reason",
      "warmth",
      "engagement",
      "recommendation_fit",
      "honest_disclosure",
      "no_repeat",
      "practical_signal",
      "graceful_no_match",
      "taste",
      "contradiction_detected",
      "contradiction_quote",
      "notes",
    ],
    properties: {
      overall: { type: "integer", minimum: 1, maximum: 5 },
      overall_reason: { type: "string", maxLength: 220 },
      warmth: { type: "integer", minimum: 1, maximum: 5 },
      engagement: { type: "integer", minimum: 1, maximum: 5 },
      recommendation_fit: { type: "integer", minimum: 1, maximum: 5 },
      honest_disclosure: { type: "integer", minimum: 1, maximum: 5 },
      no_repeat: { type: "integer", minimum: 1, maximum: 5 },
      practical_signal: {
        anyOf: [{ type: "integer", minimum: 1, maximum: 5 }, { type: "null" }],
      },
      graceful_no_match: {
        anyOf: [{ type: "integer", minimum: 1, maximum: 5 }, { type: "null" }],
      },
      taste: { type: "integer", minimum: 1, maximum: 5 },
      contradiction_detected: { type: "boolean" },
      contradiction_quote: { anyOf: [{ type: "string", maxLength: 260 }, { type: "null" }] },
      notes: { type: "string", maxLength: 500 },
    },
  } as const;

  const requestPayload = {
    model: input.model,
    max_output_tokens: 1200,
    temperature: 0,
    input: [
      {
        role: "system",
        content: [
          {
            type: "input_text",
            text:
              [
                "You are a real customer who has just walked into a rug gallery.",
                "A staff member handed you an iPad and said this AI will help you find rugs currently in the store.",
                "You have never used this tool before.",
                "You do not know how it works internally.",
                "You do not know what 'discovery mode' is or what the backend is doing.",
                "You just see a message and some rug cards on screen and you either feel helped or you don't.",
                "Evaluate each concierge response exactly as that customer would experience it.",
                "Read the assistant message and the rug cards together as one complete response — the same way they appear on screen.",
                "Do not decompose them.",
                "Do not evaluate the text separately from the cards.",
                "Do not apply technical criteria.",
                "Ask: did this response help me find a rug I might actually want? Does this concierge feel like someone worth talking to?",
                "Watch closely for contradictions between what the concierge says and what the cards actually show.",
                "Example contradiction types: calling options modern when shown cards are traditional Persian, or saying options are larger when shown cards are smaller.",
                "Confident and wrong is worse than uncertain and honest.",
                "If the assistant explicitly discloses that exact color balance cannot be verified from card summaries, do not treat missing visible color proof as a contradiction by itself.",
                "Educational answers without cards can still score high when they are clear, useful, and naturally bridge to showing examples next.",
                "A single-card recommendation can still score high if the assistant is transparent about limited inventory and gives a concrete next step.",
                "When inventory is clearly limited and the assistant is honest about limits while offering closest viable options, overall can still be 4-5 unless the response is misleading.",
                "Scoring instructions:",
                "1) Overall (primary gate): as this customer, did this help? score 1-5. 1 means I'd put the tablet down. 5 means I feel genuinely helped and want to continue.",
                "2) Diagnostic subscores (1-5): warmth, engagement, recommendation_fit, honest_disclosure, no_repeat, taste.",
                "Set practical_signal to 1-5 only if the customer asked for practical needs (kids, pets, durable, easy clean, soft underfoot); otherwise null.",
                "Set graceful_no_match to 1-5 only if no good match existed and the assistant had to handle mismatch/no-match; otherwise null.",
                "For recommendation_fit, compare the request directly against visible card fields, not assistant claims.",
                "If the assistant text contradicts visible cards, set contradiction_detected=true, include a direct contradiction_quote, and score overall/recommendation_fit harshly.",
                "Output strict JSON only.",
              ].join(" "),
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
                conversation_history_full_session: input.history,
                user_message: input.userMessage,
                assistant_message: input.payload.response.assistant_message,
                visible_cards: toJudgeVisibleCards(input.payload.response.recommendations),
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

  let payload: Record<string, unknown> | null = null;
  let lastError: unknown = null;
  const maxAttempts = 8;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25000);
    try {
      const response = await fetch(OPENAI_RESPONSES_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${input.apiKey}`,
        },
        body: JSON.stringify(requestPayload),
        signal: controller.signal,
      });
      const parsedPayload = (await response.json()) as Record<string, unknown>;
      const status = Number(response.status);

      if (response.ok) {
        payload = parsedPayload;
        break;
      }

      const retryableStatus = status === 429 || status >= 500;
      if (retryableStatus && attempt < maxAttempts - 1) {
        process.stderr.write(
          `[judge-retry] status=${status} attempt=${attempt + 1}/${maxAttempts}\n`
        );
        const jitterMs = Math.floor(Math.random() * 500);
        const backoffMs = Math.min(60000, 3000 * Math.pow(2, attempt)) + jitterMs;
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
        continue;
      }

      throw new Error(`Judge API failed (${status})`);
    } catch (error) {
      lastError = error;
      const retryableError =
        error instanceof Error &&
        (error.name === "AbortError" ||
          /aborted|timeout|network|429|rate/i.test(error.message));
      if (!retryableError || attempt >= maxAttempts - 1) {
        throw error;
      }
      const jitterMs = Math.floor(Math.random() * 500);
      const backoffMs = Math.min(60000, 3000 * Math.pow(2, attempt)) + jitterMs;
      await new Promise((resolve) => setTimeout(resolve, backoffMs));
    } finally {
      clearTimeout(timeout);
    }
  }

  if (!payload) {
    throw lastError instanceof Error
      ? lastError
      : new Error("Judge API request failed before receiving a usable response.");
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
      overall: pickScore("overall") ?? 3,
      overall_reason: "Judge returned non-JSON output; fallback parser used.",
      warmth: pickScore("warmth") ?? 3,
      engagement: pickScore("engagement") ?? 3,
      recommendation_fit: pickScore("recommendation[_ ]?fit") ?? 3,
      honest_disclosure: pickScore("honest[_ ]?disclosure") ?? 3,
      no_repeat: pickScore("no[_ ]?repeat") ?? 3,
      practical_signal: pickScore("practical[_ ]?signal"),
      graceful_no_match: pickScore("graceful[_ ]?no[_ ]?match"),
      taste: pickScore("taste") ?? 3,
      contradiction_detected:
        /contradiction[_ ]?detected[^a-z0-9]{0,8}(true|1)/i.test(outputText) ||
        /"contradiction[_ ]?detected"\s*:\s*true/i.test(outputText),
      contradiction_quote: null,
      notes: "Judge returned non-JSON output; used fallback parse.",
    };
  }
  return parsed;
}

async function main(): Promise<void> {
  const localEnv = loadEnvFile(path.resolve(APP_DIR, ".env.local"));
  const apiKey = process.env.OPENAI_API_KEY ?? localEnv.OPENAI_API_KEY;
  const model = "gpt-4.1";

  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is required for judge scoring.");
  }

  ensureBuiltApp();
  const server = await startServer();
  const judgeScores: JudgeScore[] = [];
  const turnScores: TurnScore[] = [];
  const personaBuckets = new Map<string, TurnScore[]>();

  try {
    const totalTurns = PERSONAS.reduce((sum, persona) => sum + persona.turns.length, 0);
    let completedTurns = 0;
    for (const persona of PERSONAS) {
      const sessionId = randomUUID();
      const history: JudgeHistoryTurn[] = [];

      for (let i = 0; i < persona.turns.length; i += 1) {
        const turn = persona.turns[i];
        const caseId = `${persona.id}-turn-${String(i + 1).padStart(2, "0")}`;
        process.stdout.write(`\n[run] ${caseId} :: sending turn\n`);
        const payload = await sendChatTurn({
          baseUrl: server.baseUrl,
          caseId,
          sessionId,
          message: turn.message,
        });

        process.stdout.write(`[run] ${caseId} :: judging turn\n`);
        const score = await judgeTurnQuality({
          persona,
          history,
          userMessage: turn.message,
          payload,
          model,
          apiKey,
        });
        judgeScores.push(score);
        const cardIds = (payload.response.recommendations ?? []).map((rec, index) =>
          recommendationId(rec, index)
        );
        turnScores.push({
          persona: persona.name,
          turn: i + 1,
          message: turn.message,
          assistant: payload.response.assistant_message ?? "",
          mode: payload.fine_mode,
          card_ids: cardIds,
          score,
        });
        const existing = personaBuckets.get(persona.name) ?? [];
        existing.push(turnScores[turnScores.length - 1]);
        personaBuckets.set(persona.name, existing);

        history.push({
          turn: i + 1,
          user_message: turn.message,
          assistant_message: payload.response.assistant_message ?? "",
          cards: toJudgeVisibleCards(payload.response.recommendations),
        });
        completedTurns += 1;
        process.stdout.write(
          `\rPersona quality progress: ${completedTurns}/${totalTurns} turns`
        );
        await new Promise((resolve) => setTimeout(resolve, 15000));
      }
    }
    process.stdout.write("\n");
  } finally {
    await server.stop();
  }

  const average = (values: number[]): number =>
    values.length === 0
      ? 0
      : Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2));

  const globalAverages: Record<string, number> = {};
  globalAverages.overall = average(judgeScores.map((score) => score.overall));
  for (const dim of DIAGNOSTIC_SCORE_DIMENSIONS) {
    globalAverages[dim] = average(judgeScores.map((score) => score[dim]));
  }
  for (const dim of CONDITIONAL_SCORE_DIMENSIONS) {
    const values = judgeScores
      .map((score) => score[dim])
      .filter((value): value is number => value !== null);
    globalAverages[dim] = average(values);
  }

  const personaAverages = [...personaBuckets.entries()].map(([personaName, scores]) => {
    const values = scores.map((item) => item.score.overall);
    const worstTurn = scores.reduce((worst, candidate) =>
      candidate.score.overall < worst.score.overall ? candidate : worst
    );
    return {
      persona: personaName,
      turns: scores.length,
      average: average(values),
      worstTurn,
    };
  });

  const hardFailures: Array<{
    persona: string;
    turn: number;
    message: string;
    reason: string;
    cardIds?: string[];
  }> = [];
  for (const item of turnScores) {
    if (item.score.overall < 4) {
      hardFailures.push({
        persona: item.persona,
        turn: item.turn,
        message: item.message,
        reason: `Per-turn overall floor violated: overall=${item.score.overall} (<4.0)`,
        cardIds: item.card_ids,
      });
    }
    if (item.score.contradiction_detected) {
      hardFailures.push({
        persona: item.persona,
        turn: item.turn,
        message: item.message,
        reason: `Contradicting claim detected: ${item.score.contradiction_quote ?? "quote not provided"}`,
        cardIds: item.card_ids,
      });
    }
  }

  console.log("\nPer-turn Scores");
  console.log(
    "| Persona | Turn | Overall | Why | Warmth | Engagement | Fit | Disclosure | No Repeat | Practical | No-Match | Taste | Contradiction | Mode | Card IDs | Message | Notes |"
  );
  console.log(
    "|---|---:|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---|---|---|---|---|"
  );
  for (const item of turnScores) {
    const message = item.message.replace(/\|/g, "\\|");
    const notes = item.score.notes.replace(/\|/g, "\\|");
    const reason = item.score.overall_reason.replace(/\|/g, "\\|");
    const ids = item.card_ids.join(", ");
    const contradiction = item.score.contradiction_detected
      ? `YES: ${(item.score.contradiction_quote ?? "quote missing").replace(/\|/g, "\\|")}`
      : "no";
    console.log(
      `| ${item.persona} | ${item.turn} | ${item.score.overall} | ${reason} | ${item.score.warmth} | ${item.score.engagement} | ${item.score.recommendation_fit} | ${item.score.honest_disclosure} | ${item.score.no_repeat} | ${item.score.practical_signal ?? "N/A"} | ${item.score.graceful_no_match ?? "N/A"} | ${item.score.taste} | ${contradiction} | ${item.mode} | ${ids || "-"} | ${message} | ${notes || "-"} |`
    );
  }

  console.log("\nPer-persona Averages");
  console.log("| Persona | Turns | Average Overall | Worst Turn | Worst-Turn Why |");
  console.log("|---|---:|---:|---:|---|");
  for (const row of personaAverages) {
    const why = row.worstTurn.score.overall_reason.replace(/\|/g, "\\|");
    console.log(
      `| ${row.persona} | ${row.turns} | ${row.average.toFixed(2)} | ${row.worstTurn.turn} | ${why} |`
    );
  }

  console.log("\nGlobal Averages");
  console.log("| Dimension | Average |");
  console.log("|---|---:|");
  for (const dim of ["overall", ...DIAGNOSTIC_SCORE_DIMENSIONS, ...CONDITIONAL_SCORE_DIMENSIONS]) {
    const label = String(dim);
    const value = globalAverages[label];
    console.log(`| ${label} | ${Number.isFinite(value) ? value.toFixed(2) : "N/A"} |`);
  }

  if (hardFailures.length > 0) {
    console.log("\nHard Failure Details");
    for (const failure of hardFailures) {
      const ids = failure.cardIds?.length ? ` cards=[${failure.cardIds.join(", ")}]` : "";
      console.log(
        `[FAIL] ${failure.persona} turn ${failure.turn}: ${failure.reason}${ids}\n  user: ${failure.message}`
      );
    }
  }

  const globalOverallPass = globalAverages.overall >= 4.0;
  const perPersonaPass = personaAverages.every((row) => row.average >= 3.8);

  console.log("\nPass Gate Check");
  console.log(
    `- Global average overall >= 4.0: ${globalOverallPass ? "PASS" : `FAIL (${globalAverages.overall.toFixed(2)})`}`
  );
  console.log(
    `- Per-persona average overall >= 3.8: ${perPersonaPass ? "PASS" : "FAIL"}`
  );
  const belowFloorCount = turnScores.filter((item) => item.score.overall < 4).length;
  console.log(
    `- Zero turns with overall < 4.0: ${belowFloorCount === 0 ? "PASS" : `FAIL (${belowFloorCount})`}`
  );
  const contradictionCount = turnScores.filter(
    (item) => item.score.contradiction_detected
  ).length;
  console.log(
    `- Zero contradiction turns: ${contradictionCount === 0 ? "PASS" : `FAIL (${contradictionCount})`}`
  );

  if (!globalOverallPass || !perPersonaPass || hardFailures.length > 0) {
    process.exitCode = 1;
    return;
  }

  process.exitCode = 0;
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
