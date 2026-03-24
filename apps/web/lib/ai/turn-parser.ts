import { getRecommendationPromptBundle } from "@/lib/ai/prompt-library";
import {
  detectIncompleteResponsePayload,
  normalizeText,
  postOpenAiResponses,
  toPreviewText,
} from "@/lib/ai/response-quality";
import {
  parsedTurnSchema,
  type ParsedTurn,
  TURN_PARSER_JSON_SCHEMA,
} from "@/lib/chat/turn-parser-contract";
import {
  extractConstraintsFromUserMessage,
} from "@/lib/filters/extract-constraints";
import { normalizeColorList } from "@/lib/config/color-taxonomy";
import { extractStableFactsFromUserMessage } from "@/lib/chat/memory";
import {
  OPENAI_API_KEY,
  OPENAI_CHAT_MODEL,
} from "@/lib/config";

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";

export type TurnParserTrace = {
  called: boolean;
  model: string;
  request_payload: unknown | null;
  response_status: number | null;
  response_payload: unknown | null;
  parsed: ParsedTurn | null;
  fallback_reason: string | null;
  error: string | null;
  incomplete_detected: boolean;
  latency_ms: number | null;
};

export type ParseTurnInput = {
  message: string;
  context: {
    last_result_mode?:
      | "recommendation"
      | "no_match"
      | "clarifying_question"
      | "disambiguation"
      | null;
    has_recent_recommendations?: boolean;
    recently_shown_rugs?: Array<{
      id: string;
      label: string;
      colors: string[];
      style: string | null;
      origin: string | null;
    }>;
  };
  trace?: TurnParserTrace;
};

function parseOutputText(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const data = payload as Record<string, unknown>;

  if (typeof data.output_text === "string" && data.output_text.trim().length > 0) {
    return data.output_text;
  }

  if (!Array.isArray(data.output)) return null;
  for (const outputItem of data.output) {
    if (!outputItem || typeof outputItem !== "object") continue;
    const item = outputItem as Record<string, unknown>;
    if (!Array.isArray(item.content)) continue;
    for (const part of item.content) {
      if (!part || typeof part !== "object") continue;
      const block = part as Record<string, unknown>;
      if (typeof block.text === "string" && block.text.trim().length > 0) {
        return block.text;
      }
      if (block.json && typeof block.json === "object") {
        return JSON.stringify(block.json);
      }
    }
  }

  return null;
}

function normalizeParsedTurn(input: ParsedTurn): ParsedTurn {
  const colors = normalizeColorList(input.constraints.colors ?? [], 8);
  const styles = (input.constraints.styles ?? [])
    .map((style) => normalizeText(style).slice(0, 48))
    .filter((style) => style.length > 0)
    .slice(0, 8);
  const sessionFacts = (input.session_facts ?? [])
    .map((fact) => normalizeText(fact).slice(0, 120))
    .filter((fact) => fact.length > 0)
    .slice(0, 12);
  const referencedRugId =
    typeof input.referenced_rug_id === "string" &&
    normalizeText(input.referenced_rug_id).length > 0
      ? normalizeText(input.referenced_rug_id).slice(0, 80)
      : undefined;

  return {
    ...input,
    constraints: {
      ...input.constraints,
      colors,
      styles,
    },
    avoid: {
      colors: normalizeColorList(input.avoid.colors ?? [], 8),
      styles: (input.avoid.styles ?? [])
        .map((style) => normalizeText(style).slice(0, 48))
        .filter((style) => style.length > 0)
        .slice(0, 8),
      shapes: (input.avoid.shapes ?? []).slice(0, 4),
    },
    session_facts: sessionFacts,
    referenced_rug_id: referencedRugId,
    rug_reference_ambiguous: Boolean(input.rug_reference_ambiguous),
  };
}

