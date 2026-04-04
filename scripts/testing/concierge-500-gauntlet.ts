#!/usr/bin/env tsx

import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

type ServerHandle = {
  baseUrl: string;
  stop: () => Promise<void>;
};

type DebugTracePayload = {
  run_id: string;
  case_id: string;
  traces: Array<{
    file: string;
    trace_id: string | null;
    channel: string | null;
    payload: Record<string, unknown> | null;
  }>;
};

type ChatApiPayload = {
  session_id: string;
  role: string;
  mode: "general_chat" | "recommendation";
  fine_mode: string;
  recommendation_state: Record<string, unknown>;
  response: Record<string, unknown>;
};

type SessionRuntime = {
  hadRecommendation: boolean;
};

const RUN_ID = `concierge-gauntlet-500-${Date.now()}`;
const PORT = 4112;
const REQUEST_TIMEOUT_MS = 240000;
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const APP_DIR = path.resolve(REPO_ROOT, "apps", "web");

const DISCOVERY_PROMPTS = [
  "Show me what you have",
  "Show me a range to react to",
  "Surprise me with options",
  "Just browsing for now",
  "Show me a broad spread",
  "I want to explore what's in stock",
];

const DIRECT_PROMPTS = [
  "I need a modern 8x10 rug",
  "Show me traditional Persian options",
  "Need a runner around 3x12",
  "Looking for blue and ivory rugs",
  "Find me a geometric rug around 6x9",
  "Show me warm-toned living room rugs",
  "I want something around 9x12",
  "Need a dining room rug around 8x10",
  "Show me kilims in medium sizes",
  "I want a bold statement rug",
  "Need something calm and neutral",
  "Show me Oushak styles",
  "I want transitional options",
  "Find red rugs for an anchor setup",
  "Need a round rug around 6 feet",
  "Show me green rugs",
  "I need a hallway runner",
  "Find me something around 5x8",
  "Show me Afghan rugs",
  "I want a modern living room anchor rug",
];

const FOLLOWUP_PROMPTS = [
  "Show me more",
  "Give me more like this",
  "Any closer matches?",
  "Show me something smaller",
  "Show me something larger",
  "Can you tighten this to blue?",
  "Make it more traditional",
  "Do you have anything similar?",
  "Keep going",
  "More options please",
];

const REACTION_PROMPTS = [
  "I like the first one",
  "I love the second one",
  "Not this one, too busy",
  "I like the pattern but not the color",
  "This feels too formal",
  "I like this direction",
  "Not my style",
  "I like the colors, show similar",
  "Too traditional for me",
  "I prefer something cleaner",
];

const DISAMBIGUATION_PROMPTS = [
  "I love the rust one",
  "Tell me more about that one",
  "I like the first one, show more like that",
  "What about the blue one?",
  "Can we go with the second one?",
];

const EDUCATIONAL_PROMPTS = [
  "What is a kilim?",
  "What's the difference between a Heriz and a Serapi?",
  "How do I care for a wool rug?",
  "What makes Oushaks different?",
  "How can I tell if a rug is hand-knotted?",
  "What does low pile mean?",
  "How often should I rotate a rug?",
  "What is the difference between tribal and geometric?",
  "Tell me about Persian rug styles",
  "How should I place a rug under a dining table?",
];

const MIXED_PROMPTS = [
  "I'm decorating a living room with a gray sectional and want warm contrast",
  "We have kids and a dog, what would work best?",
  "I want something bold but not chaotic",
  "I like classic looks but with a cleaner feel",
  "I want cozy but still refined",
  "Help me choose between traditional and modern",
  "Need something for a narrow hallway with dark floors",
  "I want a calm bedroom setup",
  "I'm open on style, but not too busy",
  "Need a statement piece for a larger room",
];

const IMPOSSIBLE_PROMPTS = [
  "I need exactly a 50x50 rug",
  "Find me a 100 by 100 foot rug",
  "Need a 30 by 40 runner",
  "I need a circular 20-foot rug",
  "Show me a tiny 1x1 dining rug",
];

const MULTI_LANG_PROMPTS = [
  "¿Tienen alfombras azules de 8x10 para sala?",
  "Necesito una alfombra moderna para sala",
  "Muéstrame más como esta",
  "Quiero algo tradicional pero menos cargado",
  "¿Qué es un kilim?",
];

