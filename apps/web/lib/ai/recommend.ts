import type { HardConstraints, InventoryRug } from "@/lib/types/recommendation";
import { getRecommendationPromptBundle } from "@/lib/ai/prompt-library";
import {
  getMaxOutputTokens,
  normalizeText,
  postOpenAiResponses,
  shouldRetryAfterAttempt,
  toPreviewText,
  withRetryInstruction,
} from "@/lib/ai/response-quality";
import type { PromptLayerId } from "@/lib/prompts/layer-ids";
import {
  buildRecommendationPromptSections,
  groupPromptSectionsByRole,
} from "@/lib/prompts/recommendation-stack";

// PSEUDOCODE
// 1) If candidate inventory is empty -> return no_match.
// 2) Build an authoritative inventory context payload from backend candidates.
// 3) Call OpenAI Responses API with strict JSON schema output.
// 4) Parse and validate model output shape.
// 5) Enforce backend safety (IDs must be subset of candidate set; trim to top 8).
// 6) If any API/parse/validation failure occurs -> return deterministic fallback.

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const OPENAI_MODEL = process.env.OPENAI_MODEL ?? "gpt-4.1-nano";
const MAX_RECOMMENDATIONS = 8;
const CONFIDENCE_MIN = 0.35;
const CONFIDENCE_MAX = 0.95;
const MAX_ASSISTANT_MESSAGE_CHARS = 420;
const MAX_QUESTION_CHARS = 140;
const MAX_TITLE_CHARS = 160;
const MAX_SIZE_TEXT_CHARS = 64;
const MAX_REASON_CHARS = 180;
const MAX_CAVEAT_CHARS = 160;
const MAX_FACTOR_CHARS = 100;
const MAX_NOTES_CHARS = 220;
const RETRY_SYSTEM_INSTRUCTION =
  "Retry and return one complete JSON object that matches the schema exactly. Keep answers concise and finish all sentences.";

type RecommendationPromptContext = {
  role?: "retail_customer" | "trade_client" | "store_staff";
  trade_preferences?: Record<string, unknown>;
  project_context?: {
    project_name?: string | null;
    active_room?: string | null;
    room_count?: number;
    rooms?: Array<{
      room_name: string;
      constraints: HardConstraints;
    }>;
  };
  chat_context?: {
    structured_state?: unknown;
    conversation_memory?: unknown;
    recent_turns?: unknown[];
  };
};

export type RecommendationAiTrace = {
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
  parsed_response: RecommendationResponse | null;
  fallback_reason: string | null;
  error: string | null;
  incomplete_detected: boolean;
  retry_attempted: boolean;
  retry_succeeded: boolean;
  text_postprocess_applied: boolean;
};

export type RecommendationResponse = {
  mode: "recommendations" | "clarifying_question" | "no_match";
  assistant_message: string;
  questions: string[];
  recommendations: {
    rug_id: string;
    sku: string | null;
    title: string;
    size_text: string | null;
    price_usd: number | null;
    match_reasons: string[];
    confidence: number;
    confidence_tier: "high" | "medium" | "low";
    confidence_factors: string[];
    why_not: string[];
  }[];
  notes: string | null;
};

