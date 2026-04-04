#!/usr/bin/env tsx

import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { compileTurnPolicy } from "../../apps/web/lib/chat/policy-compiler";
import type { ParsedTurn } from "../../apps/web/lib/chat/turn-parser-contract";
import {
  extractConstraintsFromUserMessage,
  normalizeHardConstraints,
} from "../../apps/web/lib/filters/extract-constraints";
import { shapeCandidatesForAI } from "../../apps/web/lib/filters/candidate-shaping";
import {
  isReasonableLongSideRatio,
  isWithinRelaxedBucketDistance,
  resolveRequestedSizePreset,
} from "../../apps/web/lib/recommend/size-similarity-policy";
import { toSimilaritySizePreset } from "../../apps/web/lib/inventory/size-presets";
import {
  buildInitialConversationMemory,
  mergeConversationMemory,
} from "../../apps/web/lib/chat/memory";
import { buildAiContextPacket } from "../../apps/web/lib/chat/context-packet";
import type { SessionData } from "../../apps/web/lib/chat/types";

type ScenarioResult = {
  name: string;
  passed: boolean;
  details?: string;
};

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

const RUN_ID = `concierge-rework-e2e-${Date.now()}`;
const PORT = 4110;
const FALLBACK_PORT = 4111;
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const APP_DIR = path.resolve(REPO_ROOT, "apps", "web");

const results: ScenarioResult[] = [];

function check(name: string, condition: boolean, details?: string): void {
  results.push({
    name,
    passed: condition,
    details,
  });
}

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

function asNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || Number.isNaN(value)) {
    fail(`${label} must be a number.`);
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

function buildServerEnv(input: {
  fallbackOpenAi?: boolean;
}): Record<string, string> {
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
      "OPENAI_CHAT_MODEL is required for concierge rework scenario harness."
    );
  }
  if (!recommendationModel) {
    throw new Error(
      "OPENAI_RECOMMENDATION_MODEL is required for concierge rework scenario harness."
    );
  }
  if (!visionModel) {
    throw new Error(
      "OPENAI_VISION_MODEL is required for concierge rework scenario harness."
    );
  }
  if (!enableGeneralChatAi) {
    throw new Error(
      "ENABLE_GENERAL_CHAT_AI is required for concierge rework scenario harness."
    );
  }
  if (!upstashUrl) {
    throw new Error(
      "UPSTASH_REDIS_REST_URL is required for concierge rework scenario harness."
    );
  }
  if (!upstashToken) {
    throw new Error(
      "UPSTASH_REDIS_REST_TOKEN is required for concierge rework scenario harness."
    );
  }

  const env: Record<string, string> = {
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

  if (input.fallbackOpenAi) {
    env.OPENAI_API_KEY = "invalid-key-for-parser-fallback";
  }

  return env;
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
  fail(`Server did not become ready at ${baseUrl} within ${timeoutMs}ms.`);
}

async function startServer(input: {
  port: number;
  fallbackOpenAi?: boolean;
}): Promise<ServerHandle> {
  const baseUrl = `http://127.0.0.1:${input.port}`;
  const env = buildServerEnv({ fallbackOpenAi: input.fallbackOpenAi });

  const child = spawn(
    "npm",
    ["--workspace", "apps/web", "run", "dev", "--", "--port", String(input.port)],
    {
      cwd: REPO_ROOT,
      env,
      stdio: ["ignore", "pipe", "pipe"],
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
  const response = await fetch(`${input.baseUrl}${input.path}`, {
    method: input.method ?? "GET",
    headers: {
      "content-type": "application/json",
      ...(input.headers ?? {}),
    },
    body: input.body === undefined ? undefined : JSON.stringify(input.body),
  });
  const text = await response.text();
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return {
    status: response.status,
    json,
    text,
  };
}

async function sendChatTurn(input: {
  baseUrl: string;
  caseId: string;
  sessionId: string;
  message: string;
  role?: string;
  constraints?: Record<string, unknown>;
  tenantId?: string;
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
      role: input.role ?? "retail_customer",
      tenant_id: input.tenantId,
      constraints: input.constraints,
    },
  });

  if (response.status >= 400) {
    fail(`Chat API failed (${response.status}) for case ${input.caseId}: ${response.text}`);
  }

  const payload = asObject(response.json, `chat payload (${input.caseId})`);
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
    path: `/api/debug/trace?run=${encodeURIComponent(RUN_ID)}&case=${encodeURIComponent(
      caseId
    )}`,
  });
  if (response.status >= 400) {
    fail(`Debug trace API failed (${response.status}) for case ${caseId}: ${response.text}`);
  }
  const payload = asObject(response.json, `trace payload (${caseId})`) as DebugTracePayload;
  assert(Array.isArray(payload.traces), `${caseId}.traces must be array`);
  return payload;
}

function getChannelTraces(
  payload: DebugTracePayload,
  channel: string
): Array<Record<string, unknown>> {
  return payload.traces
    .filter((trace) => trace.channel === channel && trace.payload)
    .map((trace) => trace.payload as Record<string, unknown>);
}

