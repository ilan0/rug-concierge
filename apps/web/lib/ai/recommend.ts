import type { HardConstraints, InventoryRug } from "@/lib/types/recommendation";

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
};

export type RecommendationAiTrace = {
  called: boolean;
  model: string;
  request_payload: unknown | null;
  response_status: number | null;
  response_payload: unknown | null;
  parsed_response: RecommendationResponse | null;
  fallback_reason: string | null;
  error: string | null;
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
    assistant_message: { type: "string" },
    questions: {
      type: "array",
      items: { type: "string" },
    },
    recommendations: {
      type: "array",
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
          rug_id: { type: "string" },
          sku: { type: ["string", "null"] },
          title: { type: "string" },
          size_text: { type: ["string", "null"] },
          price_usd: { type: ["number", "null"] },
          match_reasons: { type: "array", items: { type: "string" } },
          confidence: { type: "number" },
          confidence_tier: { type: "string", enum: ["high", "medium", "low"] },
          confidence_factors: { type: "array", items: { type: "string" } },
          why_not: { type: "array", items: { type: "string" } },
        },
      },
    },
    notes: { type: ["string", "null"] },
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

  if (typeof data.assistant_message !== "string") return false;
  if (!Array.isArray(data.questions)) return false;
  if (!data.questions.every((q) => typeof q === "string")) return false;
  if (!Array.isArray(data.recommendations)) return false;
  if (
    !data.recommendations.every((item) => {
      if (!item || typeof item !== "object") return false;
      const rec = item as Record<string, unknown>;
      return (
        typeof rec.rug_id === "string" &&
        (typeof rec.sku === "string" || rec.sku === null) &&
        typeof rec.title === "string" &&
        (typeof rec.size_text === "string" || rec.size_text === null) &&
        (typeof rec.price_usd === "number" || rec.price_usd === null) &&
        Array.isArray(rec.match_reasons) &&
        rec.match_reasons.every((r) => typeof r === "string") &&
        typeof rec.confidence === "number" &&
        (rec.confidence_tier === "high" ||
          rec.confidence_tier === "medium" ||
          rec.confidence_tier === "low") &&
        Array.isArray(rec.confidence_factors) &&
        rec.confidence_factors.every((r) => typeof r === "string") &&
        Array.isArray(rec.why_not) &&
        rec.why_not.every((r) => typeof r === "string")
      );
    })
  ) {
    return false;
  }
  if (!(typeof data.notes === "string" || data.notes === null)) return false;

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

  if (response.mode === "no_match" && inventory.length > 0) {
    return {
      ...fallbackRecommendations(inventory, constraints, promptContext, userMessage),
      notes: "Adjusted invalid no_match from model output.",
    };
  }

  if (response.mode === "recommendations" && recommendations.length === 0) {
    return fallbackRecommendations(inventory, constraints, promptContext, userMessage);
  }

  return {
    ...response,
    questions: response.questions.slice(0, 2),
    recommendations,
  };
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
      trace.request_payload = null;
      trace.response_status = null;
      trace.response_payload = null;
      trace.parsed_response = null;
      trace.fallback_reason = null;
      trace.error = null;
    }
    // No candidates after hard filtering = real no-match.
    const constrainedSearch = hasOptionalHardConstraints(constraints);
    return {
      mode: "no_match",
      assistant_message: constrainedSearch
        ? "Based on current inventory, nothing fits those constraints."
        : "I do not see any available rugs in the current inventory list.",
      questions: constrainedSearch
        ? ["Would you like to adjust size or budget?"]
        : [],
      recommendations: [],
      notes: null,
    };
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    if (trace) {
      trace.called = false;
      trace.model = OPENAI_MODEL;
      trace.request_payload = null;
      trace.response_status = null;
      trace.response_payload = null;
      trace.parsed_response = null;
      trace.fallback_reason = "Missing OPENAI_API_KEY";
      trace.error = null;
    }
    // Missing key should not crash the endpoint.
    return {
      ...fallbackRecommendations(inventory, constraints, promptContext, userMessage),
      notes: "Missing OPENAI_API_KEY. Returned local fallback.",
    };
  }

  const contextInventory = toContextInventory(inventory);
  const sparseConstraints = !hasOptionalHardConstraints(constraints);
  const hasTradePreferences =
    promptContext?.trade_preferences &&
    Object.keys(promptContext.trade_preferences).length > 0;

  // If no user message was provided, build a plain fallback request sentence.
  const requestText =
    userMessage.trim().length > 0
      ? userMessage.trim()
      : buildFallbackRequestText(constraints);

  const requestPayload = {
    model: OPENAI_MODEL,
    // Message order:
    // 1) system behavior guardrails
    // 2) authoritative inventory context
    // 3) user intent + hard constraints
    input: [
      {
        role: "system",
        content: [
          {
            type: "input_text",
            text: "You are a rug concierge assistant. Recommend only from provided inventory. Do not invent facts.",
          },
          {
            type: "input_text",
            text: sparseConstraints
              ? "If constraints are sparse or open-ended, prioritize variety across style, palette, and price points."
              : "Prioritize closest matches to the stated constraints and preferences.",
          },
          {
            type: "input_text",
            text:
              promptContext?.role === "trade_client"
                ? "This is a trade/designer workflow. Be concise, practical, and optimize for repeat-buyer efficiency."
                : "This is a general concierge workflow.",
          },
        ],
      },
      ...(hasTradePreferences
        ? [
            {
              role: "system" as const,
              content: [
                {
                  type: "input_text" as const,
                  text: `TRADE PREFERENCES (soft signals only):\n${JSON.stringify(
                    promptContext?.trade_preferences,
                    null,
                    2
                  )}`,
                },
              ],
            },
          ]
        : []),
      {
        role: "system",
        content: [
          {
            type: "input_text",
            text: `AVAILABLE INVENTORY (authoritative):\n${JSON.stringify(contextInventory, null, 2)}`,
          },
        ],
      },
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: `User request:\n${requestText}\n\nHard constraints:\n${JSON.stringify(
              constraints
            )}\n\nProject context:\n${JSON.stringify(
              promptContext?.project_context ?? null
            )}`,
          },
        ],
      },
    ],
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
    trace.request_payload = requestPayload;
    trace.response_status = null;
    trace.response_payload = null;
    trace.parsed_response = null;
    trace.fallback_reason = null;
    trace.error = null;
  }

  const response = await fetch(OPENAI_RESPONSES_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(requestPayload),
  }).catch(() => null);

  if (!response || !response.ok) {
    if (trace) {
      trace.response_status = response ? response.status : null;
      trace.response_payload = null;
      trace.parsed_response = null;
      trace.fallback_reason = "OpenAI request failed";
      trace.error = response
        ? `OpenAI request failed with status ${response.status}`
        : "OpenAI request failed: network error";
    }
    // Network/API failure -> deterministic fallback, not a hard API error.
    return {
      ...fallbackRecommendations(inventory, constraints, promptContext, userMessage),
      notes: "OpenAI request failed. Returned local fallback.",
    };
  }

  const payload = (await response.json().catch(() => null)) as unknown;
  if (trace) {
    trace.response_status = response.status;
    trace.response_payload = payload;
  }
  const parsed = parseRecommendationResponse(payload);
  if (!parsed) {
    if (trace) {
      trace.parsed_response = null;
      trace.fallback_reason = "OpenAI response parsing failed";
      trace.error = "OpenAI response parsing failed";
    }
    // Parsing/shape failure -> deterministic fallback.
    return {
      ...fallbackRecommendations(inventory, constraints, promptContext, userMessage),
      notes: "OpenAI response parsing failed. Returned local fallback.",
    };
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