const RECOMMENDATION_SCHEMA = {
  // We ask OpenAI to return JSON that matches this exact shape.
  // This reduces parsing surprises and keeps UI contracts stable.
  type: "object",
  additionalProperties: false,
  required: [
    "mode",
    "assistant_message",
    "questions",
    "recommendations",
    "notes",
  ],
  properties: {
    mode: {
      type: "string",
      enum: ["recommendations", "clarifying_question", "no_match"],
    },
    assistant_message: {
      type: "string",
      minLength: 1,
      maxLength: MAX_ASSISTANT_MESSAGE_CHARS,
    },
    questions: {
      type: "array",
      minItems: 0,
      maxItems: 2,
      items: { type: "string", maxLength: MAX_QUESTION_CHARS },
    },
    recommendations: {
      type: "array",
      minItems: 0,
      maxItems: MAX_RECOMMENDATIONS,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "rug_id",
          "sku",
          "title",
          "size_text",
          "price_usd",
          "match_reasons",
          "confidence",
          "confidence_tier",
          "confidence_factors",
          "why_not",
        ],
        properties: {
          rug_id: { type: "string", minLength: 1, maxLength: 80 },
          sku: { type: ["string", "null"], maxLength: 80 },
          title: { type: "string", minLength: 1, maxLength: MAX_TITLE_CHARS },
          size_text: { type: ["string", "null"], maxLength: MAX_SIZE_TEXT_CHARS },
          price_usd: { type: ["number", "null"] },
          match_reasons: {
            type: "array",
            minItems: 1,
            maxItems: 3,
            items: { type: "string", minLength: 1, maxLength: MAX_REASON_CHARS },
          },
          confidence: { type: "number" },
          confidence_tier: { type: "string", enum: ["high", "medium", "low"] },
          confidence_factors: {
            type: "array",
            minItems: 0,
            maxItems: 3,
            items: { type: "string", minLength: 1, maxLength: MAX_FACTOR_CHARS },
          },
          why_not: {
            type: "array",
            minItems: 0,
            maxItems: 2,
            items: { type: "string", minLength: 1, maxLength: MAX_CAVEAT_CHARS },
          },
        },
      },
    },
    notes: { type: ["string", "null"], maxLength: MAX_NOTES_CHARS },
  },
} as const;

function hasOptionalHardConstraints(constraints: HardConstraints): boolean {
  return Boolean(constraints.size) || typeof constraints.budgetMax === "number";
}

function buildFallbackRequestText(constraints: HardConstraints): string {
  const parts: string[] = [];

  if (constraints.size) {
    parts.push(
      `size ${constraints.size.widthIn}" x ${constraints.size.lengthIn}"`
    );
  }

  if (typeof constraints.budgetMax === "number") {
    parts.push(`budget up to $${constraints.budgetMax}`);
  }

  if (parts.length === 0) {
    return "Show a varied set of available rugs from inventory.";
  }

  return `Find the best matches for ${parts.join(" and ")}.`;
}

// PSEUDOCODE
// Convert numeric dimensions into a display string for model/UI context.
function sizeText(rug: InventoryRug): string | null {
  const w = rug.width_total_in;
  const l = rug.length_total_in;

  if (typeof w !== "number" || typeof l !== "number") {
    return null;
  }

  return `${w}" x ${l}"`;
}

// PSEUDOCODE
// Shape backend inventory into a minimal, model-facing context object.
function toContextInventory(inventory: InventoryRug[]) {
  // This is the "AI-safe view" of inventory.
  // We only send fields the model should use for ranking and explanation.
  return inventory.map((rug) => ({
    id: rug.id,
    sku: rug.sku ?? null,
    label: rug.label,
    status: rug.status ?? null,
    price_usd: rug.sale_price_usd ?? rug.price_usd ?? null,
    size_text: sizeText(rug),
    width_total_in: rug.width_total_in ?? null,
    length_total_in: rug.length_total_in ?? null,
    style: rug.style ?? null,
    palette: rug.palette ?? null,
    pattern: rug.pattern ?? null,
    best_for: rug.best_for ?? null,
    description: rug.public_description ?? null,
  }));
}

function toPriceUsd(rug: InventoryRug): number | null {
  return rug.sale_price_usd ?? rug.price_usd ?? null;
}

function toLower(value: string | null | undefined): string {
  return (value ?? "").toLowerCase();
}

