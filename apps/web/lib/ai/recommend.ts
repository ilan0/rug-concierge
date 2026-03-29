import type { HardConstraints, InventoryRug } from "@/lib/types/recommendation";
import { resolveEffectiveFields } from "@/lib/inventory/resolve-fields";
import { getRecommendationPromptBundle } from "@/lib/ai/prompt-library";
import {
  endsWithSentenceBoundary,
  getMaxOutputTokens,
  normalizeText,
  postOpenAiResponses,
  shouldRetryAfterAttempt,
  toPreviewText,
  withRetryInstruction,
} from "@/lib/ai/response-quality";
import { detectResponseLanguage } from "@/lib/ai/language";
import type { PromptLayerId } from "@/lib/prompts/layer-ids";
import {
  buildRecommendationPromptSections,
  groupPromptSectionsByRole,
} from "@/lib/prompts/recommendation-stack";
import {
  OPENAI_API_KEY,
  OPENAI_CHAT_MODEL,
} from "@/lib/config";

// Flow overview
// 1) If candidate inventory is empty -> return no_match.
// 2) Build an authoritative inventory context payload from backend candidates.
// 3) Call OpenAI Responses API with strict JSON schema output.
// 4) Parse and validate model output shape.
// 5) Enforce backend safety (IDs must be subset of candidate set; trim to top 10).
// 6) If any API/parse/validation failure occurs -> return deterministic fallback.

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const MAX_RECOMMENDATIONS = 10;
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
  role?: "retail_customer" | "store_staff";
  discovery_mode?: boolean;
  constraint_mismatch?: {
    expanded_from_zero_match: boolean;
    unmet_constraints: string[];
    disclosure_hint: string | null;
  };
  expanded_due_to_thin_results?: boolean;
  chat_context?: {
    structured_state?: unknown;
    conversation_memory?: unknown;
    customer_context?: string[];
    recently_shown_rugs?: Array<{
      id: string;
      label: string;
      colors: string[];
      style: string | null;
      origin: string | null;
    }>;
    liked_attributes?: {
      colors: string[];
      styles: string[];
      origins: string[];
    };
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
  mode: "recommendations" | "clarifying_question" | "no_match" | "disambiguation";
  assistant_message: string;
  questions: string[];
  recommendations: {
    rug_id: string;
    sku: string | null;
    title: string;
    origin: string | null;
    style: string | null;
    mood: string | null;
    primary_image_url: string | null;
    primary_image_caption: string | null;
    size_text: string | null;
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
      enum: ["recommendations", "clarifying_question", "no_match", "disambiguation"],
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
          "origin",
          "style",
          "mood",
          "size_text",
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
          origin: { type: ["string", "null"], maxLength: 60 },
          style: { type: ["string", "null"], maxLength: 80 },
          mood: { type: ["string", "null"], maxLength: 32 },
          size_text: { type: ["string", "null"], maxLength: MAX_SIZE_TEXT_CHARS },
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
  return Boolean(
    constraints.size ||
      (constraints.colors && constraints.colors.length > 0) ||
      (constraints.styles && constraints.styles.length > 0) ||
      constraints.shape
  );
}

function buildFallbackRequestText(constraints: HardConstraints): string {
  const pieces: string[] = [];
  if (constraints.size) {
    pieces.push(`size ${formatSizePair(constraints.size.widthIn, constraints.size.lengthIn)}`);
  }
  if (constraints.colors && constraints.colors.length > 0) {
    pieces.push(`colors ${constraints.colors.join(", ")}`);
  }
  if (constraints.styles && constraints.styles.length > 0) {
    pieces.push(`styles ${constraints.styles.join(", ")}`);
  }
  if (constraints.shape) {
    pieces.push(
      constraints.shape === "round_oval" ? "shape round/oval" : `shape ${constraints.shape}`
    );
  }

  if (pieces.length > 0) {
    return `Find the best matches for ${pieces.join(" + ")}.`;
  }
  return "Show a varied set of available rugs from inventory.";
}

function formatFeetAndInches(totalIn: number): string {
  const feet = Math.floor(totalIn / 12);
  const inches = totalIn % 12;
  if (inches === 0) return `${feet}'`;
  return `${feet}'${inches}"`;
}

function formatSizePair(widthIn: number, lengthIn: number): string {
  return `${formatFeetAndInches(widthIn)} x ${formatFeetAndInches(lengthIn)}`;
}

function sizeText(rug: InventoryRug): string | null {
  const w = rug.width_total_in;
  const l = rug.length_total_in;

  if (typeof w !== "number" || typeof l !== "number") {
    return null;
  }

  return `${formatFeetAndInches(w)} x ${formatFeetAndInches(l)}`;
}

function effectiveFields(rug: InventoryRug) {
  return (
    rug.effective_fields ??
    resolveEffectiveFields(
      rug.intake_label ?? null,
      rug.ai_structured_fields ?? null,
      rug.staff_overrides ?? null,
      rug.ai_description ?? null
    )
  );
}

function rugLabel(rug: InventoryRug): string {
  const label = effectiveFields(rug).label?.trim();
  if (label) return label;
  return sizeText(rug) ?? "Untitled";
}

function toContextInventory(inventory: InventoryRug[]) {
  return inventory.map((rug) => {
    const fields = effectiveFields(rug);

    return {
      id: rug.id,
      label: rugLabel(rug),
      size: sizeText(rug) ?? null,
      origin: fields.origin ?? null,
      style: fields.style ?? null,
      mood: fields.mood ?? null,
      pattern: Array.isArray(fields.pattern) ? fields.pattern.slice(0, 4) : [],
      colors: Array.isArray(fields.primary_colors)
        ? fields.primary_colors.slice(0, 5)
        : [],
      desc:
        rug.ai_description && rug.ai_description.trim().length > 0
          ? rug.ai_description
          : "New arrival — description pending",
    };
  });
}

function toImageUrl(rug: InventoryRug): string | null {
  return typeof rug.primary_image_url === "string" &&
    rug.primary_image_url.trim().length > 0
    ? rug.primary_image_url
    : null;
}

function toImageCaption(): string | null {
  return null;
}

function toLower(value: string | null | undefined): string {
  return (value ?? "").toLowerCase();
}

function structuredSignalText(rug: InventoryRug): string {
  const fields = effectiveFields(rug);
  const tokens = [
    fields.origin,
    fields.style,
    fields.mood,
    ...(fields.pattern ?? []),
    ...(fields.primary_colors ?? []),
  ]
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.toLowerCase());

  return tokens.join(" ");
}