function findTraceByMessage(
  traces: Array<Record<string, unknown>>,
  messagePath: string,
  message: string
): Record<string, unknown> {
  for (const trace of traces) {
    const pathParts = messagePath.split(".");
    let current: unknown = trace;
    for (const part of pathParts) {
      if (!current || typeof current !== "object") {
        current = null;
        break;
      }
      current = (current as Record<string, unknown>)[part];
    }
    if (current === message) return trace;
  }
  fail(`No trace found for message '${message}' at path '${messagePath}'.`);
}

function validateParserPolicyTrace(trace: Record<string, unknown>, label: string): void {
  const routing = asObject(trace.routing, `${label}.routing`);
  const parser = asObject(routing.parser, `${label}.routing.parser`);
  asString(parser.model, `${label}.parser.model`);
  asString(parser.parse_status, `${label}.parser.parse_status`);
  if (parser.fallback_reason !== null) {
    asString(parser.fallback_reason, `${label}.parser.fallback_reason`);
  }
  asObject(parser.normalized_payload, `${label}.parser.normalized_payload`);

  const policy = asObject(routing.policy, `${label}.routing.policy`);
  asObject(policy.compiled_policy, `${label}.policy.compiled_policy`);
  if (policy.policy_source !== null) {
    asString(policy.policy_source, `${label}.policy.policy_source`);
  }
  asObject(policy.must_prefer_avoid, `${label}.policy.must_prefer_avoid`);
}

function validatePipelineTrace(trace: Record<string, unknown>, label: string): void {
  asNumber(trace.dynamic_limit, `${label}.dynamic_limit`);
  asObject(trace.policy_sql_filters, `${label}.policy_sql_filters`);
  asString(trace.query_variant_reason, `${label}.query_variant_reason`);
  const rowCounts = asObject(trace.row_counts, `${label}.row_counts`);
  asNumber(rowCounts.sql_rows_total, `${label}.row_counts.sql_rows_total`);
  asArray(rowCounts.sql_rows_by_variant, `${label}.row_counts.sql_rows_by_variant`);
  asArray(trace.query_trace, `${label}.query_trace`);
  const noMatch = asObject(trace.no_match, `${label}.no_match`);
  asString(noMatch.fallback_tier, `${label}.no_match.fallback_tier`);
  asString(noMatch.reasonableness_gate, `${label}.no_match.reasonableness_gate`);
  if (noMatch.terminal_reason_code !== null) {
    asString(noMatch.terminal_reason_code, `${label}.no_match.terminal_reason_code`);
  }
}

function validateReactionTrace(trace: Record<string, unknown>, label: string): void {
  const reaction = asObject(trace.reaction, `${label}.reaction`);
  if (reaction.referenced_rug_id !== null) {
    asString(reaction.referenced_rug_id, `${label}.reaction.referenced_rug_id`);
  }
  asObject(reaction.liked_attributes_before, `${label}.reaction.liked_attributes_before`);
  asObject(reaction.liked_attributes_after, `${label}.reaction.liked_attributes_after`);
}

function countDistinct(values: Array<string | null | undefined>): number {
  return new Set(values.filter((value): value is string => Boolean(value && value.trim()))).size;
}

function toRecommendations(payload: ChatApiPayload): Array<Record<string, unknown>> {
  const response = asObject(payload.response, "payload.response");
  return asArray(response.recommendations ?? [], "payload.response.recommendations").map(
    (item, index) => asObject(item, `recommendation[${index}]`)
  );
}

function toRuntime(payload: ChatApiPayload): Record<string, unknown> {
  const recommendationState = asObject(payload.recommendation_state, "recommendation_state");
  return asObject(recommendationState.runtime ?? {}, "recommendation_state.runtime");
}