function collectSoftSignals(
  promptContext: RecommendationPromptContext | undefined,
  userMessage: string
): string[] {
  const signals: string[] = [];
  const text = userMessage.toLowerCase();
  const knownTokens = [
    "neutral",
    "modern",
    "vintage",
    "kitchen",
    "living room",
    "bedroom",
    "dining",
    "runner",
    "kidz",
    "pets",
    "kidz",
    "purple",
    "blue",
    "green",
    "red",
  ];

  for (const token of knownTokens) {
    if (text.includes(token)) signals.push(token);
  }

  const prefValues = promptContext?.trade_preferences
    ? Object.values(promptContext.trade_preferences)
    : [];
  for (const value of prefValues) {
    if (typeof value === "string" && value.trim()) {
      signals.push(value.toLowerCase());
    }
  }

  return [...new Set(signals)];
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function sectionPreview(value: string): string {
  return toPreviewText(value.replace(/\s+/g, " "), 120);
}

function uniqueCompactList(items: string[], maxItems: number): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const item of items) {
    const normalized = normalizeText(item);
    if (!normalized) continue;
    const dedupeKey = normalized.toLowerCase();
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    output.push(normalized);
    if (output.length >= maxItems) break;
  }
  return output;
}

function applyTonePolish(response: RecommendationResponse): RecommendationResponse {
  if (response.mode === "clarifying_question") {
    return {
      ...response,
      assistant_message: normalizeText(response.assistant_message),
      questions: uniqueCompactList(response.questions, 2),
    };
  }

  if (response.mode === "no_match") {
    const noMatchMessage = normalizeText(response.assistant_message);
    const withGuidance = /\b(adjust|widen|broaden|change|try|refine)\b/i.test(noMatchMessage)
      ? noMatchMessage
      : `${noMatchMessage} Try widening size, budget, or style filters and I can suggest alternatives.`;
    return {
      ...response,
      assistant_message: withGuidance,
      questions: uniqueCompactList(response.questions, 1),
    };
  }

  return {
    ...response,
    assistant_message: normalizeText(response.assistant_message),
    questions: [],
    recommendations: response.recommendations.map((rec) => ({
      ...rec,
      match_reasons: uniqueCompactList(rec.match_reasons, 3),
      confidence_factors: uniqueCompactList(rec.confidence_factors, 3),
      why_not: uniqueCompactList(rec.why_not, 2),
    })),
  };
}

function getSizeDistanceIn(rug: InventoryRug, constraints: HardConstraints): number | null {
  if (
    !constraints.size ||
    typeof rug.width_total_in !== "number" ||
    typeof rug.length_total_in !== "number"
  ) {
    return null;
  }

  const direct =
    Math.abs(rug.width_total_in - constraints.size.widthIn) +
    Math.abs(rug.length_total_in - constraints.size.lengthIn);
  const rotated =
    Math.abs(rug.width_total_in - constraints.size.lengthIn) +
    Math.abs(rug.length_total_in - constraints.size.widthIn);
  return Math.min(direct, rotated);
}

function buildGroundedMatchReasons(
  rug: InventoryRug,
  constraints: HardConstraints,
  promptContext: RecommendationPromptContext | undefined,
  userMessage: string
): string[] {
  const reasons: string[] = [];
  const price = toPriceUsd(rug);
  const sizeDistanceIn = getSizeDistanceIn(rug, constraints);
  const activeRoom = promptContext?.project_context?.active_room;
  const signals = collectSoftSignals(promptContext, userMessage);
  const rugText = [
    toLower(rug.style),
    toLower(rug.palette),
    toLower(rug.pattern),
    toLower(rug.best_for),
    toLower(rug.public_description),
  ].join(" ");

  if (constraints.size && sizeDistanceIn !== null) {
    reasons.push(
      sizeDistanceIn <= 2
        ? "Size closely matches your requested dimensions."
        : "Size falls within your allowed size window."
    );
  }

  if (typeof constraints.budgetMax === "number" && typeof price === "number") {
    reasons.push(`Priced at $${price}, within your budget limit.`);
  }

  if (activeRoom) {
    reasons.push(`Aligned with your active room focus: ${activeRoom}.`);
  }

  const matchedSignal = signals.find((token) => token && rugText.includes(token));
  if (matchedSignal) {
    reasons.push(`Matches your stated preference around "${matchedSignal}".`);
  }

  if (reasons.length === 0) {
    reasons.push("Fits your current request in available inventory.");
  }

  return reasons.slice(0, 3);
}