const NOISY_PROMPTS = [
  "need modrn 8 x10 not too bzzy",
  "show me smller one plz",
  "i lik the frst one",
  "whts diff btwn heriz + serapi",
  "need warm not red maybe rust-ish",
  "show me more lk this",
  "i want livng room anchor rug",
  "blue-ish maybe teal maybe navy",
  "runner for hall way around 3by12",
  "not too trad but not super modern",
];

function fail(message: string): never {
  throw new Error(message);
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) fail(message);
}

function asObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function asArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) {
    fail(`${label} must be an array.`);
  }
  return value;
}

function asString(value: unknown, label: string): string {
  if (typeof value !== "string") {
    fail(`${label} must be a string.`);
  }
  return value;
}

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
    throw new Error("OPENAI_CHAT_MODEL is required for concierge 500 gauntlet.");
  }
  if (!recommendationModel) {
    throw new Error(
      "OPENAI_RECOMMENDATION_MODEL is required for concierge 500 gauntlet."
    );
  }
  if (!visionModel) {
    throw new Error("OPENAI_VISION_MODEL is required for concierge 500 gauntlet.");
  }
  if (!enableGeneralChatAi) {
    throw new Error("ENABLE_GENERAL_CHAT_AI is required for concierge 500 gauntlet.");
  }
  if (!upstashUrl) {
    throw new Error("UPSTASH_REDIS_REST_URL is required for concierge 500 gauntlet.");
  }
  if (!upstashToken) {
    throw new Error("UPSTASH_REDIS_REST_TOKEN is required for concierge 500 gauntlet.");
  }

  return {
    ...process.env,
    ...localEnv,
    NODE_ENV: "development",
    OPENAI_CHAT_MODEL: chatModel,
    OPENAI_RECOMMENDATION_MODEL: recommendationModel,
    OPENAI_VISION_MODEL: visionModel,
    ENABLE_GENERAL_CHAT_AI: enableGeneralChatAi,
    UPSTASH_REDIS_REST_URL: upstashUrl,
    UPSTASH_REDIS_REST_TOKEN: upstashToken,
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
  fail(`Server did not become ready at ${baseUrl}.`);
}