function applyConfidenceHeuristic(input: {
  message: string;
  parsed: ParsedTurn;
}): ParsedTurn["confidence"] {
  const parsed = input.parsed;
  const inferred = extractConstraintsFromUserMessage(input.message);
  const hasHardConstraint = Boolean(
    parsed.constraints.size ||
      (parsed.constraints.colors?.length ?? 0) > 0 ||
      (parsed.constraints.styles?.length ?? 0) > 0 ||
      parsed.constraints.shape ||
      inferred.size ||
      (inferred.colors?.length ?? 0) > 0 ||
      (inferred.styles?.length ?? 0) > 0 ||
      inferred.shape
  );
  if (!hasHardConstraint) {
    return "low";
  }

  const explicitRequestLanguage =
    /\b(show|find|need|want|looking for|must|exactly|around|closest|larger|smaller)\b/i.test(
      input.message
    );
  if (explicitRequestLanguage) {
    return "high";
  }

  if (parsed.confidence === "low") {
    return "medium";
  }
  return parsed.confidence;
}

function normalizeRugReferenceInput(input: ParseTurnInput["context"]["recently_shown_rugs"]): Array<{
  id: string;
  label: string;
  colors: string[];
  style: string | null;
  origin: string | null;
}> {
  if (!Array.isArray(input)) return [];
  return input
    .filter((rug): rug is NonNullable<typeof input>[number] => Boolean(rug))
    .map((rug) => ({
      id: normalizeText(rug.id ?? "").slice(0, 80),
      label: normalizeText(rug.label ?? "").slice(0, 120),
      colors: Array.isArray(rug.colors)
        ? rug.colors.map((color) => normalizeText(color)).filter(Boolean).slice(0, 6)
        : [],
      style: rug.style ? normalizeText(rug.style).slice(0, 60) : null,
      origin: rug.origin ? normalizeText(rug.origin).slice(0, 60) : null,
    }))
    .filter((rug) => rug.id.length > 0);
}