function buildWhyNot(
  rug: InventoryRug,
  constraints: HardConstraints,
  promptContext: RecommendationPromptContext | undefined,
  userMessage: string
): string[] {
  const notes: string[] = [];
  const price = toPriceUsd(rug);
  const sizeDistanceIn = getSizeDistanceIn(rug, constraints);
  const tolerance = constraints.size?.toleranceIn ?? 2;
  const signals = collectSoftSignals(promptContext, userMessage);
  const rugText = [
    toLower(rug.style),
    toLower(rug.palette),
    toLower(rug.pattern),
    toLower(rug.best_for),
    toLower(rug.public_description),
  ].join(" ");

  if (constraints.size && sizeDistanceIn !== null && sizeDistanceIn > tolerance * 2) {
    notes.push("Dimensions are not an exact match and may require compromise.");
  }

  if (typeof constraints.budgetMax === "number" && price === null) {
    notes.push("Price data is missing, so budget fit is less certain.");
  }

  const hasSignalMatch = signals.some((token) => token && rugText.includes(token));
  if (signals.length > 0 && !hasSignalMatch) {
    notes.push("May not fully align with your style or palette preferences.");
  }

  return notes.slice(0, 2);
}

function buildConfidence(
  rug: InventoryRug,
  constraints: HardConstraints,
  promptContext: RecommendationPromptContext | undefined,
  userMessage: string
): {
  score: number;
  tier: "high" | "medium" | "low";
  factors: string[];
} {
  const factors: string[] = [];
  let score = 0.5;
  const price = toPriceUsd(rug);
  const sizeDistanceIn = getSizeDistanceIn(rug, constraints);
  const signals = collectSoftSignals(promptContext, userMessage);
  const rugText = [
    toLower(rug.style),
    toLower(rug.palette),
    toLower(rug.pattern),
    toLower(rug.best_for),
    toLower(rug.public_description),
  ].join(" ");

  if (constraints.size && sizeDistanceIn !== null) {
    if (sizeDistanceIn <= 2) {
      score += 0.2;
      factors.push("Strong size alignment");
    } else if (sizeDistanceIn <= 6) {
      score += 0.12;
      factors.push("Acceptable size alignment");
    } else {
      score += 0.05;
      factors.push("Loose size alignment");
    }
  }

  if (typeof constraints.budgetMax === "number" && typeof price === "number") {
    score += 0.15;
    factors.push("Within budget");
  }

  const signalMatches = signals.filter((token) => token && rugText.includes(token)).length;
  if (signalMatches > 0) {
    score += Math.min(0.15, signalMatches * 0.05);
    factors.push("Matches stated preferences");
  }

  if (rug.public_description) {
    score += 0.05;
    factors.push("Good listing detail quality");
  } else {
    score -= 0.03;
  }

  const normalized = Number(clamp(score, CONFIDENCE_MIN, CONFIDENCE_MAX).toFixed(2));
  const tier: "high" | "medium" | "low" =
    normalized >= 0.78 ? "high" : normalized >= 0.6 ? "medium" : "low";

  return {
    score: normalized,
    tier,
    factors: factors.slice(0, 3),
  };
}

// PSEUDOCODE
// Deterministic local fallback used when AI is unavailable or invalid.
function fallbackRecommendations(
  inventory: InventoryRug[],
  constraints: HardConstraints,
  promptContext: RecommendationPromptContext | undefined,
  userMessage: string
): RecommendationResponse {
  // If OpenAI fails, we still return a usable response so the API never
  // breaks the frontend flow.
  const recommendations = inventory.slice(0, MAX_RECOMMENDATIONS).map((rug) => {
    const confidence = buildConfidence(rug, constraints, promptContext, userMessage);
    return {
      rug_id: rug.id,
      sku: rug.sku ?? null,
      title: rug.label,
      size_text: sizeText(rug),
      price_usd: toPriceUsd(rug),
      match_reasons: buildGroundedMatchReasons(
        rug,
        constraints,
        promptContext,
        userMessage
      ),
      confidence: confidence.score,
      confidence_tier: confidence.tier,
      confidence_factors: confidence.factors,
      why_not: buildWhyNot(rug, constraints, promptContext, userMessage),
    };
  });

  return {
    mode: "recommendations",
    assistant_message:
      "Based on what you’re looking for, here are a few rugs that could work well:",
    questions: [],
    recommendations,
    notes: "Fallback response (OpenAI unavailable or invalid).",
  };
}

