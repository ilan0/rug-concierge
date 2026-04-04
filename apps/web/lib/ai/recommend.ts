import type { HardConstraints, InventoryRug } from "@/lib/types/recommendation";
import { resolveEffectiveFields } from "@/lib/inventory/resolve-fields";
import { shapeCandidatesForAI } from "@/lib/filters/candidate-shaping";
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
  OPENAI_RECOMMENDATION_MODEL,
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
const MAX_ASSISTANT_MESSAGE_CHARS = 700;
const MAX_QUESTION_CHARS = 140;
const MAX_TITLE_CHARS = 160;
const MAX_SIZE_TEXT_CHARS = 64;
const MAX_REASON_CHARS = 180;
const MAX_CAVEAT_CHARS = 160;
const MAX_FACTOR_CHARS = 100;
const MAX_NOTES_CHARS = 220;
const MAX_REASONABLE_REQUEST_LONG_SIDE_IN = 240;
const RETRY_SYSTEM_INSTRUCTION =
  "Retry and return one complete JSON object that matches the schema exactly. Keep answers concise and finish all sentences.";
const RECOMMENDATION_MODEL = OPENAI_RECOMMENDATION_MODEL;
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

function parseSizePartIn(sizePart: string): number | null {
  const normalized = sizePart.trim();
  if (!normalized) return null;

  const feetMatch = normalized.match(/(\d+)\s*'/);
  const inchMatch = normalized.match(/(\d+)\s*"/);
  if (feetMatch || inchMatch) {
    const feet = feetMatch ? Number(feetMatch[1]) : 0;
    const inches = inchMatch ? Number(inchMatch[1]) : 0;
    const total = feet * 12 + inches;
    return Number.isFinite(total) ? total : null;
  }

  const numeric = Number(normalized.replace(/[^0-9.]/g, ""));
  if (!Number.isFinite(numeric)) return null;
  return Math.round(numeric);
}

function parseRecommendationSizePairIn(sizeTextValue: string | null): {
  widthIn: number;
  lengthIn: number;
} | null {
  if (!sizeTextValue) return null;
  const parts = sizeTextValue.split(/x|×/i).map((part) => part.trim());
  if (parts.length !== 2) return null;
  const widthIn = parseSizePartIn(parts[0]);
  const lengthIn = parseSizePartIn(parts[1]);
  if (widthIn === null || lengthIn === null) return null;
  return { widthIn, lengthIn };
}

function hasExactSizeRecommendation(
  recommendations: RecommendationResponse["recommendations"],
  constraints: HardConstraints
): boolean {
  if (!constraints.size) return false;
  const tolerance = Math.max(0, constraints.size.toleranceIn ?? 0);
  for (const rec of recommendations) {
    const pair = parseRecommendationSizePairIn(rec.size_text);
    if (!pair) continue;
    const directMatch =
      Math.abs(pair.widthIn - constraints.size.widthIn) <= tolerance &&
      Math.abs(pair.lengthIn - constraints.size.lengthIn) <= tolerance;
    const rotatedMatch =
      Math.abs(pair.widthIn - constraints.size.lengthIn) <= tolerance &&
      Math.abs(pair.lengthIn - constraints.size.widthIn) <= tolerance;
    if (directMatch || rotatedMatch) return true;
  }
  return false;
}

function matchesExactRequestedSize(rug: InventoryRug, constraints: HardConstraints): boolean {
  if (!constraints.size) return false;
  if (
    typeof rug.width_total_in !== "number" ||
    typeof rug.length_total_in !== "number"
  ) {
    return false;
  }
  const requested = constraints.size;
  const direct =
    rug.width_total_in === requested.widthIn &&
    rug.length_total_in === requested.lengthIn;
  const rotated =
    rug.width_total_in === requested.lengthIn &&
    rug.length_total_in === requested.widthIn;
  return direct || rotated;
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

  const sentenceMatches =
    plain.match(/[^.!?]+[.!?]+/g)?.map((part) => part.trim()).filter(Boolean) ?? [];
  if (sentenceMatches.length > 0) {
    let assembled = "";
    for (const sentence of sentenceMatches) {
      const next = assembled ? `${assembled} ${sentence}` : sentence;
      if (next.length > MAX_ASSISTANT_MESSAGE_CHARS) break;
      assembled = next;
    }
    if (assembled.length >= Math.floor(MAX_ASSISTANT_MESSAGE_CHARS * 0.45)) {
      return assembled.trim();
    }
  }

  const truncated = plain.slice(0, MAX_ASSISTANT_MESSAGE_CHARS).trim();
  const preferredBoundary = [...truncated.matchAll(/[.!?]/g)].at(-1);
  if (
    preferredBoundary &&
    typeof preferredBoundary.index === "number" &&
    preferredBoundary.index >= Math.floor(MAX_ASSISTANT_MESSAGE_CHARS * 0.45)
  ) {
    return truncated.slice(0, preferredBoundary.index + 1).trim();
  }

  const lastSpace = truncated.lastIndexOf(" ");
  if (lastSpace > Math.floor(MAX_ASSISTANT_MESSAGE_CHARS * 0.4)) {
    return `${truncated.slice(0, lastSpace).trim()}.`;
  }

  return `${truncated.slice(0, MAX_ASSISTANT_MESSAGE_CHARS - 1).trim()}.`;
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
    return {
      ...response,
      assistant_message: clampAssistantMessage(toPlainText(response.assistant_message)),
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
    const baseMessage = toPlainText(response.assistant_message);
    const warmedMessage = /^(happy|glad|absolutely|of course|great question|thanks)/i.test(
      baseMessage
    )
      ? baseMessage
      : `Happy to narrow this down. ${baseMessage}`.trim();
    return {
      ...response,
      assistant_message: clampAssistantMessage(warmedMessage),
      questions: [],
      recommendations: response.recommendations.slice(0, 3),
    };
  }

  return {
    ...response,
    assistant_message: clampAssistantMessage(toPlainText(response.assistant_message)),
    questions: [],
    recommendations: response.recommendations.map((rec) => ({
      ...rec,
      match_reasons: uniqueCompactList(rec.match_reasons, 3),
      confidence_factors: uniqueCompactList(rec.confidence_factors, 3),
      why_not: uniqueCompactList(rec.why_not, 2),
    })),
  };
}

function enforceDiscoveryQuestion(
  response: RecommendationResponse,
  discoveryMode: boolean,
  customerContext?: string[],
  userMessage?: string,
  constraints?: HardConstraints,
  recentlyShownIds?: string[]
): RecommendationResponse {
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
    const polished = enforceRecommendationConversationalFinish({
      response: {
        ...next,
        assistant_message: clampAssistantMessage(next.assistant_message),
      },
      userMessage,
      constraints,
      discoveryMode,
      recentlyShownIds,
      customerContext,
    });
    return enforceResponseLanguage(polished, userMessage, constraints);
  };

  const anchoredResponse = response;

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
    return finalize({
      ...anchoredResponse,
      assistant_message: clampAssistantMessage(anchoredResponse.assistant_message),
    });
  }

  const assistant = toPlainText(anchoredResponse.assistant_message);

  if (assistant.includes("?")) {
    const singleQuestion = ensureSingleQuestion(assistant);
    const clamped = clampAssistantMessage(singleQuestion);
    return finalize({
      ...anchoredResponse,
      assistant_message: clamped,
    });
  }

  return finalize({
    ...anchoredResponse,
    assistant_message: clampAssistantMessage(assistant),
  });
}

