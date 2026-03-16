import type {
  ChatMode,
  RoleType,
} from "@/lib/chat/types";

type RouteTurnModeInput = {
  message: string;
  role: RoleType;
  last_mode?: ChatMode | null;
  last_result_mode?: "recommendation" | "no_match" | "clarifying_question" | null;
  has_recent_recommendations?: boolean;
};

export type RecommendationFollowupIntent =
  | "none"
  | "closest"
  | "larger"
  | "smaller"
  | "more_like_this"
  | "tighten";

export type RouteDecision = {
  mode: ChatMode;
  rule_id:
    | "EXPLICIT_RECOMMENDATION_REQUEST"
    | "RECOMMENDATION_FOLLOWUP"
    | "GENERAL_ADVICE_OR_EDUCATION"
    | "AMBIGUOUS_WITH_CONSTRAINTS_ONLY"
    | "DEFAULT_GENERAL_CHAT";
  confidence: "high" | "medium" | "low";
  needs_clarification: boolean;
};

type RouteRule = {
  id: RouteDecision["rule_id"];
  when: (input: RouteTurnModeInput, text: string) => boolean;
  decide: (input: RouteTurnModeInput, text: string) => Omit<RouteDecision, "rule_id">;
};

export const ROUTE_RULE_PRECEDENCE: RouteDecision["rule_id"][] = [
  "EXPLICIT_RECOMMENDATION_REQUEST",
  "RECOMMENDATION_FOLLOWUP",
  "GENERAL_ADVICE_OR_EDUCATION",
  "AMBIGUOUS_WITH_CONSTRAINTS_ONLY",
  "DEFAULT_GENERAL_CHAT",
];

const ROUTE_RULES: RouteRule[] = [
  {
    id: "EXPLICIT_RECOMMENDATION_REQUEST",
    when: (_input, text) => isExplicitRecommendationRequest(text),
    decide: () => ({
      mode: "recommendation",
      confidence: "high",
      needs_clarification: false,
    }),
  },
  {
    id: "RECOMMENDATION_FOLLOWUP",
    when: (input, text) =>
      parseRecommendationFollowupIntent(text) !== "none" &&
      (input.last_mode === "recommendation" ||
        input.last_result_mode === "recommendation" ||
        input.last_result_mode === "no_match" ||
        Boolean(input.has_recent_recommendations)),
    decide: () => ({
      mode: "recommendation",
      confidence: "high",
      needs_clarification: false,
    }),
  },
  {
    id: "GENERAL_ADVICE_OR_EDUCATION",
    when: (_input, text) => isGeneralAdviceOrEducation(text),
    decide: () => ({
      mode: "general_chat",
      confidence: "high",
      needs_clarification: false,
    }),
  },
  {
    id: "AMBIGUOUS_WITH_CONSTRAINTS_ONLY",
    when: (_input, text) => isConstraintOnlyWithoutIntent(text),
    decide: () => ({
      mode: "general_chat",
      confidence: "low",
      needs_clarification: true,
    }),
  },
  {
    id: "DEFAULT_GENERAL_CHAT",
    when: () => true,
    decide: () => ({
      mode: "general_chat",
      confidence: "medium",
      needs_clarification: false,
    }),
  },
];

export function routeTurnMode(input: RouteTurnModeInput): RouteDecision {
  const text = input.message.toLowerCase().trim();
  for (const rule of ROUTE_RULES) {
    if (!rule.when(input, text)) continue;
    const decision = rule.decide(input, text);
    return {
      ...decision,
      rule_id: rule.id,
    };
  }

  return {
    mode: "general_chat",
    rule_id: "DEFAULT_GENERAL_CHAT",
    confidence: "medium",
    needs_clarification: false,
  };
}

function isExplicitRecommendationRequest(text: string): boolean {
  const clearAdviceIntent =
    /\b(how to|how do i|tell me about|difference between|is this good|would this look good|what do you think)\b/.test(
      text
    );
  if (clearAdviceIntent) return false;

  const explicitPhrases = [
    "show me what you have",
    "what do you have in inventory",
    "show inventory",
    "show available rugs",
    "recommend rugs",
    "find me a rug",
    "show rug options",
  ];
  if (explicitPhrases.some((phrase) => text.includes(phrase))) return true;

  const needBasedRecommendationIntent =
    /\b(i need|need|i want|want|i would like|would like|looking for|look for|i am searching for|searching for|find me|show me|find|recommend|search for)\b/.test(
      text
    );
  if (needBasedRecommendationIntent && hasConstraintSignalsInMessage(text)) {
    return true;
  }

  const shoppingVerb = /\b(show|show me|find|recommend|browse|search for|look for)\b/.test(
    text
  );
  const rugObject = /\b(rug|rugs|runner|inventory|options)\b/.test(text);
  if (shoppingVerb && (rugObject || hasConstraintSignalsInMessage(text))) return true;

  return false;
}

export function parseRecommendationFollowupIntent(
  text: string
): RecommendationFollowupIntent {
  if (!text.trim()) return "none";
  if (isGeneralAdviceOrEducation(text)) return "none";

  const normalized = text.toLowerCase().trim();
  if (
    /\b(closest|nearest|best match|closest you have|closest option|closest size)\b/.test(
      normalized
    )
  ) {
    return "closest";
  }
  if (/\b(larger|bigger|go larger|size up|go up)\b/.test(normalized)) {
    return "larger";
  }
  if (/\b(smaller|go smaller|size down|go down)\b/.test(normalized)) {
    return "smaller";
  }

  const followupSignals = [
    "show more",
    "more like this",
    "narrow",
    "filter",
    "under ",
    "over ",
    "only ",
    "instead",
    "different options",
    "another set",
  ];
  if (followupSignals.some((signal) => normalized.includes(signal))) {
    if (
      normalized.includes("narrow") ||
      normalized.includes("filter") ||
      normalized.includes("under ") ||
      normalized.includes("over ") ||
      normalized.includes("only ")
    ) {
      return "tighten";
    }
    return "more_like_this";
  }

  if (/^(yes|yeah|yep|sure|ok|okay|please|do it|that works|sounds good)\b/.test(normalized)) {
    return "more_like_this";
  }

  return "none";
}

function isGeneralAdviceOrEducation(text: string): boolean {
  const adviceSignals = [
    "how do i",
    "how to",
    "is this good",
    "would this look good",
    "what do you think",
    "tell me about",
    "care",
    "clean",
    "maintenance",
    "difference between",
  ];
  return adviceSignals.some((signal) => text.includes(signal));
}

function isConstraintOnlyWithoutIntent(text: string): boolean {
  const hasConstraintSignals = hasConstraintSignalsInMessage(text);
  if (!hasConstraintSignals) return false;

  const hasIntentVerb =
    /\b(show|find|recommend|browse|search|look|need|want|help|tell|explain|compare|is|are|would|should|can|do)\b/i.test(
      text
    );
  return !hasIntentVerb;
}

function hasConstraintSignalsInMessage(text: string): boolean {
  return /(\d+\s*[x×]\s*\d+)|(\$\s*\d+)|\b(under|below|budget|max|maximum|size|palette|style|room|neutral|modern|traditional|runner|round|oval|blue|red|green|navy|ivory|gold|oversized)\b/i.test(
    text
  );
}