// PSEUDOCODE
// Runtime guard for structured output contract.
function isRecommendationResponse(value: unknown): value is RecommendationResponse {
  // Manual runtime checks to ensure model output is truly usable.
  // TypeScript types alone do not validate runtime JSON.
  if (!value || typeof value !== "object") return false;
  const data = value as Record<string, unknown>;

  if (
    data.mode !== "recommendations" &&
    data.mode !== "clarifying_question" &&
    data.mode !== "no_match"
  ) {
    return false;
  }

  if (
    typeof data.assistant_message !== "string" ||
    normalizeText(data.assistant_message).length === 0 ||
    normalizeText(data.assistant_message).length > MAX_ASSISTANT_MESSAGE_CHARS
  ) {
    return false;
  }
  if (!Array.isArray(data.questions)) return false;
  if (data.questions.length > 2) return false;
  if (
    !data.questions.every(
      (q) =>
        typeof q === "string" &&
        normalizeText(q).length > 0 &&
        normalizeText(q).length <= MAX_QUESTION_CHARS
    )
  ) {
    return false;
  }
  if (!Array.isArray(data.recommendations)) return false;
  if (data.recommendations.length > MAX_RECOMMENDATIONS) return false;
  if (
    !data.recommendations.every((item) => {
      if (!item || typeof item !== "object") return false;
      const rec = item as Record<string, unknown>;
      const matchReasons = Array.isArray(rec.match_reasons)
        ? rec.match_reasons
        : null;
      const confidenceFactors = Array.isArray(rec.confidence_factors)
        ? rec.confidence_factors
        : null;
      const whyNot = Array.isArray(rec.why_not) ? rec.why_not : null;
      return (
        typeof rec.rug_id === "string" &&
        normalizeText(rec.rug_id).length > 0 &&
        normalizeText(rec.rug_id).length <= 80 &&
        ((typeof rec.sku === "string" && normalizeText(rec.sku).length <= 80) ||
          rec.sku === null) &&
        typeof rec.title === "string" &&
        normalizeText(rec.title).length > 0 &&
        normalizeText(rec.title).length <= MAX_TITLE_CHARS &&
        ((typeof rec.size_text === "string" &&
          normalizeText(rec.size_text).length <= MAX_SIZE_TEXT_CHARS) ||
          rec.size_text === null) &&
        (typeof rec.price_usd === "number" || rec.price_usd === null) &&
        matchReasons !== null &&
        matchReasons.length >= 1 &&
        matchReasons.length <= 3 &&
        matchReasons.every(
          (r) =>
            typeof r === "string" &&
            normalizeText(r).length > 0 &&
            normalizeText(r).length <= MAX_REASON_CHARS
        ) &&
        typeof rec.confidence === "number" &&
        (rec.confidence_tier === "high" ||
          rec.confidence_tier === "medium" ||
          rec.confidence_tier === "low") &&
        confidenceFactors !== null &&
        confidenceFactors.length <= 3 &&
        confidenceFactors.every(
          (r) =>
            typeof r === "string" &&
            normalizeText(r).length > 0 &&
            normalizeText(r).length <= MAX_FACTOR_CHARS
        ) &&
        whyNot !== null &&
        whyNot.length <= 2 &&
        whyNot.every(
          (r) =>
            typeof r === "string" &&
            normalizeText(r).length > 0 &&
            normalizeText(r).length <= MAX_CAVEAT_CHARS
        )
      );
    })
  ) {
    return false;
  }
  if (!(typeof data.notes === "string" || data.notes === null)) return false;
  if (typeof data.notes === "string" && normalizeText(data.notes).length > MAX_NOTES_CHARS) {
    return false;
  }

  return true;
}