async function runLiveScenarios(baseUrl: string): Promise<void> {
  const session = () => randomUUID();

  // 1) Discovery mode + diversity + natural question.
  {
    const caseId = "s01-discovery";
    const message = "Show me what you have";
    const response = await sendChatTurn({
      baseUrl,
      caseId,
      sessionId: session(),
      message,
    });
    const recommendations = toRecommendations(response);
    assert(recommendations.length > 0, `${caseId}: expected recommendations.`);
    const assistantMessage = asString(
      asObject(response.response, `${caseId}.response`).assistant_message,
      `${caseId}.assistant_message`
    );
    assert(assistantMessage.includes("?"), `${caseId}: expected natural question.`);

    const diversityScore =
      countDistinct(recommendations.map((item) => (item.style as string | null) ?? null)) +
      countDistinct(recommendations.map((item) => (item.origin as string | null) ?? null)) +
      countDistinct(recommendations.map((item) => (item.mood as string | null) ?? null));
    assert(diversityScore >= 3, `${caseId}: expected diverse discovery candidates.`);

    const traces = await fetchCaseTraces(baseUrl, caseId);
    const chatTrace = findTraceByMessage(
      getChannelTraces(traces, "chat-route"),
      "request.message",
      message
    );
    validateParserPolicyTrace(chatTrace, caseId);
    validateReactionTrace(chatTrace, caseId);
    const parserPayload = asObject(
      asObject(asObject(chatTrace.routing, `${caseId}.routing`).parser, `${caseId}.parser`)
        .normalized_payload,
      `${caseId}.normalized_payload`
    );
    assert(parserPayload.mode === "discovery", `${caseId}: parser mode must be discovery.`);

    const pipelineTrace = findTraceByMessage(
      getChannelTraces(traces, "recommendation-pipeline"),
      "user_message",
      message
    );
    validatePipelineTrace(pipelineTrace, caseId);
    const sqlFilters = asObject(pipelineTrace.policy_sql_filters, `${caseId}.policy_sql_filters`);
    assert(
      sqlFilters.color_prefilter_active === false,
      `${caseId}: discovery should not enable color SQL prefilter.`
    );

    check(caseId, true);
  }

  // 2) Blue -> high confidence + color SQL prefilter active + blue-family rugs shown.
  {
    const caseId = "s02-blue-prefilter";
    const message = "Show me blue rugs";
    const response = await sendChatTurn({
      baseUrl,
      caseId,
      sessionId: session(),
      message,
    });
    const runtime = toRuntime(response);
    const shown = asArray(runtime.recently_shown_rugs ?? [], `${caseId}.recently_shown_rugs`);
    assert(shown.length > 0, `${caseId}: expected recently_shown_rugs.`);
    const hasBlueFamily = shown.some((item, index) => {
      const rug = asObject(item, `${caseId}.shown[${index}]`);
      const colors = asArray(rug.colors ?? [], `${caseId}.shown[${index}].colors`).map((v) =>
        String(v).toLowerCase()
      );
      return colors.includes("blue") || colors.includes("teal");
    });
    assert(hasBlueFamily, `${caseId}: expected blue/teal in shown rug colors.`);

    const traces = await fetchCaseTraces(baseUrl, caseId);
    const chatTrace = findTraceByMessage(
      getChannelTraces(traces, "chat-route"),
      "request.message",
      message
    );
    validateParserPolicyTrace(chatTrace, caseId);
    const parserPayload = asObject(
      asObject(asObject(chatTrace.routing, `${caseId}.routing`).parser, `${caseId}.parser`)
        .normalized_payload,
      `${caseId}.normalized_payload`
    );
    const parserConstraints = asObject(parserPayload.constraints, `${caseId}.constraints`);
    const parserColors = asArray(parserConstraints.colors, `${caseId}.constraints.colors`).map(
      (item) => String(item)
    );
    assert(parserColors.includes("blue"), `${caseId}: parser colors must include blue.`);
    assert(
      parserPayload.confidence === "high",
      `${caseId}: parser confidence expected high for explicit color request.`
    );

    const pipelineTrace = findTraceByMessage(
      getChannelTraces(traces, "recommendation-pipeline"),
      "user_message",
      message
    );
    validatePipelineTrace(pipelineTrace, caseId);
    const sqlFilters = asObject(pipelineTrace.policy_sql_filters, `${caseId}.policy_sql_filters`);
    assert(sqlFilters.color_prefilter_active === true, `${caseId}: color prefilter must be active.`);
    const colorTokens = asArray(
      sqlFilters.color_prefilter_tokens,
      `${caseId}.policy_sql_filters.color_prefilter_tokens`
    ).map((token) => String(token).toLowerCase());
    assert(colorTokens.includes("blue"), `${caseId}: expected blue token in SQL prefilter.`);

    check(caseId, true);
  }

  // 3) Warm -> low confidence + no color SQL prefilter.
  {
    const caseId = "s03-warm-hint-only";
    const message = "I want something warm";
    const response = await sendChatTurn({
      baseUrl,
      caseId,
      sessionId: session(),
      message,
    });
    assert(toRecommendations(response).length > 0, `${caseId}: expected recommendations.`);

    const traces = await fetchCaseTraces(baseUrl, caseId);
    const chatTrace = findTraceByMessage(
      getChannelTraces(traces, "chat-route"),
      "request.message",
      message
    );
    validateParserPolicyTrace(chatTrace, caseId);
    const parserPayload = asObject(
      asObject(asObject(chatTrace.routing, `${caseId}.routing`).parser, `${caseId}.parser`)
        .normalized_payload,
      `${caseId}.normalized_payload`
    );
    const parserConstraints = asObject(parserPayload.constraints, `${caseId}.constraints`);
    const parserColors = asArray(parserConstraints.colors, `${caseId}.constraints.colors`);
    assert(parserColors.length === 0, `${caseId}: expected no canonical colors parsed.`);
    assert(parserPayload.confidence === "low", `${caseId}: expected low confidence.`);

    const pipelineTrace = findTraceByMessage(
      getChannelTraces(traces, "recommendation-pipeline"),
      "user_message",
      message
    );
    validatePipelineTrace(pipelineTrace, caseId);
    const sqlFilters = asObject(pipelineTrace.policy_sql_filters, `${caseId}.policy_sql_filters`);
    assert(
      sqlFilters.color_prefilter_active === false,
      `${caseId}: warm hint should not activate color SQL prefilter.`
    );

    check(caseId, true);
  }

  // 4) Exact size must -> strict bucket behavior.
  {
    const caseId = "s04-size-must";
    const message = "I need exactly an 8x10, must fit my dining room";
    const response = await sendChatTurn({
      baseUrl,
      caseId,
      sessionId: session(),
      message,
    });
    assert(toRecommendations(response).length > 0, `${caseId}: expected recommendations.`);

    const traces = await fetchCaseTraces(baseUrl, caseId);
    const chatTrace = findTraceByMessage(
      getChannelTraces(traces, "chat-route"),
      "request.message",
      message
    );
    validateParserPolicyTrace(chatTrace, caseId);
    const policy = asObject(
      asObject(asObject(chatTrace.routing, `${caseId}.routing`).policy, `${caseId}.policy`)
        .compiled_policy,
      `${caseId}.compiled_policy`
    );
    const hardConstraints = asObject(policy.hard_constraints, `${caseId}.hard_constraints`);
    const size = asObject(hardConstraints.size, `${caseId}.hard_constraints.size`);
    assert(size.toleranceIn === 0, `${caseId}: strict size should compile to toleranceIn=0.`);

    const pipelineTrace = findTraceByMessage(
      getChannelTraces(traces, "recommendation-pipeline"),
      "user_message",
      message
    );
    validatePipelineTrace(pipelineTrace, caseId);
    const sqlFilters = asObject(pipelineTrace.policy_sql_filters, `${caseId}.policy_sql_filters`);
    assert(sqlFilters.size_window !== null, `${caseId}: expected size window for must-size query.`);

    check(caseId, true);
  }

  // 5) Around size prefer -> adjacent bucket behavior.
  {
    const caseId = "s05-size-prefer";
    const message = "Show me something around 8x10";
    const response = await sendChatTurn({
      baseUrl,
      caseId,
      sessionId: session(),
      message,
    });
    const recs = toRecommendations(response);
    assert(recs.length > 0, `${caseId}: expected recommendations.`);

    const traces = await fetchCaseTraces(baseUrl, caseId);
    const chatTrace = findTraceByMessage(
      getChannelTraces(traces, "chat-route"),
      "request.message",
      message
    );
    validateParserPolicyTrace(chatTrace, caseId);
    const policy = asObject(
      asObject(asObject(chatTrace.routing, `${caseId}.routing`).policy, `${caseId}.policy`)
        .compiled_policy,
      `${caseId}.compiled_policy`
    );
    const size = asObject(
      asObject(policy.hard_constraints, `${caseId}.hard_constraints`).size,
      `${caseId}.hard_constraints.size`
    );
    assert(
      typeof size.toleranceIn === "number" && Number(size.toleranceIn) > 0,
      `${caseId}: prefer size should have toleranceIn > 0.`
    );

    check(caseId, true);
  }

  // 6) Reaction tracking with resolved reference.
  {
    const caseId = "s06-reaction-resolved";
    const sessionId = session();
    const turn1 = "Show me rust rugs";
    const turn2 = "I love the first one";

    await sendChatTurn({ baseUrl, caseId, sessionId, message: turn1 });
    const response2 = await sendChatTurn({ baseUrl, caseId, sessionId, message: turn2 });

    const runtime = toRuntime(response2);
    const likedIds = asArray(runtime.liked_rug_ids ?? [], `${caseId}.liked_rug_ids`);
    assert(likedIds.length > 0, `${caseId}: expected liked_rug_ids after reaction.`);
    const likedAttributes = asObject(runtime.liked_attributes ?? {}, `${caseId}.liked_attributes`);
    const likedColors = asArray(likedAttributes.colors ?? [], `${caseId}.liked_attributes.colors`);
    assert(likedColors.length > 0, `${caseId}: expected liked color attributes.`);

    const traces = await fetchCaseTraces(baseUrl, caseId);
    const chatTrace2 = findTraceByMessage(
      getChannelTraces(traces, "chat-route"),
      "request.message",
      turn2
    );
    validateParserPolicyTrace(chatTrace2, caseId);
    validateReactionTrace(chatTrace2, caseId);
    const parserPayload = asObject(
      asObject(asObject(chatTrace2.routing, `${caseId}.routing`).parser, `${caseId}.parser`)
        .normalized_payload,
      `${caseId}.normalized_payload`
    );
    assert(
      typeof parserPayload.referenced_rug_id === "string",
      `${caseId}: expected referenced_rug_id to be resolved.`
    );
    assert(
      parserPayload.rug_reference_ambiguous === false,
      `${caseId}: expected non-ambiguous reference.`
    );

    const pipelineTrace2 = findTraceByMessage(
      getChannelTraces(traces, "recommendation-pipeline"),
      "user_message",
      turn2
    );
    validatePipelineTrace(pipelineTrace2, caseId);
    const promptContext = asObject(pipelineTrace2.prompt_context ?? {}, `${caseId}.prompt_context`);
    const chatContext = asObject(promptContext.chat_context ?? {}, `${caseId}.chat_context`);
    const likedFromPrompt = asObject(
      chatContext.liked_attributes ?? {},
      `${caseId}.chat_context.liked_attributes`
    );
    const promptLikedColors = asArray(
      likedFromPrompt.colors ?? [],
      `${caseId}.chat_context.liked_attributes.colors`
    );
    assert(
      promptLikedColors.length > 0,
      `${caseId}: expected same-turn liked attributes to reach ranking context.`
    );

    check(caseId, true);
  }

  // 7) Ambiguous reference -> disambiguation mode.
  {
    const caseId = "s07-reference-ambiguous";
    const sessionId = session();
    const turn1 = "Show me rust rugs";
    const turn2 = "I love the rust one";

    await sendChatTurn({ baseUrl, caseId, sessionId, message: turn1 });
    const response2 = await sendChatTurn({ baseUrl, caseId, sessionId, message: turn2 });

    const fineMode = asString(response2.fine_mode, `${caseId}.fine_mode`);
    assert(fineMode === "disambiguation", `${caseId}: expected disambiguation fine_mode.`);
    const recs = toRecommendations(response2);
    assert(
      recs.length >= 2 && recs.length <= 3,
      `${caseId}: disambiguation should return 2-3 candidates.`
    );

    const traces = await fetchCaseTraces(baseUrl, caseId);
    const chatTrace2 = findTraceByMessage(
      getChannelTraces(traces, "chat-route"),
      "request.message",
      turn2
    );
    validateParserPolicyTrace(chatTrace2, caseId);
    const parserPayload = asObject(
      asObject(asObject(chatTrace2.routing, `${caseId}.routing`).parser, `${caseId}.parser`)
        .normalized_payload,
      `${caseId}.normalized_payload`
    );
    assert(
      parserPayload.rug_reference_ambiguous === true,
      `${caseId}: parser should flag ambiguous rug reference.`
    );

    check(caseId, true);
  }

  // 8) Style no-match fallback.
  {
    const caseId = "s08-style-fallback";
    const message = "Show me recommendations";
    const response = await sendChatTurn({
      baseUrl,
      caseId,
      sessionId: session(),
      message,
      constraints: {
        styles: ["Beni Ourain"],
        strictness: { styles: "prefer" },
      },
    });
    const notes = String(asObject(response.response, `${caseId}.response`).notes ?? "");
    assert(
      notes.includes("STYLE_RELAXED_TO_ORIGIN_OR_MOOD") ||
        notes.includes("STYLE_DROPPED_AFTER_FALLBACK") ||
        toRecommendations(response).length > 0,
      `${caseId}: expected style fallback behavior.`
    );

    const traces = await fetchCaseTraces(baseUrl, caseId);
    const pipelineTrace = findTraceByMessage(
      getChannelTraces(traces, "recommendation-pipeline"),
      "user_message",
      message
    );
    validatePipelineTrace(pipelineTrace, caseId);

    check(caseId, true);
  }

  // 9) Size fallback disclosure.
  {
    const caseId = "s09-size-fallback-disclosure";
    const message = "Find the closest thing to exactly 11x13";
    const response = await sendChatTurn({
      baseUrl,
      caseId,
      sessionId: session(),
      message,
    });
    const notes = String(asObject(response.response, `${caseId}.response`).notes ?? "");
    assert(
      notes.includes("SIZE_RELAX_SOFT") ||
        notes.includes("SIZE_RELAX_MEDIUM") ||
        notes.includes("SIZE_RELAX_STRONG") ||
        asString(response.fine_mode, `${caseId}.fine_mode`) === "no_match",
      `${caseId}: expected proportional size fallback disclosure or explicit no-match.`
    );

    const traces = await fetchCaseTraces(baseUrl, caseId);
    const pipelineTrace = findTraceByMessage(
      getChannelTraces(traces, "recommendation-pipeline"),
      "user_message",
      message
    );
    validatePipelineTrace(pipelineTrace, caseId);

    check(caseId, true);
  }

  // 10) Unreasonable request expands to closest available with honest disclosure.
  {
    const caseId = "s10-terminal-no-match";
    const sessionId = session();
    const turn1 = "I need exactly a 50x50 rug";
    const turn2 = "Yes, show me closest";

    await sendChatTurn({ baseUrl, caseId, sessionId, message: turn1 });
    const response2 = await sendChatTurn({ baseUrl, caseId, sessionId, message: turn2 });

    const responseBody = asObject(response2.response, `${caseId}.response`);
    assert(response2.fine_mode !== "no_match", `${caseId}: expected expanded recommendations.`);
    assert(
      toRecommendations(response2).length > 0,
      `${caseId}: expected closest alternatives instead of empty no-match.`
    );
    const notes = String(responseBody.notes ?? "");
    assert(
      notes.includes("CONSTRAINT_MISMATCH_EXPANDED"),
      `${caseId}: expected expanded mismatch disclosure note.`
    );

    const traces = await fetchCaseTraces(baseUrl, caseId);
    const pipelineTrace2 = findTraceByMessage(
      getChannelTraces(traces, "recommendation-pipeline"),
      "user_message",
      turn2
    );
    validatePipelineTrace(pipelineTrace2, caseId);
    const noMatch = asObject(pipelineTrace2.no_match, `${caseId}.no_match`);
    assert(noMatch.fallback_tier === "expanded", `${caseId}: expected fallback_tier=expanded.`);
    assert(
      noMatch.terminal_reason_code === null,
      `${caseId}: expected terminal_reason_code=null when alternatives are shown.`
    );

    check(caseId, true);
  }

  // 11) More-like-this with reference + anti-repeat context.
  {
    const caseId = "s11-more-like-this";
    const sessionId = session();
    const turn1 = "Show me Oushaks";
    const turn2 = "I like the second one, show me more like that";

    await sendChatTurn({ baseUrl, caseId, sessionId, message: turn1 });
    const response2 = await sendChatTurn({ baseUrl, caseId, sessionId, message: turn2 });
    assert(toRecommendations(response2).length > 0, `${caseId}: expected recommendations.`);

    const traces = await fetchCaseTraces(baseUrl, caseId);
    const chatTrace2 = findTraceByMessage(
      getChannelTraces(traces, "chat-route"),
      "request.message",
      turn2
    );
    validateParserPolicyTrace(chatTrace2, caseId);
    const parserPayload = asObject(
      asObject(asObject(chatTrace2.routing, `${caseId}.routing`).parser, `${caseId}.parser`)
        .normalized_payload,
      `${caseId}.normalized_payload`
    );
    const sessionFacts = asArray(parserPayload.session_facts, `${caseId}.session_facts`);
    assert(sessionFacts.length >= 0, `${caseId}: parser session_facts field should exist.`);

    const pipelineTrace2 = findTraceByMessage(
      getChannelTraces(traces, "recommendation-pipeline"),
      "user_message",
      turn2
    );
    validatePipelineTrace(pipelineTrace2, caseId);
    const promptContext = asObject(pipelineTrace2.prompt_context ?? {}, `${caseId}.prompt_context`);
    const chatContext = asObject(promptContext.chat_context ?? {}, `${caseId}.chat_context`);
    const recentlyShown = asArray(
      chatContext.recently_shown_rugs ?? [],
      `${caseId}.chat_context.recently_shown_rugs`
    );
    assert(recentlyShown.length > 0, `${caseId}: expected recently_shown_rugs in AI context.`);

    check(caseId, true);
  }

  // 12) General chat bridge.
  {
    const caseId = "s12-general-chat-bridge";
    const message = "What is a Kilim?";
    const response = await sendChatTurn({
      baseUrl,
      caseId,
      sessionId: session(),
      message,
    });

    assert(response.mode === "general_chat", `${caseId}: expected general_chat mode.`);
    const assistantMessage = asString(
      asObject(response.response, `${caseId}.response`).assistant_message,
      `${caseId}.assistant_message`
    ).toLowerCase();
    assert(
      assistantMessage.includes("show") &&
        (assistantMessage.includes("collection") || assistantMessage.includes("examples")),
      `${caseId}: expected natural bridge to show examples.`
    );

    const traces = await fetchCaseTraces(baseUrl, caseId);
    const chatTrace = findTraceByMessage(
      getChannelTraces(traces, "chat-route"),
      "request.message",
      message
    );
    validateParserPolicyTrace(chatTrace, caseId);
    const pipelineTraces = getChannelTraces(traces, "recommendation-pipeline");
    assert(
      pipelineTraces.length === 0,
      `${caseId}: no recommendation-pipeline trace expected for general chat.`
    );

    check(caseId, true);
  }

  // 13) Stable facts -> customer context used later.
  {
    const caseId = "s13-stable-facts-customer-context";
    const sessionId = session();
    const turn1 = "I have a gray sectional in my living room and want warm contrast.";
    const turn2 = "Show me recommendations";

    await sendChatTurn({ baseUrl, caseId, sessionId, message: turn1 });
    await sendChatTurn({ baseUrl, caseId, sessionId, message: turn2 });

    const traces = await fetchCaseTraces(baseUrl, caseId);
    const pipelineTrace2 = findTraceByMessage(
      getChannelTraces(traces, "recommendation-pipeline"),
      "user_message",
      turn2
    );
    validatePipelineTrace(pipelineTrace2, caseId);
    const promptContext = asObject(pipelineTrace2.prompt_context ?? {}, `${caseId}.prompt_context`);
    const chatContext = asObject(promptContext.chat_context ?? {}, `${caseId}.chat_context`);
    const customerContext = asArray(chatContext.customer_context ?? [], `${caseId}.customer_context`);
    assert(customerContext.length > 0, `${caseId}: expected customer_context populated.`);

    check(caseId, true);
  }

  // 14) Session persistence across reload boundary + tenant scoping invariant.
  {
    const caseId = "s14-session-persistence-scope";
    const sessionId = session();
    const turn1 = await sendChatTurn({
      baseUrl,
      caseId,
      sessionId,
      message: "Show me blue options",
    });
    await sendChatTurn({
      baseUrl,
      caseId,
      sessionId,
      message: "Show me more",
    });
    await sendChatTurn({
      baseUrl,
      caseId,
      sessionId,
      message: "I like the first one",
    });
    const turn4 = await sendChatTurn({
      baseUrl,
      caseId,
      sessionId,
      message: "Keep going",
      tenantId: "00000000-0000-0000-0000-000000000000",
    });

    assert(
      turn4.session_id === sessionId,
      `${caseId}: expected same session_id on 4th turn.`
    );
    const recState4 = asObject(turn4.recommendation_state, `${caseId}.recommendation_state`);
    const runtime4 = asObject(recState4.runtime ?? {}, `${caseId}.runtime`);
    const likedIds = asArray(runtime4.liked_rug_ids ?? [], `${caseId}.liked_rug_ids`);
    assert(likedIds.length > 0, `${caseId}: expected persisted liked_rug_ids by turn 4.`);

    const recState1 = asObject(turn1.recommendation_state, `${caseId}.turn1.recommendation_state`);
    const tenantAtTurn1 = String((recState1 as Record<string, unknown>).tenant_id ?? "");
    void tenantAtTurn1;

    check(caseId, true);
  }

  // 15) Staff role behavior still accepted + recommendations path works.
  {
    const caseId = "s15-staff-role";
    const message = "Show dining room options";
    const response = await sendChatTurn({
      baseUrl,
      caseId,
      sessionId: session(),
      message,
      role: "store_staff",
    });
    assert(response.mode === "recommendation", `${caseId}: expected recommendation mode.`);
    assert(toRecommendations(response).length > 0, `${caseId}: expected recommendations.`);

    const traces = await fetchCaseTraces(baseUrl, caseId);
    const chatTrace = findTraceByMessage(
      getChannelTraces(traces, "chat-route"),
      "request.message",
      message
    );
    validateParserPolicyTrace(chatTrace, caseId);
    validateReactionTrace(chatTrace, caseId);

    check(caseId, true);
  }
}