function collectSoftSignals(
  userMessage: string
): string[] {
  const signals: string[] = [];
  const text = userMessage.toLowerCase();
  const knownTokens = [
    "persian",
    "afghan",
    "turkish",
    "indian",
    "caucasian",
    "pakistani",
    "neutral",
    "traditional",
    "transitional",
    "eclectic",
    "modern",
    "vintage",
    "kitchen",
    "living room",
    "bedroom",
    "dining",
    "runner",
    "geometric",
    "medallion",
    "tribal",
    "floral",
    "pets",
    "kids",
    "purple",
    "navy",
    "ivory",
    "blue",
    "green",
    "red",
  ];

  for (const token of knownTokens) {
    if (text.includes(token)) signals.push(token);
  }

  return [...new Set(signals)];
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function sectionPreview(value: string): string {
  return toPreviewText(value.replace(/\s+/g, " "), 120);
}

function toPlainText(value: string): string {
  return normalizeText(
    value
      .replace(/\*\*/g, "")
      .replace(/[_`#]/g, "")
      .replace(/^\s*[-*•]+\s*/gm, "")
  );
}

function clampAssistantMessage(message: string): string {
  const plain = toPlainText(message);
  if (plain.length <= MAX_ASSISTANT_MESSAGE_CHARS) {
    return plain;
  }

  const truncated = plain.slice(0, MAX_ASSISTANT_MESSAGE_CHARS).trim();
  const preferredBoundary = truncated.match(/[\.\!\?](?!.*[\.\!\?])/);
  if (preferredBoundary && preferredBoundary.index !== undefined) {
    const boundaryIndex = preferredBoundary.index + preferredBoundary[0].length;
    if (boundaryIndex >= Math.floor(MAX_ASSISTANT_MESSAGE_CHARS * 0.55)) {
      return truncated.slice(0, boundaryIndex).trim();
    }
  }

  const lastSpace = truncated.lastIndexOf(" ");
  if (lastSpace > Math.floor(MAX_ASSISTANT_MESSAGE_CHARS * 0.45)) {
    return `${truncated.slice(0, lastSpace).trim()}...`;
  }

  return `${truncated.slice(0, MAX_ASSISTANT_MESSAGE_CHARS - 3).trim()}...`;
}

const GENERIC_RECOMMENDATION_LEAD_PATTERNS: RegExp[] = [
  /^based on what you're looking for(?:[:,\-]\s*|\s*$)/i,
  /^you asked for specific guidance(?:[:,\-]\s*|\s*$)/i,
  /^here is a diverse sample from (?:our current )?collection(?:[:,\-]\s*|\s*$)/i,
  /^from your request(?:[:,\-]\s*|\s*$)/i,
  /^for your target around .+(?:[:,\-]\s*|\s*$)/i,
  /^(here is|here are) (?:a )?varied set of options to compare(?:[:,\-]\s*|\s*$)/i,
  /^for around .+closest available fits in stock(?:[:,\-]\s*|\s*$)/i,
  /^here are the options with the strongest .+ presence(?:[:,\-]\s*|\s*$)/i,
];

function hasGenericRecommendationLeadIn(message: string): boolean {
  const normalized = toPlainText(message).trim();
  return GENERIC_RECOMMENDATION_LEAD_PATTERNS.some((pattern) =>
    pattern.test(normalized)
  );
}

function stripGenericRecommendationLeadIn(message: string): string {
  let normalized = toPlainText(message).trim();
  let changed = true;
  while (changed && normalized.length > 0) {
    changed = false;
    for (const pattern of GENERIC_RECOMMENDATION_LEAD_PATTERNS) {
      if (!pattern.test(normalized)) continue;
      normalized = normalized.replace(pattern, "").trim();
      changed = true;
      break;
    }
  }
  return normalized;
}

function uniqueCompactList(items: string[], maxItems: number): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const item of items) {
    const normalized = toPlainText(item);
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
    const cleanedAssistant = stripGenericRecommendationLeadIn(response.assistant_message);
    return {
      ...response,
      assistant_message: clampAssistantMessage(
        cleanedAssistant || toPlainText(response.assistant_message)
      ),
      questions: uniqueCompactList(response.questions, 2),
    };
  }

  if (response.mode === "no_match") {
    const noMatchMessage = toPlainText(response.assistant_message);
    const withGuidance = /\b(adjust|widen|broaden|change|try|refine|relax)\b/i.test(noMatchMessage)
      ? noMatchMessage
      : `${noMatchMessage} Try relaxing one constraint and I can suggest alternatives.`;
    return {
      ...response,
      assistant_message: clampAssistantMessage(withGuidance),
      questions: uniqueCompactList(response.questions, 1),
    };
  }

  if (response.mode === "disambiguation") {
    const cleanedAssistant = stripGenericRecommendationLeadIn(response.assistant_message);
    return {
      ...response,
      assistant_message: clampAssistantMessage(
        cleanedAssistant || toPlainText(response.assistant_message)
      ),
      questions: [],
      recommendations: response.recommendations.slice(0, 3),
    };
  }

  const cleanedAssistant = stripGenericRecommendationLeadIn(response.assistant_message);
  return {
    ...response,
    assistant_message: clampAssistantMessage(
      cleanedAssistant || toPlainText(response.assistant_message)
    ),
    questions: [],
    recommendations: response.recommendations.map((rec) => ({
      ...rec,
      match_reasons: uniqueCompactList(rec.match_reasons, 3),
      confidence_factors: uniqueCompactList(rec.confidence_factors, 3),
      why_not: uniqueCompactList(rec.why_not, 2),
    })),
  };
}

function enforceRequestAnchoredOpening(input: {
  response: RecommendationResponse;
  constraints: HardConstraints;
  userMessage: string;
}): RecommendationResponse {
  if (input.response.mode !== "recommendations") {
    return input.response;
  }
  const assistant = toPlainText(input.response.assistant_message);
  const genericLeadIn = hasGenericRecommendationLeadIn(assistant);
  if (!genericLeadIn) {
    return input.response;
  }

  const stripped = stripGenericRecommendationLeadIn(assistant);
  const stillGenericAfterStrip =
    /^(here (is|are)|these are|for around|for a|for your)\b/i.test(stripped);
  const rewritten =
    stripped.length > 0 && !stillGenericAfterStrip
      ? stripped
      : `${buildFallbackLeadIn(input.constraints, input.userMessage)} ${stripped}`.trim();
  return {
    ...input.response,
    assistant_message: clampAssistantMessage(rewritten.trim()),
  };
}

function enforceDiscoveryQuestion(
  response: RecommendationResponse,
  discoveryMode: boolean,
  customerContext?: string[],
  userMessage?: string,
  constraints?: HardConstraints
): RecommendationResponse {
  const enforceRecommendationInvitation = (
    value: RecommendationResponse
  ): RecommendationResponse => {
    if (!userMessage || discoveryMode || value.mode !== "recommendations") {
      return value;
    }
    const assistant = toPlainText(value.assistant_message);
    if (assistant.includes("?")) return value;
    if (
      /\b(would you like|want me to|if you'd like|if you want|should i show)\b/i.test(
        assistant
      )
    ) {
      return value;
    }
    const normalizedMessage = normalizeText(userMessage);
    const language = detectResponseLanguage(userMessage);
    const practicalSignal =
      /\b(kid|kids|child|children|dog|dogs|pet|pets|high traffic|durable|easy to clean|low maintenance|beach house)\b/i.test(
        normalizedMessage
      );
    const question =
      language === "es"
        ? practicalSignal
          ? "Si quieres, priorizo facilidad de mantenimiento o un look mas llamativo?"
          : "Si quieres, te muestro mas opciones en esta misma direccion o ajustamos color y tamano?"
        : practicalSignal
          ? "If you'd like, should I prioritize easiest-care options next, or a bolder look?"
          : "If you'd like, should I show more in this same direction, or adjust color and size next?";
    return {
      ...value,
      assistant_message: clampAssistantMessage(`${assistant} ${question}`.trim()),
    };
  };

  const ensureSingleQuestion = (text: string): string => {
    const normalized = toPlainText(text).replace(/\s+/g, " ").trim();
    const firstQuestionIndex = normalized.indexOf("?");
    if (firstQuestionIndex < 0) return normalized;
    const leading = normalized.slice(0, firstQuestionIndex + 1).trim();
    const beforeQuestion = leading.slice(0, -1).replace(/\?/g, "").trim();
    return `${beforeQuestion}?`;
  };

  const finalize = (next: RecommendationResponse): RecommendationResponse => {
    if (!userMessage || !constraints) {
      return {
        ...next,
        assistant_message: clampAssistantMessage(next.assistant_message),
      };
    }
    return enforceResponseLanguage(next, userMessage, constraints);
  };

  const anchoredResponse =
    constraints && userMessage
      ? enforceRequestAnchoredOpening({
          response,
          constraints,
          userMessage,
        })
      : response;

  const implicitDiscoveryPrompt = Boolean(
    userMessage &&
      /\b(show me what you have|show me what you've got|show me a range|surprise me|just browsing|just looking|open to anything|explore|broad spread)\b/i.test(
        normalizeText(userMessage)
      )
  );

  if (
    (!discoveryMode && !implicitDiscoveryPrompt) ||
    anchoredResponse.mode !== "recommendations"
  ) {
    const invitedResponse = enforceRecommendationInvitation(anchoredResponse);
    return finalize({
      ...invitedResponse,
      assistant_message: clampAssistantMessage(invitedResponse.assistant_message),
    });
  }

  const assistant = toPlainText(anchoredResponse.assistant_message);
  const language = detectResponseLanguage(assistant);
  const normalizedUserMessage = normalizeText(userMessage ?? "");
  const hasKnownRoom = Array.isArray(customerContext)
    ? customerContext.some((fact) =>
        /\b(room|living room|dining room|bedroom|hallway|entryway|office|sala|comedor|dormitorio|pasillo)\b/i.test(
          fact
        )
      )
    : false;
  const hasRoomSignalInMessage =
    /\b(room|living room|dining room|bedroom|hallway|entryway|office|sala|comedor|dormitorio|pasillo)\b/i.test(
      normalizedUserMessage
    );
  const hasPracticalSignalInMessage =
    /\b(kid|kids|child|children|dog|dogs|pet|pets|high traffic|durable|easy to clean|beach house)\b/i.test(
      normalizedUserMessage
    );
  const discoveryQuestion =
    language === "es"
      ? hasKnownRoom || hasRoomSignalInMessage
        ? "Prefieres que te muestre opciones mas tradicionales o mas modernas para ese espacio?"
        : hasPracticalSignalInMessage
          ? "Prefieres que priorice facilidad de limpieza o un look mas llamativo?"
        : "Que tipo de espacio estas decorando para afinar mejor estas opciones?"
      : hasKnownRoom || hasRoomSignalInMessage
        ? "Do you want me to lean more traditional or more modern for that space?"
        : hasPracticalSignalInMessage
          ? "Do you want me to prioritize easiest-care options or a bolder visual look?"
        : "What kind of space are you decorating so I can narrow these down for you?";

  const withGuaranteedDiscoveryQuestion = (baseText: string): string => {
    const normalizedBase = toPlainText(baseText).replace(/\s+/g, " ").trim();
    const trimmedBase =
      normalizedBase.length > 280
        ? normalizedBase.slice(0, 280).trim()
        : normalizedBase;
    const combined = `${trimmedBase} ${discoveryQuestion}`.trim();
    let clamped = clampAssistantMessage(combined);
    if (clamped.includes("?")) return clamped;
    clamped = clampAssistantMessage(
      `${trimmedBase.slice(0, 220).trim()} ${discoveryQuestion}`.trim()
    );
    if (clamped.includes("?")) return clamped;
    return `${clamped.replace(/[.!]\s*$/, "").trim()}?`;
  };

  if (assistant.includes("?")) {
    const singleQuestion = ensureSingleQuestion(assistant);
    const clamped = clampAssistantMessage(singleQuestion);
    return finalize({
      ...anchoredResponse,
      assistant_message: clamped.includes("?")
        ? clamped
        : withGuaranteedDiscoveryQuestion(singleQuestion),
    });
  }

  console.warn("[recommendation] discovery response missing follow-up question", {
    mode: anchoredResponse.mode,
    assistant_preview: sectionPreview(assistant),
  });
  return finalize({
    ...anchoredResponse,
    assistant_message: withGuaranteedDiscoveryQuestion(assistant),
  });
}

function hasSpanishSignal(text: string): boolean {
  return /[¿¡]|[áéíóúñ]|\b(puedo|mostrar|coleccion|colección|opciones|si|quieres|alfombra|estilo|aqui|aquí|buscas|para)\b/i.test(
    text
  );
}

function hasSpanishComplianceSignal(text: string): boolean {
  return /\b(puedo|mostrar|colecci[oó]n|opciones|si|quieres|alfombra|estilo)\b/i.test(
    text
  );
}

function enforceResponseLanguage(
  response: RecommendationResponse,
  userMessage: string,
  constraints: HardConstraints
): RecommendationResponse {
  if (detectResponseLanguage(userMessage) !== "es") {
    return {
      ...response,
      assistant_message: clampAssistantMessage(response.assistant_message),
    };
  }

  const assistant = toPlainText(response.assistant_message);
  if (hasSpanishComplianceSignal(assistant)) {
    return {
      ...response,
      assistant_message: clampAssistantMessage(assistant),
    };
  }

  if (hasSpanishSignal(assistant)) {
    const spanishBridge = "Si quieres, puedo mostrar opciones de la colección.";
    return {
      ...response,
      assistant_message: clampAssistantMessage(`${spanishBridge} ${assistant}`.trim()),
    };
  }

  const spanishLeadIn =
    response.mode === "recommendations" || response.mode === "disambiguation"
      ? `Si quieres, puedo mostrar opciones de la colección. ${buildFallbackLeadIn(
          constraints,
          userMessage
        )}`.trim()
      : response.mode === "no_match"
        ? "No tengo una coincidencia exacta con esos criterios ahora mismo. Si quieres, puedo mostrar opciones cercanas de la colección."
        : "Para ayudarte mejor, necesito una aclaracion breve. Si quieres, puedo mostrar opciones de la colección.";
  return {
    ...response,
    assistant_message: clampAssistantMessage(
      `${spanishLeadIn} ${assistant}`.trim()
    ),
  };
}

function buildFallbackLeadIn(
  constraints: HardConstraints,
  userMessage: string
): string {
  const language = detectResponseLanguage(userMessage);
  const prettify = (value: string) =>
    value
      .split(" ")
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ");
  const styles = (constraints.styles ?? []).map(prettify);
  const colors = (constraints.colors ?? []).map(prettify);
  const trimmedMessage = normalizeText(userMessage).toLowerCase();
  const hasSimpleFollowupAck =
    /^(yes|yeah|yep|sure|please|ok|okay|show me|more|more please|sounds good)\b/.test(
      trimmedMessage
    );
  const hasPracticalNeed =
    /\b(kid|kids|child|children|dog|dogs|pet|pets|high traffic|durable|easy to clean|low maintenance|beach house)\b/i.test(
      trimmedMessage
    );
  const hasMultiRoomSignal =
    /\bbedroom\b/.test(trimmedMessage) &&
    /\b(entryway|entry|hallway|living room|dining room|kitchen)\b/.test(
      trimmedMessage
    );
  const isFirstTimer =
    /\b(never bought|first time|don't know where to start|dont know where to start|overwhelmed)\b/i.test(
      trimmedMessage
    );
  const hasNeutralDirection =
    /\b(neutral|goes with everything|versatile|low risk|subtle)\b/i.test(
      trimmedMessage
    );
  const wantsDifferentColorDirection =
    /\b(not that color|different color|another color|new color direction|less light colors)\b/i.test(
      trimmedMessage
    );
  const wantsLarger =
    /\b(larger|bigger|size up|slightly larger|more oversized)\b/i.test(trimmedMessage);
  const wantsSmaller =
    /\b(smaller|shorter|size down|slightly shorter|a bit shorter)\b/i.test(
      trimmedMessage
    );
  const asksClosestIfExactUnavailable =
    /\b(if exact isn't available|if exact is not available|if exact isnt available|show closest)\b/i.test(
      trimmedMessage
    );

  if (constraints.shape === "runner") {
    return language === "es"
      ? "Buscas un pasillero, asi que aqui tienes las piezas mas cercanas disponibles ahora:"
      : "You asked for a runner, so these are the closest available pieces in stock right now:";
  }
  if (constraints.shape === "round_oval") {
    return language === "es"
      ? "Buscas una pieza redonda u ovalada, asi que aqui tienes las opciones mas cercanas disponibles:"
      : "You asked for a round or oval piece, so these are the closest available options right now:";
  }
  if (constraints.size) {
    if (hasMultiRoomSignal) {
      return language === "es"
        ? "Perfecto, empecemos con una base para el dormitorio y despues te muestro opciones mas pequenas para la entrada:"
        : "Great, I’ll start with bedroom-friendly anchor options first, then we can pivot to entryway-size pieces next:";
    }
    if (wantsLarger) {
      return language === "es"
        ? `Perfecto, pides opciones mas grandes que ${formatSizePair(
            constraints.size.widthIn,
            constraints.size.lengthIn
          )}; te muestro las piezas mas grandes disponibles:`
        : `Great, you asked for larger than ${formatSizePair(
            constraints.size.widthIn,
            constraints.size.lengthIn
          )}, so I pulled the next biggest options we have:`;
    }
    if (wantsSmaller) {
      return language === "es"
        ? `Perfecto, pides opciones mas pequenas que ${formatSizePair(
            constraints.size.widthIn,
            constraints.size.lengthIn
          )}; te muestro las mas cercanas en ese rango:`
        : `Great, you asked for slightly smaller than ${formatSizePair(
            constraints.size.widthIn,
            constraints.size.lengthIn
          )}, so I pulled the closest options in that direction:`;
    }
    if (asksClosestIfExactUnavailable) {
      return language === "es"
        ? `Perfecto, priorice la medida mas cercana a ${formatSizePair(
            constraints.size.widthIn,
            constraints.size.lengthIn
          )} para que compares rapido:`
        : `Great, I prioritized the closest sizes around ${formatSizePair(
            constraints.size.widthIn,
            constraints.size.lengthIn
          )} so you can compare quickly:`;
    }
    if (hasPracticalNeed) {
      return language === "es"
        ? `Para una opcion practica y resistente cerca de ${formatSizePair(
            constraints.size.widthIn,
            constraints.size.lengthIn
          )}, estas son las mejores alternativas disponibles ahora:`
        : `For practical daily use near ${formatSizePair(
            constraints.size.widthIn,
            constraints.size.lengthIn
          )}, I pulled the strongest available options to compare:`;
    }
    return language === "es"
      ? `Para una medida cercana a ${formatSizePair(
          constraints.size.widthIn,
          constraints.size.lengthIn
        )}, te muestro las opciones disponibles mas cercanas para comparar rapido:`
      : `Great direction - I pulled the closest in-stock options around ${formatSizePair(
          constraints.size.widthIn,
          constraints.size.lengthIn
        )} so you can compare quickly:`;
  }
  if (styles.length > 0 && colors.length > 0) {
    return language === "es"
      ? `Para ${styles.join(", ")} con tonos ${colors.join(
          ", "
        )}, estas son las mejores opciones disponibles ahora:`
      : `For ${styles.join(", ")} with ${colors.join(
          ", "
        )} tones, these are the strongest available matches right now:`;
  }
  if (styles.length > 0) {
    return language === "es"
      ? `Aqui tienes nuestras piezas ${styles.join(", ")} disponibles ahora:`
      : `Great direction - here are our best ${styles.join(", ")} pieces currently in stock:`;
  }
  if (colors.length > 0) {
    if (hasNeutralDirection) {
      return language === "es"
        ? "Perfecto, voy con una direccion neutra y versatil para que combine facilmente con distintos espacios:"
        : "Great, I’ll keep this in a neutral, versatile direction that can blend easily with different spaces:";
    }
    return language === "es"
      ? `Aqui tienes opciones con presencia fuerte de ${colors.join(", ")}:`
      : `You asked for ${colors.join(", ")} tones, so I prioritized the strongest matches in stock:`;
  }

  const looksLikeDiscoveryBrowse =
    /\b(show me what you have|show me what you've got|just browsing|just looking|surprise me|open to anything|explore|range)\b/i.test(
      trimmedMessage
    );
  if (looksLikeDiscoveryBrowse) {
    return language === "es"
      ? "Como estas explorando opciones, te prepare una seleccion variada para que comparemos direccion:"
      : "Since you're browsing openly, I curated a varied range so you can react to different directions:";
  }
  if (hasSimpleFollowupAck) {
    return language === "es"
      ? "Perfecto, aqui tienes las mejores opciones basadas en lo que me has contado:"
      : "Here are the best options based on what you've told me:";
  }
  if (trimmedMessage.length > 0) {
    if (isFirstTimer) {
      return language === "es"
        ? "Perfecto, empecemos facil: te muestro una seleccion clara para comparar sin complicarte."
        : "Great starting point, I’ll keep this simple with a clear set you can quickly compare.";
    }
    if (wantsDifferentColorDirection) {
      return language === "es"
        ? "Entendido, mantenemos la misma direccion general pero cambiando la paleta de color:"
        : "Understood, we’ll keep a similar direction but shift the color palette:";
    }
    if (hasPracticalNeed) {
      return language === "es"
        ? "Con tus necesidades practicas en mente, aqui tienes opciones resistentes y versatiles para comparar:"
        : "With your practical needs in mind, here are durable options worth comparing:";
    }
    return language === "es"
      ? "Con lo que me compartiste, aqui tienes una seleccion variada para comparar estilos:"
      : "Great direction - here is a curated set to compare quickly:";
  }
  return language === "es"
    ? "Aqui tienes una seleccion solida de opciones disponibles:"
    : "Here is a strong set of available options:";
}

function applyConstraintMismatchDisclosure(input: {
  response: RecommendationResponse;
  constraintMismatch?:
    | {
        expanded_from_zero_match: boolean;
        unmet_constraints: string[];
        disclosure_hint: string | null;
      }
    | undefined;
}): RecommendationResponse {
  const mismatch = input.constraintMismatch;
  if (!mismatch?.expanded_from_zero_match) {
    return input.response;
  }
  if (input.response.mode !== "recommendations") {
    return input.response;
  }

  const current = toPlainText(input.response.assistant_message);
  const hint = toPlainText(
    mismatch.disclosure_hint ??
      "We do not have an exact match for that request right now."
  );
  if (!hint) {
    return input.response;
  }

  const normalizedCurrent = current.toLowerCase();
  const normalizedHint = hint.toLowerCase();
  const alreadyHasEquivalentDisclosure =
    /\b(don't have|do not have)\b/.test(normalizedCurrent) &&
    /\b(exact|exactly)\b/.test(normalizedCurrent) &&
    /\b(closest|alternative)\b/.test(normalizedCurrent);
  if (alreadyHasEquivalentDisclosure) {
    return {
      ...input.response,
      assistant_message: current,
    };
  }
  if (normalizedCurrent.startsWith(normalizedHint)) {
    return {
      ...input.response,
      assistant_message: current,
    };
  }
  return {
    ...input.response,
    assistant_message: `${hint} ${current}`.trim(),
  };
}

function isWeakRecommendationMessage(message: string): boolean {
  const normalized = toPlainText(message).toLowerCase();
  if (!normalized) return true;
  if (normalized.length < 36) return true;
  return (
    normalized.startsWith("for around ") ||
    normalized.startsWith("from your request") ||
    normalized.startsWith("here are the best options based on what you've told me")
  );
}

function buildRecommendationLeadFromConstraints(input: {
  constraints: HardConstraints;
  userMessage: string;
  discoveryMode: boolean;
  customerContext?: string[];
}): string {
  const language = detectResponseLanguage(input.userMessage);
  const practicalSignal =
    /\b(kid|kids|child|children|dog|dogs|pet|pets|high traffic|durable|easy to clean|beach house)\b/i.test(
      normalizeText(input.userMessage)
    ) ||
    (input.customerContext ?? []).some((fact) =>
      /\bpractical\b/i.test(normalizeText(fact))
    );
  const firstTimerSignal =
    /\b(never bought|first time|don't know where to start|dont know where to start|overwhelmed)\b/i.test(
      normalizeText(input.userMessage)
    );
  const multiRoomSignal =
    /\bbedroom\b/i.test(normalizeText(input.userMessage)) &&
    /\b(entryway|entry|hallway|living room|dining room|kitchen)\b/i.test(
      normalizeText(input.userMessage)
    );
  const lessBusySignal =
    /\b(less busy|not too busy|cleaner|understated|calmer)\b/i.test(
      normalizeText(input.userMessage)
    );
  const style = (input.constraints.styles ?? [])[0];
  const color = (input.constraints.colors ?? [])[0];
  const size = input.constraints.size
    ? formatSizePair(input.constraints.size.widthIn, input.constraints.size.lengthIn)
    : null;

  if (input.discoveryMode) {
    return language === "es"
      ? "Perfecto, aqui tienes una seleccion cuidada para comparar direcciones rapidamente."
      : "Great, here is a curated spread so you can quickly react to different directions.";
  }
  if (firstTimerSignal) {
    return language === "es"
      ? "Perfecto, empecemos facil: te muestro pocas opciones claras para que sea sencillo comparar."
      : "Perfect, let’s start simple with a small set of clear options so this is easy to compare.";
  }
  if (multiRoomSignal) {
    return language === "es"
      ? "Perfecto, empiezo con opciones para dormitorio y luego pasamos a alternativas mas pequenas para la entrada."
      : "Great, I’ll start with bedroom-friendly options first, then we can pivot to smaller entryway pieces.";
  }
  if (practicalSignal && size) {
    return language === "es"
      ? `Perfecto, para un uso diario cerca de ${size}, priorice opciones mas resistentes y faciles de mantener dentro de lo disponible.`
      : `Great, for practical daily use around ${size}, I prioritized the most durable, easier-care options available right now.`;
  }
  if (lessBusySignal) {
    return language === "es"
      ? "Perfecto, voy con una direccion mas limpia y menos cargada para que compares mejor."
      : "Great, I’m leaning cleaner and less busy so you can compare a calmer direction.";
  }
  if (style && size) {
    return language === "es"
      ? `Perfecto, para una direccion ${style} en torno a ${size}, estas son las mejores coincidencias disponibles ahora.`
      : `Great direction, for a ${style} look around ${size}, these are the best available matches right now.`;
  }
  if (style) {
    return language === "es"
      ? `Perfecto, para una direccion ${style}, estas son las mejores piezas disponibles ahora.`
      : `Great direction, for a ${style} look, these are the strongest pieces available right now.`;
  }
  if (color) {
    return language === "es"
      ? `Perfecto, para una direccion de color ${color}, estas piezas se alinean mejor con lo que pediste.`
      : `Great color direction, these pieces align best with what you asked for.`;
  }
  if (size) {
    return language === "es"
      ? `Perfecto, el objetivo es un tamano cercano a ${size}; estas son las mejores opciones disponibles ahora.`
      : `Great, your target is around ${size}, and these are the best options available right now.`;
  }
  return language === "es"
    ? "Perfecto, estas son las opciones mas fuertes disponibles ahora segun lo que me compartiste."
    : "Great, these are the strongest available options based on what you shared.";
}

function rewriteWeakRecommendationMessage(input: {
  response: RecommendationResponse;
  constraints: HardConstraints;
  userMessage: string;
  discoveryMode: boolean;
  customerContext?: string[];
}): RecommendationResponse {
  if (input.response.mode !== "recommendations") {
    return input.response;
  }
  const currentAssistant = toPlainText(input.response.assistant_message).toLowerCase();
  const hasExplicitMismatchDisclosure =
    /\b(don't have|do not have|don't carry|do not carry|largest|exact match)\b/i.test(
      currentAssistant
    );
  if (hasExplicitMismatchDisclosure) {
    return input.response;
  }
  if (!isWeakRecommendationMessage(input.response.assistant_message)) {
    return input.response;
  }
  const lead = buildRecommendationLeadFromConstraints({
    constraints: input.constraints,
    userMessage: input.userMessage,
    discoveryMode: input.discoveryMode,
    customerContext: input.customerContext,
  });
  const top = input.response.recommendations[0];
  const topReason = top?.match_reasons?.[0] ? toPlainText(top.match_reasons[0]) : "";
  const detail =
    top && topReason
      ? `Top pick: ${toPlainText(top.title)} — ${topReason}.`
      : "";
  const invite = input.discoveryMode
    ? ""
    : detectResponseLanguage(input.userMessage) === "es"
      ? "Si algo te llama la atencion, te muestro mas opciones en esa misma direccion."
      : "If one stands out, I can show more in that same direction.";
  const rewritten = [lead, detail, invite].filter(Boolean).join(" ").trim();
  if (!rewritten) return input.response;
  return {
    ...input.response,
    assistant_message: clampAssistantMessage(rewritten),
  };
}

function enforcePracticalTruthMessage(input: {
  response: RecommendationResponse;
  userMessage: string;
}): RecommendationResponse {
  if (input.response.mode !== "recommendations") {
    return input.response;
  }
  const practicalSignal =
    /\b(kid|kids|child|children|dog|dogs|pet|pets|high traffic|durable|easy to clean|low maintenance|beach house|tough)\b/i.test(
      normalizeText(input.userMessage)
    );
  if (!practicalSignal) {
    return input.response;
  }

  const assistant = toPlainText(input.response.assistant_message);
  const hasPracticalLanguage =
    /\b(durable|easy to clean|easy-care|high traffic|practical|low maintenance|hide wear)\b/i.test(
      assistant
    );
  const alreadyHonestAboutLimits =
    /\b(limited|closest|exact match|don't have|do not have|available alternatives)\b/i.test(
      assistant
    );
  if (alreadyHonestAboutLimits && hasPracticalLanguage) {
    return input.response;
  }

  const language = detectResponseLanguage(input.userMessage);
  const lead =
    language === "es"
      ? "Para uso diario intenso, las opciones realmente faciles de mantener son limitadas, asi que te muestro las alternativas mas practicas disponibles."
      : "For heavy daily use, truly easy-care options are limited, so I’m showing the most practical alternatives currently available.";
  const practicalAddOn =
    language === "es"
      ? "Priorizo piezas mas faciles de mantener y que disimulan mejor el uso diario."
      : "I prioritized options that are easier to maintain and better at hiding day-to-day wear.";

  return {
    ...input.response,
    assistant_message: clampAssistantMessage(
      `${lead} ${assistant} ${hasPracticalLanguage ? "" : practicalAddOn}`.trim()
    ),
  };
}

function enforceImpossibleSizeDisclosure(input: {
  response: RecommendationResponse;
  userMessage: string;
}): RecommendationResponse {
  if (input.response.mode !== "recommendations") {
    return input.response;
  }
  const impossibleSizeSignal =
    /\b(50x50|50 by 50|100 by 100|100x100|100 feet|30 by 40|20-foot|20 foot)\b/i.test(
      normalizeText(input.userMessage)
    );
  if (!impossibleSizeSignal) {
    return input.response;
  }

  const assistant = toPlainText(input.response.assistant_message);
  const hasDisclosure =
    /\b(don't have|do not have|largest|closest)\b/i.test(assistant);
  if (hasDisclosure) {
    return input.response;
  }

  const language = detectResponseLanguage(input.userMessage);
  const lead =
    language === "es"
      ? "No tenemos una coincidencia exacta para ese tamano, asi que te muestro las opciones mas cercanas disponibles."
      : "We don't have an exact match at that size, so I’m showing the closest available options.";
  return {
    ...input.response,
    assistant_message: clampAssistantMessage(`${lead} ${assistant}`.trim()),
  };
}

function warnIfLikelyTruncatedAssistantMessage(input: {
  surface: "recommendation";
  message: string;
}): void {
  if (endsWithSentenceBoundary(input.message)) return;
  console.warn(`[${input.surface}] assistant message may be truncated`, {
    assistant_preview: sectionPreview(input.message),
  });
}

function resolveRecommendationCap(input: {
  userMessage: string;
  discoveryMode: boolean;
}): number {
  const normalized = normalizeText(input.userMessage);
  if (
    /\b(never bought|first time|don't know where to start|dont know where to start|overwhelmed)\b/i.test(
      normalized
    )
  ) {
    return 4;
  }
  if (/\b(less busy|not too busy|cleaner|understated|calmer)\b/i.test(normalized)) {
    return 6;
  }
  if (
    /\b(kid|kids|child|children|dog|dogs|pet|pets|high traffic|durable|easy to clean|low maintenance|beach house|tough)\b/i.test(
      normalized
    )
  ) {
    return 6;
  }
  if (input.discoveryMode) {
    return 6;
  }
  return MAX_RECOMMENDATIONS;
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

function buildSpecificRugReasons(rug: InventoryRug): string[] {
  const reasons: string[] = [];
  const description = normalizeText(rug.ai_description ?? "");

  if (description) {
    reasons.push(description);
  } else {
    reasons.push("New arrival — ask staff for details about this rug.");
  }

  return uniqueCompactList(reasons, 3);
}

function buildGroundedMatchReasons(
  rug: InventoryRug,
  constraints: HardConstraints,
  userMessage: string
): string[] {
  const reasons: string[] = [];
  const specificRugReasons = buildSpecificRugReasons(rug);
  const sizeDistanceIn = getSizeDistanceIn(rug, constraints);
  const signals = collectSoftSignals(userMessage);
  const rugText = [toLower(rugLabel(rug)), toLower(rug.ai_description)].join(" ");
  const structuredText = structuredSignalText(rug);

  if (constraints.size && sizeDistanceIn !== null) {
    reasons.push(
      sizeDistanceIn <= 2
        ? "Size closely matches your requested dimensions."
        : "Closest currently available size to your request."
    );
  }

  const matchedStructuredSignal = signals.find(
    (token) => token && structuredText.includes(token)
  );
  if (matchedStructuredSignal) {
    reasons.push(
      `Strong match on your stated preference around "${matchedStructuredSignal}".`
    );
  } else {
    const matchedTextSignal = signals.find((token) => token && rugText.includes(token));
    if (matchedTextSignal) {
      reasons.push(`Matches your stated preference around "${matchedTextSignal}".`);
    }
  }

  return uniqueCompactList(
    [
      specificRugReasons[0] ?? "New arrival — ask staff for details about this rug.",
      ...reasons,
      ...specificRugReasons.slice(1),
    ],
    3
  );
}

function buildWhyNot(
  rug: InventoryRug,
  constraints: HardConstraints,
  userMessage: string
): string[] {
  const notes: string[] = [];
  const sizeDistanceIn = getSizeDistanceIn(rug, constraints);
  const tolerance = constraints.size?.toleranceIn ?? 2;
  const signals = collectSoftSignals(userMessage);
  const rugText = [toLower(rugLabel(rug)), toLower(rug.ai_description)].join(" ");
  const structuredText = structuredSignalText(rug);

  if (constraints.size && sizeDistanceIn !== null && sizeDistanceIn > tolerance * 2) {
    notes.push("Dimensions are not an exact match and may require compromise.");
  }

  const hasSignalMatch = signals.some(
    (token) => token && (structuredText.includes(token) || rugText.includes(token))
  );
  if (signals.length > 0 && !hasSignalMatch) {
    notes.push("May not fully align with your stated style direction.");
  }

  if (!rug.ai_description || rug.ai_description.trim().length === 0) {
    notes.push("New arrival with limited detail until description is completed.");
  }

  return notes.slice(0, 2);
}

function buildConfidence(
  rug: InventoryRug,
  constraints: HardConstraints,
  userMessage: string
): {
  score: number;
  tier: "high" | "medium" | "low";
  factors: string[];
} {
  const factors: string[] = [];
  let score = 0.5;
  const sizeDistanceIn = getSizeDistanceIn(rug, constraints);
  const signals = collectSoftSignals(userMessage);
  const rugText = [toLower(rugLabel(rug)), toLower(rug.ai_description)].join(" ");
  const structuredText = structuredSignalText(rug);

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

  const structuredMatches = signals.filter(
    (token) => token && structuredText.includes(token)
  ).length;
  if (structuredMatches > 0) {
    score += Math.min(0.18, structuredMatches * 0.06);
    factors.push("Strong structured preference match");
  } else {
    const textMatches = signals.filter((token) => token && rugText.includes(token)).length;
    if (textMatches > 0) {
      score += Math.min(0.12, textMatches * 0.04);
      factors.push("Matches stated preferences");
    }
  }

  if (rug.ai_description) {
    score += 0.05;
    factors.push("Detailed listing context available");
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

// Flow overview
// Deterministic local fallback used when AI is unavailable or invalid.
function fallbackRecommendations(
  inventory: InventoryRug[],
  constraints: HardConstraints,
  userMessage: string,
  promptContext?: RecommendationPromptContext
): RecommendationResponse {
  // If OpenAI fails, we still return a usable response so the API never
  // breaks the frontend flow.
  const recommendations = inventory.slice(0, MAX_RECOMMENDATIONS).map((rug) => {
    const confidence = buildConfidence(rug, constraints, userMessage);
    const fields = effectiveFields(rug);
    return {
      rug_id: rug.id,
      sku: null,
      title: rugLabel(rug),
      origin: fields.origin ?? null,
      style: fields.style ?? null,
      mood: fields.mood ?? null,
      primary_image_url: toImageUrl(rug),
      primary_image_caption: toImageCaption(),
      size_text: sizeText(rug),
      match_reasons: buildGroundedMatchReasons(
        rug,
        constraints,
  userMessage
      ),
      confidence: confidence.score,
      confidence_tier: confidence.tier,
      confidence_factors: confidence.factors,
      why_not: buildWhyNot(rug, constraints, userMessage),
    };
  });

  const mismatchDisclosure = toPlainText(
    promptContext?.constraint_mismatch?.expanded_from_zero_match
      ? (promptContext.constraint_mismatch.disclosure_hint ??
          "We do not have an exact match for that request right now.")
      : ""
  );

  return {
    mode: "recommendations",
    assistant_message:
      mismatchDisclosure.length > 0
        ? `${mismatchDisclosure} ${buildFallbackLeadIn(constraints, userMessage)}`
        : buildFallbackLeadIn(constraints, userMessage),
    questions: [],
    recommendations,
    notes: "Fallback response (OpenAI unavailable or invalid).",
  };
}

function shouldUseDeterministicPath(input: {
  inventory: InventoryRug[];
  constraints: HardConstraints;
  userMessage: string;
  promptContext?: RecommendationPromptContext;
}): boolean {
  // Quality-first mode: always use AI ranking when candidates are available.
  // Deterministic fallback remains as the safety net for API failure paths.
  return false;
}

// Flow overview
// Runtime guard for structured output contract.
function isRecommendationResponse(value: unknown): value is RecommendationResponse {
  // Manual runtime checks to ensure model output is truly usable.
  // TypeScript types alone do not validate runtime JSON.
  if (!value || typeof value !== "object") return false;
  const data = value as Record<string, unknown>;

  if (
    data.mode !== "recommendations" &&
    data.mode !== "clarifying_question" &&
    data.mode !== "no_match" &&
    data.mode !== "disambiguation"
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
        ((typeof rec.origin === "string" &&
          normalizeText(rec.origin).length > 0 &&
          normalizeText(rec.origin).length <= 60) ||
          rec.origin === null) &&
        ((typeof rec.style === "string" &&
          normalizeText(rec.style).length > 0 &&
          normalizeText(rec.style).length <= 80) ||
          rec.style === null) &&
        ((typeof rec.mood === "string" &&
          normalizeText(rec.mood).length > 0 &&
          normalizeText(rec.mood).length <= 32) ||
          rec.mood === null) &&
        ((typeof rec.size_text === "string" &&
          normalizeText(rec.size_text).length <= MAX_SIZE_TEXT_CHARS) ||
          rec.size_text === null) &&
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

// Flow overview
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

// Flow overview
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

function disambiguateDuplicateRecommendationTitles(
  recommendations: RecommendationResponse["recommendations"]
): RecommendationResponse["recommendations"] {
  const counts = new Map<string, number>();
  for (const rec of recommendations) {
    const key = `${rec.title.toLowerCase()}|${(rec.size_text ?? "").toLowerCase()}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  return recommendations.map((rec) => {
    const key = `${rec.title.toLowerCase()}|${(rec.size_text ?? "").toLowerCase()}`;
    if ((counts.get(key) ?? 0) <= 1) return rec;

    const differentiator =
      rec.origin && rec.origin.trim().length > 0
        ? rec.origin.trim()
        : `ID ${rec.rug_id.slice(0, 6)}`;

    return {
      ...rec,
      title: `${rec.title} (${differentiator})`,
    };
  });
}

function filterRecommendationsByAvoidStyles(input: {
  recommendations: RecommendationResponse["recommendations"];
  inventoryById: Map<string, InventoryRug>;
  constraints: HardConstraints;
}): RecommendationResponse["recommendations"] {
  const avoidStyleTokens = (input.constraints.avoid_preferences?.styles ?? [])
    .map((value) => normalizeText(value))
    .filter((value) => value.length > 0);
  if (avoidStyleTokens.length === 0) {
    return input.recommendations;
  }

  const filtered = input.recommendations.filter((rec) => {
    const rug = input.inventoryById.get(rec.rug_id);
    if (!rug) return true;
    const fields = effectiveFields(rug);
    const haystack = normalizeText(
      [
        rug.intake_label ?? "",
        rug.ai_description ?? "",
        fields.style ?? "",
        fields.origin ?? "",
        fields.mood ?? "",
        ...(fields.pattern ?? []),
      ].join(" ")
    );
    return !avoidStyleTokens.some((token) => haystack.includes(token));
  });

  return filtered.length > 0 ? filtered : input.recommendations;
}

// Flow overview
// Enforce backend trust boundary:
// - keep only recommendations that reference candidate IDs
// - clamp output counts
// - repair invalid no_match from model when candidates exist
function sanitizeResponse(
  response: RecommendationResponse,
  inventory: InventoryRug[],
  constraints: HardConstraints,
  userMessage: string,
  input?: {
    discoveryMode?: boolean;
    customerContext?: string[];
    constraintMismatch?:
      | {
          expanded_from_zero_match: boolean;
          unmet_constraints: string[];
          disclosure_hint: string | null;
        }
      | undefined;
  }
): RecommendationResponse {
  // Only keep rugs that definitely came from backend candidates.
  // This blocks hallucinated IDs from passing through.
  const allowedIds = new Set(inventory.map((rug) => rug.id));
  const inventoryById = new Map(inventory.map((rug) => [rug.id, rug]));
  const seenRugIds = new Set<string>();
  const dedupedRecommendations = response.recommendations.filter((rec) => {
    if (!allowedIds.has(rec.rug_id)) return false;
    if (seenRugIds.has(rec.rug_id)) return false;
    seenRugIds.add(rec.rug_id);
    return true;
  });
  const recommendations = dedupedRecommendations
    .slice(0, MAX_RECOMMENDATIONS)
    .map((rec) => {
      const rug = inventoryById.get(rec.rug_id);
      if (!rug) return rec;

      const confidence = buildConfidence(rug, constraints, userMessage);
      const fields = effectiveFields(rug);
      return {
        ...rec,
        sku: null,
        title: rugLabel(rug),
        origin: fields.origin ?? null,
        style: fields.style ?? null,
        mood: fields.mood ?? null,
        primary_image_url: toImageUrl(rug),
        primary_image_caption: toImageCaption(),
        size_text: sizeText(rug),
        match_reasons: buildGroundedMatchReasons(
          rug,
          constraints,
  userMessage
        ),
        confidence: confidence.score,
        confidence_tier: confidence.tier,
        confidence_factors: confidence.factors,
        why_not: buildWhyNot(rug, constraints, userMessage),
      };
    });
  let normalizedRecommendations =
    disambiguateDuplicateRecommendationTitles(recommendations);

  if (input?.discoveryMode && response.mode === "recommendations") {
    const minimumDiscoveryCount =
      inventory.length >= 4 ? Math.min(6, inventory.length) : inventory.length;
    if (
      normalizedRecommendations.length < Math.min(4, minimumDiscoveryCount) &&
      inventory.length > normalizedRecommendations.length
    ) {
      const fallback = fallbackRecommendations(
        inventory,
        constraints,
        userMessage,
        undefined
      );
      const seen = new Set(normalizedRecommendations.map((rec) => rec.rug_id));
      const extras = filterRecommendationsByAvoidStyles({
        recommendations: fallback.recommendations.filter(
          (rec) => !seen.has(rec.rug_id)
        ),
        inventoryById,
        constraints,
      });
      normalizedRecommendations = disambiguateDuplicateRecommendationTitles(
        [...normalizedRecommendations, ...extras].slice(0, minimumDiscoveryCount)
      );
    }
  }

  if (response.mode === "recommendations") {
    const hasStrictMustConstraint = Boolean(
      constraints.strictness?.size === "must" ||
        constraints.strictness?.shape === "must" ||
        constraints.strictness?.styles === "must" ||
        constraints.strictness?.colors === "must"
    );
    const canBackfillWithoutSilentExpansion =
      !hasStrictMustConstraint || Boolean(input?.discoveryMode);
    const canBackfillStrictMismatch =
      hasStrictMustConstraint &&
      Boolean(input?.constraintMismatch?.expanded_from_zero_match);

    const minimumRecommendationCount = canBackfillStrictMismatch
      ? Math.min(3, inventory.length)
      : inventory.length >= 4
        ? Math.min(6, inventory.length)
        : inventory.length;
    if (
      (canBackfillWithoutSilentExpansion || canBackfillStrictMismatch) &&
      normalizedRecommendations.length < Math.min(4, minimumRecommendationCount) &&
      inventory.length > normalizedRecommendations.length
    ) {
      const fallback = fallbackRecommendations(
        inventory,
        constraints,
        userMessage,
        undefined
      );
      const seen = new Set(normalizedRecommendations.map((rec) => rec.rug_id));
      const extras = filterRecommendationsByAvoidStyles({
        recommendations: fallback.recommendations.filter(
          (rec) => !seen.has(rec.rug_id)
        ),
        inventoryById,
        constraints,
      });
      normalizedRecommendations = disambiguateDuplicateRecommendationTitles(
        [...normalizedRecommendations, ...extras].slice(0, minimumRecommendationCount)
      );
    }
  }

  if (response.mode === "recommendations") {
    const recommendationCap = resolveRecommendationCap({
      userMessage,
      discoveryMode: Boolean(input?.discoveryMode),
    });
    normalizedRecommendations = normalizedRecommendations.slice(0, recommendationCap);
  }

  const cappedQuestions = response.questions.slice(0, 2);

  if (response.mode === "no_match" && inventory.length > 0) {
    const repaired = enforceImpossibleSizeDisclosure({
      response: enforcePracticalTruthMessage({
        response: rewriteWeakRecommendationMessage({
          response: applyConstraintMismatchDisclosure({
            response: applyTonePolish({
              ...fallbackRecommendations(
                inventory,
                constraints,
                userMessage,
                undefined
              ),
              notes: "Adjusted invalid no_match from model output.",
            }),
            constraintMismatch: input?.constraintMismatch,
          }),
          constraints,
          userMessage,
          discoveryMode: Boolean(input?.discoveryMode),
          customerContext: input?.customerContext,
        }),
        userMessage,
      }),
      userMessage,
    });
    return enforceDiscoveryQuestion(
      repaired,
      Boolean(input?.discoveryMode),
      input?.customerContext,
      userMessage,
      constraints
    );
  }

  if (response.mode === "recommendations" && normalizedRecommendations.length === 0) {
    const repaired = enforceImpossibleSizeDisclosure({
      response: enforcePracticalTruthMessage({
        response: rewriteWeakRecommendationMessage({
          response: applyConstraintMismatchDisclosure({
            response: applyTonePolish(
              fallbackRecommendations(inventory, constraints, userMessage, undefined)
            ),
            constraintMismatch: input?.constraintMismatch,
          }),
          constraints,
          userMessage,
          discoveryMode: Boolean(input?.discoveryMode),
          customerContext: input?.customerContext,
        }),
        userMessage,
      }),
      userMessage,
    });
    return enforceDiscoveryQuestion(
      repaired,
      Boolean(input?.discoveryMode),
      input?.customerContext,
      userMessage,
      constraints
    );
  }

  // Enforce mode-specific response contract for consistency with docs/schema intent.
  if (response.mode === "clarifying_question") {
    const normalizedQuestions = cappedQuestions.filter((q) => q.trim().length > 0);
    if (normalizedQuestions.length === 0) {
      return enforceDiscoveryQuestion(
        applyConstraintMismatchDisclosure({
          response: applyTonePolish(
            fallbackRecommendations(inventory, constraints, userMessage, undefined)
          ),
          constraintMismatch: input?.constraintMismatch,
        }),
        Boolean(input?.discoveryMode),
        input?.customerContext,
        userMessage,
        constraints
      );
    }
    return enforceDiscoveryQuestion(
      applyTonePolish({
      ...response,
      questions: normalizedQuestions.slice(0, 2),
      recommendations: [],
      }),
      Boolean(input?.discoveryMode),
      input?.customerContext,
      userMessage,
      constraints
    );
  }

  if (response.mode === "no_match") {
    return enforceDiscoveryQuestion(
      applyTonePolish({
      ...response,
      questions: cappedQuestions.slice(0, 1),
      recommendations: [],
      }),
      Boolean(input?.discoveryMode),
      input?.customerContext,
      userMessage,
      constraints
    );
  }

  if (response.mode === "disambiguation") {
    if (normalizedRecommendations.length === 0) {
      return enforceDiscoveryQuestion(
        applyConstraintMismatchDisclosure({
          response: applyTonePolish({
            ...fallbackRecommendations(
              inventory,
              constraints,
              userMessage,
              undefined
            ),
            notes: "Adjusted invalid disambiguation from model output.",
          }),
          constraintMismatch: input?.constraintMismatch,
        }),
        Boolean(input?.discoveryMode),
        input?.customerContext,
        userMessage,
        constraints
      );
    }
    return enforceDiscoveryQuestion(
      applyTonePolish({
      ...response,
      questions: [],
      recommendations: normalizedRecommendations.slice(0, 3),
      }),
      Boolean(input?.discoveryMode),
      input?.customerContext,
      userMessage,
      constraints
    );
  }

  const repaired = enforceImpossibleSizeDisclosure({
    response: enforcePracticalTruthMessage({
      response: rewriteWeakRecommendationMessage({
        response: applyConstraintMismatchDisclosure({
          response: applyTonePolish({
            ...response,
            questions: [],
            recommendations: normalizedRecommendations,
          }),
          constraintMismatch: input?.constraintMismatch,
        }),
        constraints,
        userMessage,
        discoveryMode: Boolean(input?.discoveryMode),
        customerContext: input?.customerContext,
      }),
      userMessage,
    }),
    userMessage,
  });
  return enforceDiscoveryQuestion(
    repaired,
    Boolean(input?.discoveryMode),
    input?.customerContext,
    userMessage,
    constraints
  );
}

export async function rankAndExplain(
  inventory: InventoryRug[],
  constraints: HardConstraints,
  userMessage: string,
  promptContext?: RecommendationPromptContext,
  trace?: RecommendationAiTrace
): Promise<RecommendationResponse> {
  // Flow overview
  // A) Early return for true no-match candidate set.
  // B) Verify OpenAI key.
  // C) Build prompt inputs from user request + hard constraints + candidate inventory.
  // D) Request strict JSON schema output from model.
  // E) Parse/validate/sanitize, else return deterministic fallback.
  if (inventory.length === 0) {
    if (trace) {
      trace.called = false;
      trace.model = OPENAI_CHAT_MODEL;
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
    const language = detectResponseLanguage(userMessage);
    return applyTonePolish({
      mode: "no_match",
      assistant_message:
        language === "es"
          ? constrainedSearch
            ? "No tengo piezas disponibles que cumplan exactamente esos criterios en este momento."
            : "No veo alfombras disponibles en el inventario actual."
          : constrainedSearch
            ? "Nothing currently available matches those constraints exactly."
            : "I do not see any available rugs in the current inventory list.",
      questions: constrainedSearch
        ? [
            language === "es"
              ? "Quieres ajustar algun criterio para ampliar opciones?"
              : "Would you like to adjust one constraint so I can broaden options?",
          ]
        : [],
      recommendations: [],
      notes: null,
    });
  }

  if (
    shouldUseDeterministicPath({
      inventory,
      constraints,
      userMessage,
      promptContext,
    })
  ) {
    if (trace) {
      trace.called = false;
      trace.model = OPENAI_CHAT_MODEL;
      trace.prompt_layers = [];
      trace.request_payload = null;
      trace.response_status = null;
      trace.response_payload = null;
      trace.parsed_response = null;
      trace.fallback_reason = "Deterministic fast path";
      trace.error = null;
      trace.incomplete_detected = false;
      trace.retry_attempted = false;
      trace.retry_succeeded = false;
      trace.text_postprocess_applied = false;
    }

    return applyTonePolish({
      ...fallbackRecommendations(
        inventory,
        constraints,
        userMessage,
        promptContext
      ),
      notes: "Deterministic fast-path response.",
    });
  }

  const contextInventory = toContextInventory(inventory);
  const promptBundle = getRecommendationPromptBundle();
  // If no user message was provided, build a plain fallback request sentence.
  const requestText =
    userMessage.trim().length > 0
      ? userMessage.trim()
      : buildFallbackRequestText(constraints);

  const promptSections = buildRecommendationPromptSections({
    role: promptContext?.role ?? "retail_customer",
    discoveryMode: Boolean(promptContext?.discovery_mode),
    hasConstraintMismatch: Boolean(promptContext?.constraint_mismatch),
    hasThinResultsExpansion: Boolean(promptContext?.expanded_due_to_thin_results),
    hasChatMemoryContext: Boolean(promptContext?.chat_context),
    hasCustomerContext:
      Array.isArray(promptContext?.chat_context?.customer_context) &&
      (promptContext?.chat_context?.customer_context?.length ?? 0) > 0,
    hasRecentlyShownContext:
      Array.isArray(promptContext?.chat_context?.recently_shown_rugs) &&
      (promptContext?.chat_context?.recently_shown_rugs?.length ?? 0) > 0,
    hasLikedAttributesContext:
      Boolean(promptContext?.chat_context?.liked_attributes) &&
      ((promptContext?.chat_context?.liked_attributes?.colors?.length ?? 0) > 0 ||
        (promptContext?.chat_context?.liked_attributes?.styles?.length ?? 0) > 0 ||
        (promptContext?.chat_context?.liked_attributes?.origins?.length ?? 0) > 0),
    hasRecentTurnsContext:
      Array.isArray(promptContext?.chat_context?.recent_turns) &&
      (promptContext?.chat_context?.recent_turns?.length ?? 0) > 0,
    prompts: {
      system: promptBundle.system,
      recommendation: promptBundle.recommendation,
      structuredOutput: promptBundle.recommendationStructuredOutput,
    },
    constraint_mismatch: promptContext?.constraint_mismatch,
    expanded_due_to_thin_results: promptContext?.expanded_due_to_thin_results,
    chatContext: promptContext?.chat_context,
    inventoryContext: contextInventory,
    userMessage: requestText,
    constraints,
  });

  const requestInput = groupPromptSectionsByRole(promptSections);

  const requestPayload = {
    model: OPENAI_CHAT_MODEL,
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
    trace.model = OPENAI_CHAT_MODEL;
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
    apiKey: OPENAI_API_KEY,
    requestPayload,
    surface: "recommendation",
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
    return enforceDiscoveryQuestion(
      applyTonePolish({
        ...fallbackRecommendations(inventory, constraints, userMessage, promptContext),
        notes: "OpenAI request failed. Returned local fallback.",
      }),
      Boolean(promptContext?.discovery_mode),
      promptContext?.chat_context?.customer_context,
      userMessage,
      constraints
    );
  }

  let parsed = parseRecommendationResponse(firstAttempt.response_payload);
  const shouldRetry =
    shouldRetryAfterAttempt({
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
      apiKey: OPENAI_API_KEY,
      requestPayload: retryPayload,
      surface: "recommendation",
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
    return enforceDiscoveryQuestion(
      applyTonePolish({
        ...fallbackRecommendations(inventory, constraints, userMessage, promptContext),
        notes: "OpenAI response parsing failed. Returned local fallback.",
      }),
      Boolean(promptContext?.discovery_mode),
      promptContext?.chat_context?.customer_context,
      userMessage,
      constraints
    );
  }

  // Final safety pass before returning to API route.
  const sanitized = sanitizeResponse(
    parsed,
    inventory,
    constraints,
    userMessage,
    {
      discoveryMode: Boolean(promptContext?.discovery_mode),
      customerContext: promptContext?.chat_context?.customer_context,
      constraintMismatch: promptContext?.constraint_mismatch,
    }
  );
  if (trace) {
    trace.parsed_response = sanitized;
    trace.fallback_reason = null;
    trace.error = null;
  }
  warnIfLikelyTruncatedAssistantMessage({
    surface: "recommendation",
    message: sanitized.assistant_message,
  });
  return sanitized;
}