// PSEUDOCODE
// Extract plain text JSON from Responses API payload variants.
function extractOutputText(payload: unknown): string | null {
  // Responses API payloads can vary by model/settings.
  // We check common locations for the generated text.
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const data = payload as Record<string, unknown>;
  if (typeof data.output_text === "string" && data.output_text.trim()) {
    return data.output_text;
  }

  if (!Array.isArray(data.output)) {
    return null;
  }

  for (const item of data.output) {
    if (!item || typeof item !== "object") continue;
    const message = item as Record<string, unknown>;
    if (!Array.isArray(message.content)) continue;

    for (const content of message.content) {
      if (!content || typeof content !== "object") continue;
      const part = content as Record<string, unknown>;
      if (typeof part.text === "string" && part.text.trim()) {
        return part.text;
      }
    }
  }

  return null;
}

// PSEUDOCODE
// Parse model output from either text JSON or direct JSON part.
function parseRecommendationResponse(payload: unknown): RecommendationResponse | null {
  const outputText = extractOutputText(payload);
  if (outputText) {
    try {
      // First try parsing plain text as JSON.
      const parsed = JSON.parse(outputText) as unknown;
      return isRecommendationResponse(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }

  if (!payload || typeof payload !== "object") {
    return null;
  }

  const data = payload as Record<string, unknown>;
  if (!Array.isArray(data.output)) {
    return null;
  }

  for (const item of data.output) {
    if (!item || typeof item !== "object") continue;
    const message = item as Record<string, unknown>;
    if (!Array.isArray(message.content)) continue;

    for (const content of message.content) {
      if (!content || typeof content !== "object") continue;
      const part = content as Record<string, unknown>;
      // Some payloads may include structured JSON directly.
      if (part.json && isRecommendationResponse(part.json)) {
        return part.json;
      }
    }
  }

  return null;
}

// PSEUDOCODE
// Enforce backend trust boundary:
// - keep only recommendations that reference candidate IDs
// - clamp output counts
// - repair invalid no_match from model when candidates exist
function sanitizeResponse(
  response: RecommendationResponse,
  inventory: InventoryRug[],
  constraints: HardConstraints,
  promptContext: RecommendationPromptContext | undefined,
  userMessage: string
): RecommendationResponse {
  // Only keep rugs that definitely came from backend candidates.
  // This blocks hallucinated IDs from passing through.
  const allowedIds = new Set(inventory.map((rug) => rug.id));
  const inventoryById = new Map(inventory.map((rug) => [rug.id, rug]));
  const recommendations = response.recommendations
    .filter((rec) => allowedIds.has(rec.rug_id))
    .slice(0, MAX_RECOMMENDATIONS)
    .map((rec) => {
      const rug = inventoryById.get(rec.rug_id);
      if (!rug) return rec;

      const confidence = buildConfidence(rug, constraints, promptContext, userMessage);
      return {
        ...rec,
        sku: rug.sku ?? null,
        title: rug.label,
        size_text: sizeText(rug),
        price_usd: toPriceUsd(rug),
        match_reasons: buildGroundedMatchReasons(
          rug,
          constraints,
          promptContext,
          userMessage
        ),
        confidence: confidence.score,
        confidence_tier: confidence.tier,
        confidence_factors: confidence.factors,
        why_not: buildWhyNot(rug, constraints, promptContext, userMessage),
      };
    });

  const cappedQuestions = response.questions.slice(0, 2);

  if (response.mode === "no_match" && inventory.length > 0) {
    return applyTonePolish({
      ...fallbackRecommendations(inventory, constraints, promptContext, userMessage),
      notes: "Adjusted invalid no_match from model output.",
    });
  }

  if (response.mode === "recommendations" && recommendations.length === 0) {
    return applyTonePolish(
      fallbackRecommendations(inventory, constraints, promptContext, userMessage)
    );
  }

  // Enforce mode-specific response contract for consistency with docs/schema intent.
  if (response.mode === "clarifying_question") {
    const normalizedQuestions = cappedQuestions.filter((q) => q.trim().length > 0);
    if (normalizedQuestions.length === 0) {
      return applyTonePolish(
        fallbackRecommendations(inventory, constraints, promptContext, userMessage)
      );
    }
    return applyTonePolish({
      ...response,
      questions: normalizedQuestions.slice(0, 2),
      recommendations: [],
    });
  }

  if (response.mode === "no_match") {
    return applyTonePolish({
      ...response,
      questions: cappedQuestions.slice(0, 1),
      recommendations: [],
    });
  }

  return applyTonePolish({
    ...response,
    questions: [],
    recommendations,
  });
}

export async function rankAndExplain(
  inventory: InventoryRug[],
  constraints: HardConstraints,
  userMessage: string,
  promptContext?: RecommendationPromptContext,
  trace?: RecommendationAiTrace
): Promise<RecommendationResponse> {
  // PSEUDOCODE
  // A) Early return for true no-match candidate set.
  // B) Verify OpenAI key.
  // C) Build prompt inputs from user request + hard constraints + candidate inventory.
  // D) Request strict JSON schema output from model.
  // E) Parse/validate/sanitize, else return deterministic fallback.
  if (inventory.length === 0) {
    if (trace) {
      trace.called = false;
      trace.model = OPENAI_MODEL;
      trace.prompt_layers = [];
      trace.request_payload = null;
      trace.response_status = null;
      trace.response_payload = null;
      trace.parsed_response = null;
      trace.fallback_reason = null;
      trace.error = null;
      trace.incomplete_detected = false;
      trace.retry_attempted = false;
      trace.retry_succeeded = false;
      trace.text_postprocess_applied = false;
    }
    // No candidates after hard filtering = real no-match.
    const constrainedSearch = hasOptionalHardConstraints(constraints);
    return applyTonePolish({
      mode: "no_match",
      assistant_message: constrainedSearch
        ? "Based on current inventory, nothing fits those constraints. Try widening size, budget, or style filters and I can suggest alternatives."
        : "I do not see any available rugs in the current inventory list.",
      questions: constrainedSearch
        ? ["Would you like to adjust size or budget?"]
        : [],
      recommendations: [],
      notes: null,
    });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    if (trace) {
      trace.called = false;
      trace.model = OPENAI_MODEL;
      trace.prompt_layers = [];
      trace.request_payload = null;
      trace.response_status = null;
      trace.response_payload = null;
      trace.parsed_response = null;
      trace.fallback_reason = "Missing OPENAI_API_KEY";
      trace.error = null;
      trace.incomplete_detected = false;
      trace.retry_attempted = false;
      trace.retry_succeeded = false;
      trace.text_postprocess_applied = false;
    }
    // Missing key should not crash the endpoint.
    return applyTonePolish({
      ...fallbackRecommendations(inventory, constraints, promptContext, userMessage),
      notes: "Missing OPENAI_API_KEY. Returned local fallback.",
    });
  }

  const contextInventory = toContextInventory(inventory);
  const promptBundle = getRecommendationPromptBundle();
  const hasTradePreferences = Boolean(
    promptContext?.trade_preferences &&
      Object.keys(promptContext.trade_preferences).length > 0
  );

  // If no user message was provided, build a plain fallback request sentence.
  const requestText =
    userMessage.trim().length > 0
      ? userMessage.trim()
      : buildFallbackRequestText(constraints);

  const promptSections = buildRecommendationPromptSections({
    role: promptContext?.role ?? "retail_customer",
    hasTradePreferences,
    hasProjectContext: Boolean(promptContext?.project_context),
    hasChatMemoryContext: Boolean(promptContext?.chat_context),
    hasRecentTurnsContext:
      Array.isArray(promptContext?.chat_context?.recent_turns) &&
      (promptContext?.chat_context?.recent_turns?.length ?? 0) > 0,
    prompts: {
      system: promptBundle.system,
      recommendation: promptBundle.recommendation,
      structuredOutput: promptBundle.recommendationStructuredOutput,
      tradeSupport: promptBundle.tradeSupport,
    },
    tradePreferences: promptContext?.trade_preferences,
    chatContext: promptContext?.chat_context,
    inventoryContext: contextInventory,
    userMessage: requestText,
    constraints,
    projectContext: promptContext?.project_context ?? null,
  });

  const requestInput = groupPromptSectionsByRole(promptSections);

  const requestPayload = {
    model: OPENAI_MODEL,
    input: requestInput,
    max_output_tokens: getMaxOutputTokens("recommendation"),
    text: {
      format: {
        // Enforce strict schema so frontend response parsing is predictable.
        type: "json_schema",
        name: "recommendation_response",
        schema: RECOMMENDATION_SCHEMA,
        strict: true,
      },
    },
  };

  if (trace) {
    trace.called = true;
    trace.model = OPENAI_MODEL;
    trace.prompt_layers = promptSections.map((section) => ({
      id: section.id,
      role: section.role,
      chars: section.text.length,
      preview: sectionPreview(section.text),
    }));
    trace.request_payload = requestPayload;
    trace.response_status = null;
    trace.response_payload = null;
    trace.parsed_response = null;
    trace.fallback_reason = null;
    trace.error = null;
    trace.incomplete_detected = false;
    trace.retry_attempted = false;
    trace.retry_succeeded = false;
    trace.text_postprocess_applied = false;
  }

  const firstAttempt = await postOpenAiResponses({
    url: OPENAI_RESPONSES_URL,
    apiKey,
    requestPayload,
  });

  if (trace) {
    trace.response_status = firstAttempt.response_status;
    trace.response_payload = firstAttempt.response_payload;
    trace.incomplete_detected = firstAttempt.incomplete_detected;
  }

  if (!firstAttempt.ok) {
    if (trace) {
      trace.parsed_response = null;
      trace.fallback_reason = "OpenAI request failed";
      trace.error = firstAttempt.error;
    }
    // Network/API failure -> deterministic fallback, not a hard API error.
    return applyTonePolish({
      ...fallbackRecommendations(inventory, constraints, promptContext, userMessage),
      notes: "OpenAI request failed. Returned local fallback.",
    });
  }

  let parsed = parseRecommendationResponse(firstAttempt.response_payload);
  const shouldRetry = shouldRetryAfterAttempt({
    attempt: firstAttempt,
    parseSucceeded: Boolean(parsed),
    alreadyRetried: false,
  });

  if (shouldRetry) {
    if (trace) {
      trace.retry_attempted = true;
    }

    const retryPayload = withRetryInstruction(
      requestPayload,
      RETRY_SYSTEM_INSTRUCTION
    );
    const retryAttempt = await postOpenAiResponses({
      url: OPENAI_RESPONSES_URL,
      apiKey,
      requestPayload: retryPayload,
    });

    if (trace) {
      trace.response_status = retryAttempt.response_status;
      trace.response_payload = retryAttempt.response_payload;
      trace.incomplete_detected =
        firstAttempt.incomplete_detected || retryAttempt.incomplete_detected;
    }

    if (retryAttempt.ok) {
      parsed = parseRecommendationResponse(retryAttempt.response_payload);
      if (trace) {
        trace.retry_succeeded = Boolean(parsed);
      }
    }
  }

  if (!parsed) {
    if (trace) {
      trace.parsed_response = null;
      trace.fallback_reason = "OpenAI response parsing failed";
      trace.error = "OpenAI response parsing failed";
    }
    // Parsing/shape failure -> deterministic fallback.
    return applyTonePolish({
      ...fallbackRecommendations(inventory, constraints, promptContext, userMessage),
      notes: "OpenAI response parsing failed. Returned local fallback.",
    });
  }

  // Final safety pass before returning to API route.
  const sanitized = sanitizeResponse(
    parsed,
    inventory,
    constraints,
    promptContext,
    userMessage
  );
  if (trace) {
    trace.parsed_response = sanitized;
    trace.fallback_reason = null;
    trace.error = null;
  }
  return sanitized;
}