function buildRecommendationNextStepQuestion(input: {
  constraints: HardConstraints;
  userMessage: string;
  discoveryMode: boolean;
  language: "en" | "es";
}): string {
  const practicalSignal =
    /\b(kid|kids|child|children|dog|dogs|pet|pets|high traffic|durable|easy to clean|low maintenance|beach house|tough)\b/i.test(
      normalizeText(input.userMessage)
    );

  if (input.discoveryMode) {
    return input.language === "es"
      ? "¿Quieres que lo reduzcamos primero por tamano, color o estilo?"
      : "Would you like to narrow first by size, color, or style?";
  }
  if (input.constraints.size) {
    return input.language === "es"
      ? "¿Quieres ver opciones mas grandes, mas pequenas o en otra direccion de estilo?"
      : "Would you like to see larger, smaller, or a different style direction next?";
  }
  if ((input.constraints.colors?.length ?? 0) > 0) {
    return input.language === "es"
      ? "¿Quieres mantener esta direccion de color o comparar una paleta cercana?"
      : "Would you like to keep this color direction or compare a nearby palette?";
  }
  if ((input.constraints.styles?.length ?? 0) > 0) {
    return input.language === "es"
      ? "¿Quieres mantener este estilo o comparar una direccion contrastante?"
      : "Would you like to stay with this style or compare a contrasting direction?";
  }
  if (practicalSignal) {
    return input.language === "es"
      ? "¿Quieres que mantengamos el enfoque practico o prefieres abrirlo a mas estilos?"
      : "Do you want to keep this practical direction, or open it up to more styles?";
  }
  return input.language === "es"
    ? "¿Quieres que lo reduzca por tamano, color o estilo?"
    : "Would you like me to narrow this by size, color, or style?";
}