function resolveReferencedRug(input: {
  message: string;
  recentlyShown: Array<{
    id: string;
    label: string;
    colors: string[];
    style: string | null;
    origin: string | null;
  }>;
}): { referenced_rug_id?: string; rug_reference_ambiguous: boolean } {
  const message = normalizeText(input.message.toLowerCase());
  const rugs = input.recentlyShown;
  if (!message || rugs.length === 0) {
    return { rug_reference_ambiguous: false };
  }

  const hasReferenceLanguage = /\b(that|this|the|one|rug|first|second|third|fourth)\b/.test(
    message
  );
  if (!hasReferenceLanguage) {
    return { rug_reference_ambiguous: false };
  }

  const ordinalIndex =
    /\bfirst|1st\b/.test(message)
      ? 0
      : /\bsecond|2nd\b/.test(message)
        ? 1
        : /\bthird|3rd\b/.test(message)
          ? 2
          : /\bfourth|4th\b/.test(message)
            ? 3
            : -1;
  if (ordinalIndex >= 0 && rugs[ordinalIndex]) {
    return {
      referenced_rug_id: rugs[ordinalIndex].id,
      rug_reference_ambiguous: false,
    };
  }

  const scored = rugs
    .map((rug) => {
      let score = 0;
      if (message.includes(rug.id.toLowerCase())) score += 8;
      if (rug.label && message.includes(rug.label.toLowerCase())) score += 6;
      for (const color of rug.colors) {
        if (color && message.includes(color.toLowerCase())) score += 2;
      }
      if (rug.style && message.includes(rug.style.toLowerCase())) score += 2;
      if (rug.origin && message.includes(rug.origin.toLowerCase())) score += 2;
      return { id: rug.id, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) {
    if (/\b(that one|the one|that rug|this rug)\b/.test(message) && rugs.length > 1) {
      return { rug_reference_ambiguous: true };
    }
    return { rug_reference_ambiguous: false };
  }

  if (scored.length > 1 && scored[0].score === scored[1].score) {
    return { rug_reference_ambiguous: true };
  }

  return {
    referenced_rug_id: scored[0].id,
    rug_reference_ambiguous: false,
  };
}

function fallbackParsedTurn(input: ParseTurnInput): ParsedTurn {
  const message = input.message.toLowerCase();
  const inferred = extractConstraintsFromUserMessage(input.message);
  const hasConstraintSignals = Boolean(
    inferred.size ||
      (inferred.colors && inferred.colors.length > 0) ||
      (inferred.styles && inferred.styles.length > 0) ||
      inferred.shape
  );

  const hasFollowup =
    /\b(show more|more like this|closest|nearest|larger|bigger|smaller|size down|size up)\b/i.test(
      message
    ) ||
    (/^(yes|yeah|yep|sure)\b/i.test(message) &&
      Boolean(input.context.has_recent_recommendations));

  const isDiscoveryIntent =
    !hasConstraintSignals &&
    /\b(show me what you have|show me what you've got|surprise me|just browsing|just looking|anything interesting|open to anything|show options|show me options)\b/i.test(
      message
    );
  const hasShoppingIntent =
    /\b(show|find|recommend|need|want|looking for|search|browse|options|inventory)\b/i.test(
      message
    );
  const isAdviceIntent =
    /\b(what is|what's|tell me about|difference between|how do i|how to|care|clean)\b/i.test(
      message
    ) && !hasShoppingIntent;

  const mode: ParsedTurn["mode"] = isDiscoveryIntent
    ? "discovery"
    : hasFollowup
    ? "recommendation_followup"
    : isAdviceIntent
    ? "advice"
    : hasConstraintSignals ||
        /\b(show|find|recommend|need|want|looking for|search)\b/i.test(message)
      ? "recommendation"
      : "chat";

  const followupIntent: ParsedTurn["followup_intent"] =
    /\bclosest|nearest|best match\b/i.test(message)
      ? "closest"
      : /\blarger|bigger|size up\b/i.test(message)
        ? "larger"
        : /\bsmaller|size down\b/i.test(message)
          ? "smaller"
          : hasFollowup
            ? "more_like_this"
            : "none";

  const strictSize = /\b(exact|exactly|must fit|no bigger|can'?t exceed)\b/i.test(
    message
  );
  const strictColor = /\b(must be|only)\b/i.test(message) && Boolean(inferred.colors?.length);
  const strictStyle = /\b(must be|only)\b/i.test(message) && Boolean(inferred.styles?.length);
  const strictShape = /\b(must be|only)\b/i.test(message) && Boolean(inferred.shape);

  const normalizedRecentlyShown = normalizeRugReferenceInput(
    input.context.recently_shown_rugs
  );
  const referenceResolution = resolveReferencedRug({
    message: input.message,
    recentlyShown: normalizedRecentlyShown,
  });

  return normalizeParsedTurn(
    parsedTurnSchema.parse({
      mode,
      followup_intent: followupIntent,
      constraints: {
        size: inferred.size
          ? {
              widthIn: inferred.size.widthIn,
              lengthIn: inferred.size.lengthIn,
            }
          : null,
        colors: inferred.colors ?? [],
        styles: inferred.styles ?? [],
        shape: inferred.shape ?? null,
      },
      strictness: {
        size: strictSize ? "must" : "prefer",
        colors: strictColor ? "must" : "prefer",
        styles: strictStyle ? "must" : "prefer",
        shape: strictShape ? "must" : "prefer",
      },
      avoid: {
        colors: [],
        styles: [],
        shapes: [],
      },
      session_facts: extractStableFactsFromUserMessage(input.message).slice(0, 12),
      referenced_rug_id: referenceResolution.referenced_rug_id,
      rug_reference_ambiguous: referenceResolution.rug_reference_ambiguous,
      confidence: "low",
    })
  );
}

function initTrace(trace?: TurnParserTrace): TurnParserTrace | null {
  if (!trace) return null;
  trace.called = false;
  trace.model = OPENAI_CHAT_MODEL;
  trace.request_payload = null;
  trace.response_status = null;
  trace.response_payload = null;
  trace.parsed = null;
  trace.fallback_reason = null;
  trace.error = null;
  trace.incomplete_detected = false;
  trace.latency_ms = null;
  return trace;
}

export async function parseTurn(input: ParseTurnInput): Promise<ParsedTurn> {
  const trace = initTrace(input.trace);
  const prompts = getRecommendationPromptBundle();
  const startedAt = Date.now();

  const requestPayload = {
    model: OPENAI_CHAT_MODEL,
    input: [
      {
        role: "system",
        content: [
          {
            type: "input_text",
            text: prompts.system,
          },
          {
            type: "input_text",
            text: prompts.turnParser,
          },
        ],
      },
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: `User message:\n${input.message}\n\nContext:\n${JSON.stringify(
              {
                last_result_mode: input.context.last_result_mode ?? null,
                has_recent_recommendations:
                  input.context.has_recent_recommendations ?? false,
                recently_shown_rugs: normalizeRugReferenceInput(
                  input.context.recently_shown_rugs
                ).slice(0, 6),
              }
            )}`,
          },
        ],
      },
    ],
    max_output_tokens: 260,
    text: {
      format: {
        type: "json_schema",
        name: "turn_parser",
        schema: TURN_PARSER_JSON_SCHEMA,
        strict: true,
      },
    },
  };

  if (trace) {
    trace.called = true;
    trace.request_payload = {
      model: requestPayload.model,
      prompt_preview: toPreviewText(input.message, 140),
      context: input.context,
      max_output_tokens: requestPayload.max_output_tokens,
      schema_name: "turn_parser",
    };
  }

  const response = await postOpenAiResponses({
    url: OPENAI_RESPONSES_URL,
    apiKey: OPENAI_API_KEY,
    requestPayload,
    surface: "general_chat",
  });

  if (trace) {
    trace.response_status = response.response_status;
    trace.response_payload = response.response_payload;
    trace.error = response.error;
    trace.incomplete_detected = response.incomplete_detected;
    trace.latency_ms = Date.now() - startedAt;
  }

  if (!response.ok) {
    if (trace) trace.fallback_reason = "OpenAI request failed";
    const fallbackBase = fallbackParsedTurn(input);
    const fallback = {
      ...fallbackBase,
      confidence: applyConfidenceHeuristic({
        message: input.message,
        parsed: fallbackBase,
      }),
    } as ParsedTurn;
    if (trace) trace.parsed = fallback;
    return fallback;
  }

  const outputText = parseOutputText(response.response_payload);
  if (!outputText) {
    if (trace) trace.fallback_reason = "OpenAI response missing output text";
    const fallbackBase = fallbackParsedTurn(input);
    const fallback = {
      ...fallbackBase,
      confidence: applyConfidenceHeuristic({
        message: input.message,
        parsed: fallbackBase,
      }),
    } as ParsedTurn;
    if (trace) trace.parsed = fallback;
    return fallback;
  }

  try {
    const parsed = JSON.parse(outputText) as unknown;
    const baseParsed = normalizeParsedTurn(parsedTurnSchema.parse(parsed));
    const referenceResolution = resolveReferencedRug({
      message: input.message,
      recentlyShown: normalizeRugReferenceInput(input.context.recently_shown_rugs),
    });
    const normalized = {
      ...baseParsed,
      confidence: applyConfidenceHeuristic({
        message: input.message,
        parsed: baseParsed,
      }),
      referenced_rug_id:
        referenceResolution.referenced_rug_id ?? baseParsed.referenced_rug_id,
      rug_reference_ambiguous:
        referenceResolution.rug_reference_ambiguous ||
        baseParsed.rug_reference_ambiguous,
    };
    if (trace) trace.parsed = normalized;
    return normalized;
  } catch {
    if (trace) {
      trace.fallback_reason = detectIncompleteResponsePayload(response.response_payload)
        ? "OpenAI response incomplete"
        : "OpenAI response parsing failed";
    }
    const fallbackBase = fallbackParsedTurn(input);
    const fallback = {
      ...fallbackBase,
      confidence: applyConfidenceHeuristic({
        message: input.message,
        parsed: fallbackBase,
      }),
    } as ParsedTurn;
    if (trace) trace.parsed = fallback;
    return fallback;
  }
}