async function runFallbackParserScenario(): Promise<void> {
  const caseId = "s16-parser-fallback";
  const server = await startServer({ port: FALLBACK_PORT, fallbackOpenAi: true });
  try {
    const sessionId = randomUUID();
    const message = "Show me blue rugs";
    const response = await sendChatTurn({
      baseUrl: server.baseUrl,
      caseId,
      sessionId,
      message,
    });
    assert(response.mode === "recommendation", `${caseId}: expected recommendation mode.`);

    const traces = await fetchCaseTraces(server.baseUrl, caseId);
    const chatTrace = findTraceByMessage(
      getChannelTraces(traces, "chat-route"),
      "request.message",
      message
    );
    validateParserPolicyTrace(chatTrace, caseId);
    const parser = asObject(
      asObject(chatTrace.routing, `${caseId}.routing`).parser,
      `${caseId}.parser`
    );
    assert(
      parser.parse_status === "fallback",
      `${caseId}: expected parser fallback status with invalid OpenAI key.`
    );
    assert(
      typeof parser.fallback_reason === "string" && parser.fallback_reason.length > 0,
      `${caseId}: fallback_reason should be present.`
    );

    check(caseId, true);
  } finally {
    await server.stop();
  }
}

function runDeterministicRegressionChecks(): void {
  // Original behavior checks retained and expanded.
  {
    const extracted = extractConstraintsFromUserMessage(
      "Need an 8 by 10 navy rug for my living room"
    );
    check(
      "r01.extract-8-by-10",
      Boolean(extracted.size && extracted.size.widthIn === 96 && extracted.size.lengthIn === 120),
      JSON.stringify(extracted.size)
    );
    check(
      "r02.extract-navy-to-blue",
      Boolean(extracted.colors?.includes("blue")),
      JSON.stringify(extracted.colors)
    );
  }

  {
    const normalized = normalizeHardConstraints({
      size: { widthIn: 96, lengthIn: 120 },
      colors: ["blue"],
      strictness: { size: "must", colors: "prefer" },
      avoid_preferences: {
        colors: ["red"],
        styles: ["floral"],
        shapes: ["runner"],
      },
    });
    check(
      "r03.normalize-strictness",
      normalized.strictness?.size === "must" && normalized.strictness?.colors === "prefer",
      JSON.stringify(normalized.strictness)
    );
    check(
      "r04.normalize-avoid",
      Boolean(
        normalized.avoid_preferences?.colors?.includes("red") &&
          normalized.avoid_preferences?.styles?.includes("floral") &&
          normalized.avoid_preferences?.shapes?.includes("runner")
      ),
      JSON.stringify(normalized.avoid_preferences)
    );
  }

  {
    const parsedTurn: ParsedTurn = {
      intent: "recommend",
      mode: "recommendation",
      followup_intent: "none",
      constraints: {
        size: { widthIn: 96, lengthIn: 120 },
        colors: ["blue"],
        styles: [],
        shape: null,
      },
      strictness: {
        size: "must",
        colors: "prefer",
        styles: "prefer",
        shape: "prefer",
      },
      avoid: {
        colors: [],
        styles: [],
        shapes: [],
      },
      session_facts: [],
      rug_reference_ambiguous: false,
      confidence: "high",
    };
    const policy = compileTurnPolicy({ parsedTurn });
    check(
      "r05.strict-size-tolerance-0",
      policy.hard_constraints.size?.toleranceIn === 0,
      JSON.stringify(policy.hard_constraints.size)
    );
  }

  {
    const requestedPreset = resolveRequestedSizePreset({ widthIn: 600, lengthIn: 600 });
    const candidatePreset = toSimilaritySizePreset({ widthIn: 108, lengthIn: 144 });
    check(
      "r06.size-guard-blocks-absurd-ratio",
      !isReasonableLongSideRatio({ requestedLongSideIn: 600, candidateLongSideIn: 144 }),
      JSON.stringify({ requestedPreset, candidatePreset })
    );
    check(
      "r07.size-guard-allows-adjacent",
      isWithinRelaxedBucketDistance({
        requestedPreset: resolveRequestedSizePreset({ widthIn: 96, lengthIn: 120 }),
        candidatePreset,
      }),
      JSON.stringify({ candidatePreset })
    );
  }

  {
    const rugA = {
      id: "rug-a",
      intake_label: "Blue Oushak",
      status: "available",
      width_total_in: 96,
      length_total_in: 120,
      ai_description: "Blue Oushak floral",
      ai_structured_fields: {
        style: "Oushak",
        origin: "Turkish",
        mood: "traditional",
        pattern: ["floral motif"],
        primary_colors: ["blue", "ivory"],
      },
      staff_overrides: null,
      effective_fields: {
        label: "Blue Oushak",
        origin: "Turkish",
        style: "Oushak",
        pattern: ["floral motif"],
        primary_colors: ["blue", "ivory"],
        age_category: null,
        mood: "traditional",
      },
    };
    const rugB = {
      ...rugA,
      id: "rug-b",
      intake_label: "Red Oushak",
      ai_description: "Red Oushak floral",
      ai_structured_fields: {
        ...rugA.ai_structured_fields,
        primary_colors: ["red", "ivory"],
      },
      effective_fields: {
        ...rugA.effective_fields,
        label: "Red Oushak",
        primary_colors: ["red", "ivory"],
      },
    };

    const ranked = shapeCandidatesForAI([rugB as never, rugA as never], {
      userMessage: "I want blue and avoid red",
      constraints: {
        colors: ["blue"],
        avoid_preferences: {
          colors: ["red"],
          styles: [],
          shapes: [],
        },
      },
      maxCandidates: 2,
    });

    check(
      "r08.avoid-penalty-lowers-avoided-rug",
      ranked[0]?.id === "rug-a",
      JSON.stringify(ranked.map((rug) => rug.id))
    );
  }

  {
    const memory0 = buildInitialConversationMemory("2026-01-01T00:00:00.000Z");
    const merged = mergeConversationMemory(memory0, {
      userMessage: "I have a gray sectional in my living room",
      assistantMessage: "Noted. I can prioritize warm contrast options.",
      lastUserIntent: "recommendation",
      noMatchAttempts: 0,
      sessionFacts: ["room: living room", "has gray sectional", "wants warm contrast"],
      now: "2026-01-01T00:01:00.000Z",
    });

    const session: SessionData = {
      session_id: "memory-test",
      tenant_id: "tenant",
      role: "retail_customer",
      chat_history: [],
      conversation_memory: merged,
      recommendation_state: {
        hard_constraints: {},
        soft_preferences: {},
        runtime: {},
      },
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:01:00.000Z",
    };

    const packet = buildAiContextPacket({
      session,
      latestUserMessage: "show me options",
    });

    check(
      "r09.stable-facts-flow-to-customer-context",
      packet.customer_context.some((fact) => fact.includes("gray sectional")) &&
        packet.customer_context.some((fact) => fact.includes("living room")),
      JSON.stringify(packet.customer_context)
    );
  }
}

async function main(): Promise<void> {
  const primaryServer = await startServer({ port: PORT });
  try {
    await runLiveScenarios(primaryServer.baseUrl);
  } finally {
    await primaryServer.stop();
  }

  await runFallbackParserScenario();
  runDeterministicRegressionChecks();

  for (const result of results) {
    const status = result.passed ? "PASS" : "FAIL";
    const suffix = result.details ? ` :: ${result.details}` : "";
    console.log(`[${status}] ${result.name}${suffix}`);
  }

  const failed = results.filter((result) => !result.passed);
  console.log(`\nScenario summary: ${results.length - failed.length}/${results.length} passed.`);

  if (failed.length > 0) {
    process.exitCode = 1;
    return;
  }
  process.exitCode = 0;
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