async function startServer(port: number): Promise<ServerHandle> {
  const baseUrl = `http://127.0.0.1:${port}`;
  const env = buildServerEnv();

  const child = spawn(
    "npm",
    ["--workspace", "apps/web", "run", "dev", "--", "--port", String(port)],
    {
      cwd: REPO_ROOT,
      env,
      stdio: ["ignore", "ignore", "pipe"],
    }
  );

  let stderrTail = "";
  child.stderr?.on("data", (chunk) => {
    const text = chunk.toString();
    stderrTail = `${stderrTail}${text}`.slice(-4000);
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

async function requestJson(input: {
  baseUrl: string;
  path: string;
  method?: "GET" | "POST";
  body?: unknown;
  headers?: Record<string, string>;
}): Promise<{ status: number; json: unknown; text: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(`${input.baseUrl}${input.path}`, {
      method: input.method ?? "GET",
      headers: {
        "content-type": "application/json",
        ...(input.headers ?? {}),
      },
      body: input.body === undefined ? undefined : JSON.stringify(input.body),
      signal: controller.signal,
    });
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : String(error);
    fail(
      `Request failed for ${input.path}: ${errorMessage} (timeout ${REQUEST_TIMEOUT_MS}ms)`
    );
  } finally {
    clearTimeout(timeout);
  }

  const text = await response.text();
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { status: response.status, json, text };
}

async function sendChatTurn(input: {
  baseUrl: string;
  caseId: string;
  sessionId: string;
  message: string;
}): Promise<ChatApiPayload> {
  const response = await requestJson({
    baseUrl: input.baseUrl,
    path: "/api/chat",
    method: "POST",
    headers: {
      "x-e2e-trace-run": RUN_ID,
      "x-e2e-trace-case": input.caseId,
      "x-forwarded-for": `198.51.100.${Math.floor(Math.random() * 200) + 1}`,
    },
    body: {
      session_id: input.sessionId,
      message: input.message,
      role: "retail_customer",
    },
  });

  if (response.status >= 400) {
    fail(`Chat API failed (${response.status}) ${input.caseId}: ${response.text}`);
  }

  const payload = asObject(response.json, `${input.caseId}.payload`);
  asString(payload.session_id, `${input.caseId}.session_id`);
  asString(payload.mode, `${input.caseId}.mode`);
  asString(payload.fine_mode, `${input.caseId}.fine_mode`);
  asObject(payload.response, `${input.caseId}.response`);
  asObject(payload.recommendation_state, `${input.caseId}.recommendation_state`);
  return payload as unknown as ChatApiPayload;
}

async function fetchCaseTraces(baseUrl: string, caseId: string): Promise<DebugTracePayload> {
  const response = await requestJson({
    baseUrl,
    path: `/api/debug/trace?run=${encodeURIComponent(RUN_ID)}&case=${encodeURIComponent(caseId)}`,
  });
  if (response.status >= 400) {
    fail(`Debug trace API failed (${response.status}) ${caseId}: ${response.text}`);
  }
  return asObject(response.json, `${caseId}.trace`) as DebugTracePayload;
}

function getLatestChannelTrace(payload: DebugTracePayload, channel: string): Record<string, unknown> | null {
  const found = payload.traces
    .filter((trace) => trace.channel === channel && trace.payload)
    .map((trace) => trace.payload as Record<string, unknown>);
  return found.length > 0 ? found[found.length - 1] : null;
}

function isEducationalPrompt(message: string): boolean {
  return /\b(what is|what's|difference between|tell me about|how do i|how to|care|clean)\b/i.test(message);
}

function isDiscoveryPrompt(message: string): boolean {
  return /\b(show me what you have|range to react|surprise me|just browsing|broad spread|explore)\b/i.test(message);
}

function isFollowupPrompt(message: string): boolean {
  return /\b(show me more|more like this|closest|smaller|larger|keep going|similar|tighten)\b/i.test(message);
}

function isImpossibleSizePrompt(message: string): boolean {
  return /\b(50x50|100 by 100|100x100|30 by 40|20-foot)\b/i.test(message);
}

function isSpanishPrompt(message: string): boolean {
  return /[¿¡]|\b(alfombra|alfombras|sala|quiero|mu[eé]strame|qu[eé])\b/i.test(message);
}

function extractRecommendations(payload: ChatApiPayload, caseId: string): Array<Record<string, unknown>> {
  const response = asObject(payload.response, `${caseId}.response`);
  const recs = Array.isArray(response.recommendations) ? response.recommendations : [];
  return recs.map((item, idx) => asObject(item, `${caseId}.recommendations[${idx}]`));
}

function validateResponseShape(payload: ChatApiPayload, caseId: string): void {
  const response = asObject(payload.response, `${caseId}.response`);
  const fineMode = asString(payload.fine_mode, `${caseId}.fine_mode`);
  const assistant = asString(response.assistant_message, `${caseId}.assistant_message`);
  assert(assistant.trim().length > 0, `${caseId}: assistant_message must be non-empty.`);
  assert(assistant.length <= 420, `${caseId}: assistant_message too long.`);

  if (fineMode === "recommendation" || fineMode === "disambiguation") {
    const recs = extractRecommendations(payload, caseId);
    assert(recs.length > 0, `${caseId}: recommendation/disambiguation needs cards.`);
    const seen = new Set<string>();
    for (const rec of recs) {
      const rugId = asString(rec.rug_id, `${caseId}.rug_id`);
      const title = asString(rec.title, `${caseId}.title`);
      assert(title.trim().length > 0, `${caseId}: recommendation title is empty.`);
      assert(!seen.has(rugId), `${caseId}: duplicate recommendation rug_id ${rugId}.`);
      seen.add(rugId);
    }
  }

  if (fineMode === "general_chat") {
    const recs = Array.isArray(response.recommendations) ? response.recommendations : [];
    assert(recs.length === 0, `${caseId}: general_chat should not include recommendation cards.`);
  }

  assert(
    !/^(based on what you're looking for|here are some options|here are a few rugs|you asked for specific guidance)/i.test(
      assistant.trim()
    ),
    `${caseId}: generic robotic opener detected.`
  );
}

function validateBehaviorForPrompt(input: {
  payload: ChatApiPayload;
  message: string;
  caseId: string;
  prior: SessionRuntime;
  traces: DebugTracePayload;
}): SessionRuntime {
  const { payload, message, caseId, prior, traces } = input;
  const response = asObject(payload.response, `${caseId}.response`);
  const assistant = asString(response.assistant_message, `${caseId}.assistant_message`).toLowerCase();
  const fineMode = asString(payload.fine_mode, `${caseId}.fine_mode`);

  const chatTrace = getLatestChannelTrace(traces, "chat-route");
  assert(chatTrace, `${caseId}: missing chat-route trace.`);
  const routing = asObject(asObject(chatTrace, `${caseId}.chatTrace`).routing, `${caseId}.routing`);
  const parser = asObject(routing.parser, `${caseId}.parser`);
  asString(parser.model, `${caseId}.parser.model`);
  asString(parser.parse_status, `${caseId}.parser.parse_status`);
  const normalizedPayload = asObject(parser.normalized_payload, `${caseId}.parser.normalized_payload`);
  const intent = asString(normalizedPayload.intent, `${caseId}.intent`);

  if (isEducationalPrompt(message)) {
    assert(
      fineMode === "general_chat",
      `${caseId}: educational prompt should be general_chat, got ${fineMode}.`
    );
    assert(
      assistant.includes("show") && (assistant.includes("collection") || assistant.includes("examples")),
      `${caseId}: educational response missing natural inventory bridge.`
    );
    assert(
      intent === "educate" || intent === "general",
      `${caseId}: educational prompt parsed as wrong intent ${intent}.`
    );
  }

  if (isDiscoveryPrompt(message)) {
    assert(
      fineMode === "recommendation" || fineMode === "disambiguation",
      `${caseId}: discovery prompt should return recommendations.`
    );
    assert(assistant.includes("?"), `${caseId}: discovery response missing narrowing question.`);
  }

  if (isFollowupPrompt(message) && prior.hadRecommendation) {
    assert(
      fineMode === "recommendation" || fineMode === "disambiguation",
      `${caseId}: followup after recommendations must stay in recommendation flow.`
    );
    assert(
      intent === "followup" || intent === "reaction" || intent === "recommend",
      `${caseId}: followup prompt parsed as unexpected intent ${intent}.`
    );
  }

  if (isImpossibleSizePrompt(message) && (fineMode === "recommendation" || fineMode === "disambiguation")) {
    assert(
      assistant.includes("don't have") ||
        assistant.includes("do not have") ||
        assistant.includes("largest") ||
        assistant.includes("closest"),
      `${caseId}: impossible size prompt missing honest mismatch disclosure.`
    );
  }

  if (isSpanishPrompt(message)) {
    const hasSpanishSignal = /\b(puedo|mostrar|colecci[oó]n|opciones|si|quieres|alfombra|estilo)\b/i.test(
      assistant
    );
    assert(hasSpanishSignal, `${caseId}: Spanish prompt did not return Spanish-like response.`);
  }

  const pipelineTrace = getLatestChannelTrace(traces, "recommendation-pipeline");
  if (pipelineTrace) {
    const promptContext = asObject((pipelineTrace.prompt_context ?? {}) as unknown, `${caseId}.pipeline.prompt_context`);
    const mismatch = promptContext.constraint_mismatch;
    if (mismatch && typeof mismatch === "object") {
      const mismatchObj = mismatch as Record<string, unknown>;
      if (mismatchObj.expanded_from_zero_match === true) {
        assert(
          assistant.includes("don't have") ||
            assistant.includes("do not have") ||
            assistant.includes("exact") ||
            assistant.includes("closest"),
          `${caseId}: expanded mismatch missing explicit disclosure in assistant message.`
        );
      }
    }
  }

  const hadRecommendation = fineMode === "recommendation" || fineMode === "disambiguation";
  return { hadRecommendation };
}

function pick<T>(items: T[], index: number): T {
  return items[index % items.length];
}

function longSessionMessage(sessionIndex: number, turnIndex: number): string {
  const i = sessionIndex * 20 + turnIndex;
  const template = [
    pick(DISCOVERY_PROMPTS, i),
    pick(DIRECT_PROMPTS, i + 3),
    pick(FOLLOWUP_PROMPTS, i + 1),
    pick(REACTION_PROMPTS, i + 2),
    pick(FOLLOWUP_PROMPTS, i + 4),
    pick(MIXED_PROMPTS, i + 5),
    pick(EDUCATIONAL_PROMPTS, i + 6),
    pick(DIRECT_PROMPTS, i + 7),
    pick(DISAMBIGUATION_PROMPTS, i + 8),
    pick(FOLLOWUP_PROMPTS, i + 9),
    pick(IMPOSSIBLE_PROMPTS, i + 10),
    pick(FOLLOWUP_PROMPTS, i + 11),
    pick(MULTI_LANG_PROMPTS, i + 12),
    pick(DISCOVERY_PROMPTS, i + 13),
    pick(REACTION_PROMPTS, i + 14),
    pick(NOISY_PROMPTS, i + 15),
    pick(FOLLOWUP_PROMPTS, i + 16),
    pick(EDUCATIONAL_PROMPTS, i + 17),
    pick(MIXED_PROMPTS, i + 18),
    pick(DIRECT_PROMPTS, i + 19),
  ];
  return template[turnIndex];
}

function mediumSessionMessage(sessionIndex: number, turnIndex: number): string {
  const i = sessionIndex * 5 + turnIndex;
  const template = [
    pick(DIRECT_PROMPTS, i),
    pick(FOLLOWUP_PROMPTS, i + 1),
    pick(REACTION_PROMPTS, i + 2),
    pick(EDUCATIONAL_PROMPTS, i + 3),
    pick(DIRECT_PROMPTS, i + 4),
  ];
  return template[turnIndex];
}

function singleProbeMessage(index: number): string {
  const pools = [
    DIRECT_PROMPTS,
    DISCOVERY_PROMPTS,
    EDUCATIONAL_PROMPTS,
    MIXED_PROMPTS,
    IMPOSSIBLE_PROMPTS,
    MULTI_LANG_PROMPTS,
    NOISY_PROMPTS,
  ];
  const pool = pools[index % pools.length];
  return pick(pool, index * 3 + 1);
}

async function runGauntlet(baseUrl: string): Promise<void> {
  let total = 0;

  // 200 turns: 10 sessions x 20 turns
  for (let s = 0; s < 10; s += 1) {
    const sessionId = randomUUID();
    let runtime: SessionRuntime = { hadRecommendation: false };
    for (let t = 0; t < 20; t += 1) {
      total += 1;
      const message = longSessionMessage(s, t);
      const caseId = `g-long-${String(s + 1).padStart(2, "0")}-turn-${String(t + 1).padStart(2, "0")}`;
      const payload = await sendChatTurn({ baseUrl, caseId, sessionId, message });
      const traces = await fetchCaseTraces(baseUrl, caseId);
      validateResponseShape(payload, caseId);
      runtime = validateBehaviorForPrompt({
        payload,
        message,
        caseId,
        prior: runtime,
        traces,
      });
      process.stdout.write(`\rGauntlet progress: ${total}/500`);
    }
  }

  // 200 turns: 40 sessions x 5 turns
  for (let s = 0; s < 40; s += 1) {
    const sessionId = randomUUID();
    let runtime: SessionRuntime = { hadRecommendation: false };
    for (let t = 0; t < 5; t += 1) {
      total += 1;
      const message = mediumSessionMessage(s, t);
      const caseId = `g-medium-${String(s + 1).padStart(2, "0")}-turn-${String(t + 1).padStart(2, "0")}`;
      const payload = await sendChatTurn({ baseUrl, caseId, sessionId, message });
      const traces = await fetchCaseTraces(baseUrl, caseId);
      validateResponseShape(payload, caseId);
      runtime = validateBehaviorForPrompt({
        payload,
        message,
        caseId,
        prior: runtime,
        traces,
      });
      process.stdout.write(`\rGauntlet progress: ${total}/500`);
    }
  }

  // 100 turns: 100 sessions x 1 turn
  for (let i = 0; i < 100; i += 1) {
    total += 1;
    const sessionId = randomUUID();
    const message = singleProbeMessage(i);
    const caseId = `g-single-${String(i + 1).padStart(3, "0")}`;
    const payload = await sendChatTurn({ baseUrl, caseId, sessionId, message });
    const traces = await fetchCaseTraces(baseUrl, caseId);
    validateResponseShape(payload, caseId);
    validateBehaviorForPrompt({
      payload,
      message,
      caseId,
      prior: { hadRecommendation: false },
      traces,
    });
    process.stdout.write(`\rGauntlet progress: ${total}/500`);
  }

  process.stdout.write("\n");
  assert(total === 500, `Gauntlet expected 500 turns, got ${total}.`);
  console.log("Gauntlet summary: 500/500 passed.");
}

async function main(): Promise<void> {
  const server = await startServer(PORT);
  try {
    await runGauntlet(server.baseUrl);
  } finally {
    await server.stop();
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
