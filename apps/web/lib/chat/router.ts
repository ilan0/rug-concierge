import type {
  ChatMode,
  RecommendationReviewAction,
  RoleType,
} from "@/lib/chat/types";
import { canRoleGenerateAppraisal } from "@/lib/auth/policy";

type RouteTurnModeInput = {
  message: string;
  role: RoleType;
  review_action?: RecommendationReviewAction | null;
  last_mode?: ChatMode | null;
  has_recent_recommendations?: boolean;
};

export type RouteDecision = {
  mode: ChatMode;
  rule_id:
    | "REVIEW_ACTION_CONTROL"
    | "APPRAISAL_STAFF"
    | "APPRAISAL_NON_STAFF_BLOCK"
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
  "REVIEW_ACTION_CONTROL",
  "APPRAISAL_STAFF",
  "APPRAISAL_NON_STAFF_BLOCK",
  "EXPLICIT_RECOMMENDATION_REQUEST",
  "RECOMMENDATION_FOLLOWUP",
  "GENERAL_ADVICE_OR_EDUCATION",
  "AMBIGUOUS_WITH_CONSTRAINTS_ONLY",
  "DEFAULT_GENERAL_CHAT",
];

const ROUTE_RULES: RouteRule[] = [
  {
    id: "REVIEW_ACTION_CONTROL",
    when: (input) => Boolean(input.review_action),
    decide: () => ({
      mode: "recommendation",
      confidence: "high",
      needs_clarification: false,
    }),
  },
  {
    id: "APPRAISAL_STAFF",
    when: (input, text) => isAppraisalIntent(text) && canRoleGenerateAppraisal(input.role),
    decide: () => ({
      mode: "appraisal",
      confidence: "high",
      needs_clarification: false,
    }),
  },
  {
    id: "APPRAISAL_NON_STAFF_BLOCK",
    when: (input, text) => isAppraisalIntent(text) && !canRoleGenerateAppraisal(input.role),
    decide: () => ({
      mode: "general_chat",
      confidence: "high",
      needs_clarification: false,
    }),
  },
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
      isRecommendationFollowup(text) &&
      (input.last_mode === "recommendation" || Boolean(input.has_recent_recommendations)),
    decide: () => ({
      mode: "recommendation",
      confidence: "medium",
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

function isAppraisalIntent(text: string): boolean {
  const appraisalKeywords = [
    "appraisal",
    "appraise",
    "insurance letter",
    "valuation",
    "valuation letter",
  ];
  return appraisalKeywords.some((keyword) => text.includes(keyword));
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
    /\b(i need|i want|looking for|look for|find me|show me)\b/.test(text);
  if (needBasedRecommendationIntent && hasConstraintSignalsInMessage(text)) {
    return true;
  }

  const shoppingVerb = /\b(show|show me|find|recommend|browse|search for|look for)\b/.test(
    text
  );
  const rugObject = /\b(rug|rugs|runner|inventory|options)\b/.test(text);
  if (shoppingVerb && rugObject) return true;

  return false;
}

function isRecommendationFollowup(text: string): boolean {
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
  return followupSignals.some((signal) => text.includes(signal));
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
  return /(\d+\s*[x×]\s*\d+)|(\$\s*\d+)|\b(under|below|budget|max|maximum|size|palette|style|room|neutral|modern)\b/i.test(
    text
  );
}