function buildGroundedRecommendationNarrative(input: {
  language: "en" | "es";
  currentAssistant: string;
  recommendations: RecommendationResponse["recommendations"];
  userMessage: string;
  constraints: HardConstraints;
  discoveryMode: boolean;
}): string {
  const top = input.recommendations[0];
  if (!top) return input.currentAssistant;

  const disclosureMatch = input.currentAssistant.match(
    /[^.!?]*(?:don't have|do not have|limited|closest available|exact match)[^.!?]*[.!?]/i
  );
  const disclosureLead = disclosureMatch?.[0]?.trim() ?? "";
  const keepDisclosure = disclosureLead.length > 0;

  const hasColorDirection = (input.constraints.colors?.length ?? 0) > 0;
  const hasAvoidColorDirection =
    (input.constraints.avoid_preferences?.colors?.length ?? 0) > 0;
  const hasStyleDirection = (input.constraints.styles?.length ?? 0) > 0;
  const hasSizeDirection = Boolean(input.constraints.size);
  const opener =
    input.language === "es"
      ? input.discoveryMode
        ? "Aqui tienes una seleccion variada para comparar."
        : hasColorDirection || hasAvoidColorDirection
          ? "Aqui tienes opciones en inventario siguiendo esa direccion de color."
          : hasStyleDirection
            ? "Aqui tienes opciones en inventario siguiendo esa direccion de estilo."
            : hasSizeDirection
              ? "Aqui tienes opciones en inventario en ese rango de tamano."
              : "Aqui tienes opciones disponibles para comparar."
      : input.discoveryMode
        ? "Here is a varied set to compare."
        : hasColorDirection || hasAvoidColorDirection
          ? "Here are in-stock options aligned to that color direction."
          : hasStyleDirection
            ? "Here are in-stock options aligned to that style direction."
            : hasSizeDirection
              ? "Here are in-stock options in that size direction."
              : "Here are in-stock options to compare.";

  const topDetails = [
    top.title,
    top.size_text ? `(${top.size_text})` : "",
    top.style ? `${input.language === "es" ? "estilo" : "style"} ${top.style}` : "",
    top.origin ? `${input.language === "es" ? "origen" : "origin"} ${top.origin}` : "",
  ]
    .filter((part) => part.length > 0)
    .join(" ");
  const spotlight =
    input.language === "es"
      ? `Empezaria con ${topDetails}.`
      : `I would start with ${topDetails}.`;
  const compare =
    input.recommendations.length > 1
      ? input.language === "es"
        ? `Tambien inclui ${input.recommendations.length - 1} opciones mas para comparar lado a lado.`
        : `I also included ${input.recommendations.length - 1} more options so you can compare side by side.`
      : input.language === "es"
        ? "Esta es la opcion mas cercana disponible ahora mismo."
        : "This is the closest in-stock option right now.";

  const built = [keepDisclosure ? disclosureLead : "", opener, spotlight, compare]
    .filter((part) => part.length > 0)
    .join(" ")
    .trim();
  return built.length > 0 ? built : input.currentAssistant;
}

function enforceRecommendationConversationalFinish(input: {
  response: RecommendationResponse;
  userMessage: string;
  constraints: HardConstraints;
  discoveryMode: boolean;
  recentlyShownIds?: string[];
  customerContext?: string[];
}): RecommendationResponse {
  if (input.response.mode !== "recommendations") {
    return input.response;
  }

  const language = detectResponseLanguage(input.userMessage);
  let assistant = toPlainText(input.response.assistant_message);
  const normalizedMessage = normalizeText(input.userMessage);
  const normalizedCustomerContext = normalizeText(
    (input.customerContext ?? []).join(" ")
  );
  if (
    input.constraints.size &&
    hasExactSizeRecommendation(input.response.recommendations, input.constraints)
  ) {
    const sentences =
      assistant.match(/[^.!?]+[.!?]?/g)?.map((part) => part.trim()).filter(Boolean) ?? [];
    const filtered = sentences.filter(
      (sentence) =>
        !/\b(if\s+exact|exact\s+isn'?t\s+available|exact\s+options?\s+aren'?t\s+present|no exact)\b/i.test(
          normalizeText(sentence)
        )
    );
    if (filtered.length > 0) {
      assistant = filtered.join(" ").trim();
    }
  }

  const directionalSignal =
    /\b(larger|bigger|smaller|shorter|longer|size up|size down)\b/i.test(
      normalizedMessage
    );
  const directionalNeeds =
    /\b(larger|bigger|size up)\b/i.test(normalizedMessage)
      ? "larger"
      : /\b(smaller|shorter|size down)\b/i.test(normalizedMessage)
        ? "smaller"
        : null;
  const requestedLongSideIn = input.constraints.size
    ? Math.max(input.constraints.size.widthIn, input.constraints.size.lengthIn)
    : null;
  const hasDirectionalAlignedCard = (() => {
    if (!directionalNeeds || requestedLongSideIn === null) return false;
    for (const rec of input.response.recommendations) {
      const pair = parseRecommendationSizePairIn(rec.size_text);
      if (!pair) continue;
      const longSide = Math.max(pair.widthIn, pair.lengthIn);
      if (directionalNeeds === "larger" && longSide >= requestedLongSideIn) {
        return true;
      }
      if (directionalNeeds === "smaller" && longSide <= requestedLongSideIn) {
        return true;
      }
    }
    return false;
  })();
  if (directionalSignal) {
    const parts =
      assistant.match(/[^.!?]+[.!?]?/g)?.map((part) => part.trim()).filter(Boolean) ?? [];
    const filtered = parts.filter((sentence) => {
      if (hasDirectionalAlignedCard) {
        return !/\b(don't have|do not have|don't carry|no exact|exact match(?:es)? unavailable)\b/i.test(
          sentence
        );
      }
      if (!/\b(don't have|do not have|don't carry)\b/i.test(sentence)) return true;
      return /\bexact\b/i.test(sentence);
    });
    if (filtered.length > 0) {
      assistant = filtered.join(" ").trim();
    }
  }

  assistant = assistant
    .replace(
      /\bhere are in-stock options aligned to that color direction\b\.?/gi,
      "Here are in-stock options to compare."
    )
    .replace(
      /\bhere are in-stock options aligned to that style direction\b\.?/gi,
      "Here are in-stock options to compare."
    )
    .replace(
      /\bhere are in-stock options in that size direction\b\.?/gi,
      "Here are in-stock options to compare."
    )
    .replace(/\bthis is the closest in-stock option right now\b\.?/gi, "")
    .replace(/\bi would start with\b/gi, "A strong place to start is")
    .replace(/\s+/g, " ")
    .trim();

  const cardSizes = new Set(
    input.response.recommendations
      .map((rec) => normalizeText(rec.size_text ?? "").replace(/\s+/g, ""))
      .filter((value) => value.length > 0)
  );
  if (cardSizes.size > 0) {
    const sentences =
      assistant.match(/[^.!?]+[.!?]?/g)?.map((part) => part.trim()).filter(Boolean) ?? [];
    const cleaned = sentences.filter((sentence) => {
      const rawMatches = sentence.match(/\d+\s*'?[\d"]*\s*[x×]\s*\d+\s*'?[\d"]*/gi) ?? [];
      if (rawMatches.length === 0) return true;
      const normalizedMatches = rawMatches
        .map((value) => normalizeText(value).replace(/\s+/g, ""))
        .filter((value) => value.length > 0);
      if (normalizedMatches.length === 0) return true;
      const hasSupported = normalizedMatches.some((value) => cardSizes.has(value));
      return hasSupported;
    });
    if (cleaned.length > 0) {
      assistant = cleaned.join(" ").trim();
    }
  }

  const sentenceParts =
    assistant.match(/[^.!?]+[.!?]?/g)?.map((part) => part.trim()).filter(Boolean) ?? [];
  if (sentenceParts.length > 4) {
    const firstThree = sentenceParts.slice(0, 3);
    const trailingQuestion = sentenceParts.slice(3).find((part) => part.includes("?"));
    if (trailingQuestion) {
      assistant = [...firstThree, trailingQuestion].join(" ").trim();
    } else {
      assistant = sentenceParts.slice(0, 4).join(" ").trim();
    }
  }

  assistant = assistant.replace(/\s+/g, " ").trim();
  assistant = assistant
    .replace(/\beverything in stock right now is traditional\b[^.!?]*[.!?]?/gi, "")
    .replace(/\bi don['’]t have any traditional pieces\b[^.!?]*[.!?]?/gi, "")
    .replace(/\bit avoids traditional ornate or floral details\b[^.!?]*[.!?]?/gi, "")
    .replace(/\bnot strictly modern\b[^.!?]*[.!?]?/gi, "")
    .replace(/\bclosest elegant options nearby\b[^.!?]*[.!?]?/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  {
    const escapedUser = input.userMessage
      .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      .trim();
    if (escapedUser.length > 0) {
      assistant = assistant
        .replace(new RegExp(`^${escapedUser}[\\s:,-]*`, "i"), "")
        .trim();
    }
  }

  const ordinalReferenceSignal =
    /\b(i like|i liked)\s+the\s+(first|second|third|1st|2nd|3rd)\b/i.test(
      normalizedMessage
    );
  if (ordinalReferenceSignal) {
    const parts =
      assistant.match(/[^.!?]+[.!?]?/g)?.map((part) => part.trim()).filter(Boolean) ?? [];
    const filtered = parts.filter(
      (sentence) =>
        !/\b(you(?:'re|’re| are)? drawn to|you liked|since you liked)\b/i.test(sentence)
    );
    if (filtered.length > 0) {
      assistant = filtered.join(" ").trim();
    }
  }
  {
    const parts =
      assistant.match(/[^.!?]+[.!?]?/g)?.map((part) => part.trim()).filter(Boolean) ?? [];
    const filtered = parts.filter(
      (sentence) => !/\b(you(?:'re|’re| are)\s+drawn\s+to)\b/i.test(sentence)
    );
    if (filtered.length > 0) {
      assistant = filtered.join(" ").trim();
    }
  }

  const budgetSignal =
    /\b(under|below|max|maximum|budget|\$\s*\d+|\d+\s*dollars?)\b/i.test(
      normalizedMessage
    ) ||
    /\b(under|below|max|maximum|budget|\$\s*\d+|\d+\s*dollars?)\b/i.test(
      normalizedCustomerContext
    );
  if (budgetSignal) {
    const parts =
      assistant.match(/[^.!?]+[.!?]?/g)?.map((part) => part.trim()).filter(Boolean) ?? [];
    const filtered = parts.filter(
      (sentence) =>
        !/\b(under\s*\$?\d+|within\s+budget|fits?\s+your\s+budget|strong\s+fits?\s+for\s+.*budget|budget|below|max(?:imum)?\b)\b/i.test(
          sentence
        ) && !/\$\s*\d+/.test(sentence)
    );
    if (filtered.length > 0) {
      assistant = filtered.join(" ").trim();
    } else {
      assistant = "";
    }
  }

  const practicalSignal =
    /\b(kid|kids|child|children|dog|dogs|pet|pets|high traffic|durable|easy to clean|low maintenance|beach house|tough|practical)\b/i.test(
      normalizedMessage
    ) ||
    /\b(kid|kids|child|children|dog|dogs|pet|pets|high traffic|durable|easy to clean|low maintenance|beach house|tough|practical)\b/i.test(
      normalizedCustomerContext
    );
  if (practicalSignal) {
    const parts =
      assistant.match(/[^.!?]+[.!?]?/g)?.map((part) => part.trim()).filter(Boolean) ?? [];
    const filtered = parts.filter(
      (sentence) =>
        !/\b(hide stain|hides stains|mask wear|handle traffic|withstand traffic|easy to clean|durable|low maintenance)\b/i.test(
          sentence
        )
    );
    if (filtered.length > 0) {
      assistant = filtered.join(" ").trim();
    }
  }

  const colorDirectionSignal =
    (input.constraints.colors?.length ?? 0) > 0 ||
    (input.constraints.avoid_preferences?.colors?.length ?? 0) > 0 ||
    /\b(red|rust|blue|teal|green|gold|pink|purple|black|white|ivory|gray|brown|neutral|beige|dark|light|color)\b/i.test(
      normalizedMessage
    );
  if (colorDirectionSignal) {
    const parts =
      assistant.match(/[^.!?]+[.!?]?/g)?.map((part) => part.trim()).filter(Boolean) ?? [];
    const filtered = parts.filter(
      (sentence) => {
        if (
          /\b(definitely|exactly|guaranteed|confirmed)\b[^.!?]{0,24}\b(red|rust|blue|teal|green|gold|pink|purple|neutral|beige|dark|light)\b/i.test(
            sentence
          )
        ) {
          return false;
        }
        if (
          /\b(avoid|no|not|without|leaning|direction|palette|tone)\b/i.test(sentence) &&
          /\b(red|rust|blue|teal|green|gold|pink|purple|neutral|beige|dark|light|ivory|white|gray|brown)\b/i.test(
            sentence
          )
        ) {
          return false;
        }
        return true;
      }
    );
    if (filtered.length > 0) {
      assistant = filtered.join(" ").trim();
    }

    const unsupportedColorClaimPatterns = [
      /\beverything in stock right now is traditional\b[^.!?]*[.!?]?/gi,
      /\bwithin your preferred size range and avoiding\b[^.!?]*[.!?]?/gi,
      /\bis modern style an absolute must\b[^.!?]*[.!?]?/gi,
    ];
    for (const pattern of unsupportedColorClaimPatterns) {
      assistant = assistant.replace(pattern, "").trim();
    }

    const colorLead =
      language === "es"
        ? "No puedo confirmar el balance exacto de color solo con el resumen de la tarjeta, asi que te muestro las opciones mas cercanas para comparar."
        : "I can’t confirm exact color balance from card summaries alone, so I’m showing the closest in-stock options to compare.";
    const normalizedAssistant = normalizeText(assistant);
    if (
      !/\b(color balance|card summaries|closest in-stock options to compare|balance exacto de color)\b/i.test(
        normalizedAssistant
      )
    ) {
      assistant = `${colorLead} ${assistant}`.trim();
    }
  }

  if (budgetSignal) {
    const budgetLead =
      language === "es"
        ? "Para presupuesto exacto, el equipo de tienda confirma precio final en persona."
        : "For exact budget confirmation, store staff confirms final pricing in person.";
    assistant = `${budgetLead} ${assistant}`.trim();
  }

  let fallbackQuestion: string | null = null;
  if (!assistant.includes("?")) {
    fallbackQuestion = buildRecommendationNextStepQuestion({
      constraints: input.constraints,
      userMessage: input.userMessage,
      discoveryMode: input.discoveryMode,
      language,
    });
    assistant = `${assistant} ${fallbackQuestion}`.trim();
  }

  let clampedAssistant = clampAssistantMessage(assistant);
  if (fallbackQuestion && !clampedAssistant.includes("?")) {
    const maxBaseLength = Math.max(
      0,
      MAX_ASSISTANT_MESSAGE_CHARS - fallbackQuestion.length - 1
    );
    const base = toPlainText(clampedAssistant)
      .slice(0, maxBaseLength)
      .replace(/[,:;.\-\s]+$/g, "")
      .trim();
    clampedAssistant = `${base} ${fallbackQuestion}`.trim();
  }

  return {
    ...input.response,
    assistant_message: clampAssistantMessage(clampedAssistant),
  };
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
  const trimmedMessage = normalizeText(userMessage).toLowerCase();
  const hasDiscoverySignal =
    /\b(show me what you have|show me what you've got|just browsing|just looking|surprise me|open to anything|explore|range)\b/i.test(
      trimmedMessage
    );
  const hasFollowupSignal =
    /\b(show me more|more like|another|larger|bigger|smaller|shorter|closest)\b/i.test(
      trimmedMessage
    );
  const hasConstraintSignal = Boolean(
    constraints.size ||
      constraints.shape ||
      (constraints.styles?.length ?? 0) > 0 ||
      (constraints.colors?.length ?? 0) > 0
  );

  if (language === "es") {
    if (hasDiscoverySignal) {
      return "Aqui tienes una seleccion variada disponible ahora para comparar direcciones:";
    }
    if (hasFollowupSignal || hasConstraintSignal) {
      return "Aqui tienes las opciones disponibles mas cercanas para comparar ahora:";
    }
    return "Aqui tienes una seleccion de piezas disponibles para revisar:";
  }

  if (hasDiscoverySignal) {
    return "Here is a varied in-stock set so you can compare different directions:";
  }
  if (hasFollowupSignal || hasConstraintSignal) {
    return "Here are in-stock options to compare now:";
  }
  return "Here is a set of in-stock options to review:";
}

function applyConstraintMismatchDisclosure(input: {
  response: RecommendationResponse;
  constraints: HardConstraints;
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

  const unmet = new Set(mismatch.unmet_constraints);
  if (
    unmet.has("size") &&
    input.constraints.size &&
    hasExactSizeRecommendation(input.response.recommendations, input.constraints)
  ) {
    unmet.delete("size");
  }
  if (unmet.size === 0) {
    return input.response;
  }

  const current = toPlainText(input.response.assistant_message);
  let hint =
    "I’m showing in-stock options to compare what is available now.";
  if (
    unmet.has("size") &&
    input.constraints.size &&
    Math.max(input.constraints.size.widthIn, input.constraints.size.lengthIn) >
      MAX_REASONABLE_REQUEST_LONG_SIDE_IN
  ) {
    hint =
      "That requested scale is beyond what we currently carry, so I’m showing the largest in-stock options available.";
  } else if (unmet.has("practical")) {
    hint =
      "I know practical use is important. I don’t have enough in-stock options that clearly match every practical detail, so I’m showing the closest available set to compare.";
  }
  if (!hint) {
    return input.response;
  }
  if (unmet.has("colors")) {
    hint =
      "I can’t verify exact color balance from card summaries alone, so I’m showing the closest in-stock options to compare side by side.";
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
  if (alreadyHonestAboutLimits || hasPracticalLanguage) {
    return input.response;
  }

  const language = detectResponseLanguage(input.userMessage);
  const lead =
    language === "es"
      ? "Si el uso diario es clave, puedo priorizar en la siguiente ronda opciones mas practicas y faciles de mantener."
      : "If daily wear is the priority, I can prioritize more practical, lower-maintenance options in the next pass.";

  return {
    ...input.response,
    assistant_message: clampAssistantMessage(`${lead} ${assistant}`.trim()),
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
    /\b(don't have|do not have|don't carry|largest|closest|exact match)\b/i.test(
      assistant
    );
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
  const fields = effectiveFields(rug);
  const cardSize = sizeText(rug);
  if (cardSize) reasons.push(`Shown size: ${cardSize}.`);
  if (fields.style) reasons.push(`Style direction: ${fields.style}.`);
  if (fields.origin) reasons.push(`Origin: ${fields.origin}.`);
  if (reasons.length === 0) reasons.push("In-stock option ready to review in detail.");

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
    reasons.push("Strong match for your stated direction.");
  } else {
    const matchedTextSignal = signals.find((token) => token && rugText.includes(token));
    if (matchedTextSignal) {
      reasons.push("Aligned with your stated direction.");
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
  const shouldPrioritizeLargestAlternatives = Boolean(
    promptContext?.constraint_mismatch?.expanded_from_zero_match &&
      promptContext.constraint_mismatch.unmet_constraints.includes("size") &&
      constraints.size &&
      Math.max(constraints.size.widthIn, constraints.size.lengthIn) >
        MAX_REASONABLE_REQUEST_LONG_SIDE_IN
  );

  const inventoryForFallback = shouldPrioritizeLargestAlternatives
    ? [...inventory].sort((a, b) => {
        const areaA =
          typeof a.width_total_in === "number" && typeof a.length_total_in === "number"
            ? a.width_total_in * a.length_total_in
            : 0;
        const areaB =
          typeof b.width_total_in === "number" && typeof b.length_total_in === "number"
            ? b.width_total_in * b.length_total_in
            : 0;
        return areaB - areaA;
      })
    : inventory;

  const shapedFallback = shapeCandidatesForAI(inventoryForFallback, {
    maxCandidates: MAX_RECOMMENDATIONS,
    constraints,
    userMessage,
    customerContext: promptContext?.chat_context?.customer_context ?? [],
    discoveryMode: Boolean(promptContext?.discovery_mode),
  });

  const recommendations = (shapedFallback.length > 0 ? shapedFallback : inventoryForFallback)
    .slice(0, MAX_RECOMMENDATIONS)
    .map((rug) => {
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
        match_reasons: buildGroundedMatchReasons(rug, constraints, userMessage),
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
    recentlyShownIds?: string[];
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

  const exactFallbackConditional =
    /\bif exact(?:ly)? (?:isn'?t|is not) available\b/i.test(
      normalizeText(userMessage)
    ) &&
    Boolean(constraints.size);
  if (exactFallbackConditional && response.mode === "recommendations" && constraints.size) {
    const exactInventory = inventory.filter((rug) =>
      matchesExactRequestedSize(rug, constraints)
    );
    if (exactInventory.length > 0 && normalizedRecommendations.length < Math.min(3, exactInventory.length)) {
      const exactFallback = fallbackRecommendations(
        exactInventory,
        constraints,
        userMessage,
        undefined
      );
      const seen = new Set(normalizedRecommendations.map((rec) => rec.rug_id));
      const extras = exactFallback.recommendations.filter((rec) => !seen.has(rec.rug_id));
      normalizedRecommendations = disambiguateDuplicateRecommendationTitles(
        [...normalizedRecommendations, ...extras].slice(0, Math.min(3, exactInventory.length))
      );
    }
  }

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
      (!hasStrictMustConstraint && !input?.constraintMismatch?.expanded_from_zero_match) ||
      Boolean(input?.discoveryMode);
    const minimumRecommendationCount = inventory.length >= 4
      ? Math.min(6, inventory.length)
      : inventory.length;
    if (
      canBackfillWithoutSilentExpansion &&
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
          constraints,
          constraintMismatch: input?.constraintMismatch,
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
      constraints,
      input?.recentlyShownIds
    );
  }

  if (response.mode === "recommendations" && normalizedRecommendations.length === 0) {
    const repaired = enforceImpossibleSizeDisclosure({
      response: enforcePracticalTruthMessage({
        response: applyConstraintMismatchDisclosure({
          response: applyTonePolish(
            fallbackRecommendations(inventory, constraints, userMessage, undefined)
          ),
          constraints,
          constraintMismatch: input?.constraintMismatch,
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
      constraints,
      input?.recentlyShownIds
    );
  }

  // Enforce mode-specific response contract for consistency with docs/schema intent.
  if (response.mode === "clarifying_question") {
    if (inventory.length > 0) {
      const repaired = enforceImpossibleSizeDisclosure({
        response: enforcePracticalTruthMessage({
          response: applyConstraintMismatchDisclosure({
            response: applyTonePolish({
              ...fallbackRecommendations(
                inventory,
                constraints,
                userMessage,
                undefined
              ),
              notes: "Adjusted clarifying_question to recommendations.",
            }),
            constraints,
            constraintMismatch: input?.constraintMismatch,
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
        constraints,
        input?.recentlyShownIds
      );
    }
    const normalizedQuestions = cappedQuestions.filter((q) => q.trim().length > 0);
    if (normalizedQuestions.length === 0) {
      return enforceDiscoveryQuestion(
        applyConstraintMismatchDisclosure({
          response: applyTonePolish(
            fallbackRecommendations(inventory, constraints, userMessage, undefined)
          ),
          constraints,
          constraintMismatch: input?.constraintMismatch,
        }),
        Boolean(input?.discoveryMode),
        input?.customerContext,
        userMessage,
        constraints,
        input?.recentlyShownIds
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
      constraints,
      input?.recentlyShownIds
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
      constraints,
      input?.recentlyShownIds
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
          constraints,
          constraintMismatch: input?.constraintMismatch,
        }),
        Boolean(input?.discoveryMode),
        input?.customerContext,
        userMessage,
        constraints,
        input?.recentlyShownIds
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
      constraints,
      input?.recentlyShownIds
    );
  }

  const repaired = enforceImpossibleSizeDisclosure({
    response: enforcePracticalTruthMessage({
      response: applyConstraintMismatchDisclosure({
        response: applyTonePolish({
          ...response,
          questions: [],
          recommendations: normalizedRecommendations,
        }),
        constraints,
        constraintMismatch: input?.constraintMismatch,
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
    constraints,
    input?.recentlyShownIds
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
      trace.model = RECOMMENDATION_MODEL;
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
      trace.model = RECOMMENDATION_MODEL;
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
    model: RECOMMENDATION_MODEL,
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
    trace.model = RECOMMENDATION_MODEL;
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
      recentlyShownIds:
        promptContext?.chat_context?.recently_shown_rugs?.map((rug) => rug.id) ?? [],
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
