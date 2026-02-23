import type {
  ChatMode,
  RecommendationReviewAction,
  RecommendationState,
  RoleType,
} from "@/lib/chat/types";
import { canRoleGenerateAppraisal } from "@/lib/auth/policy";

type RouteTurnModeInput = {
  message: string;
  role: RoleType;
  review_action?: RecommendationReviewAction | null;
  last_mode?: ChatMode | null;
  has_recent_recommendations?: boolean;
  recommendation_state: RecommendationState;
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

export function routeTurnMode(input: RouteTurnModeInput): RouteDecision {
  const text = input.message.toLowerCase().trim();

  if (input.review_action) {
    return {
      mode: "recommendation",
      rule_id: "REVIEW_ACTION_CONTROL",
      confidence: "high",
      needs_clarification: false,
    };
  }

  if (isAppraisalIntent(text)) {
    if (canRoleGenerateAppraisal(input.role)) {
      return {
        mode: "appraisal",
        rule_id: "APPRAISAL_STAFF",
        confidence: "high",
        needs_clarification: false,
      };
    }
    return {
      mode: "general_chat",
      rule_id: "APPRAISAL_NON_STAFF_BLOCK",
      confidence: "high",
      needs_clarification: false,
    };
  }

  if (isExplicitRecommendationRequest(text)) {
    return {
      mode: "recommendation",
      rule_id: "EXPLICIT_RECOMMENDATION_REQUEST",
      confidence: "high",
      needs_clarification: false,
    };
  }

  if (
    isRecommendationFollowup(text) &&
    (input.last_mode === "recommendation" ||
      Boolean(input.has_recent_recommendations))
  ) {
    return {
      mode: "recommendation",
      rule_id: "RECOMMENDATION_FOLLOWUP",
      confidence: "medium",
      needs_clarification: false,
    };
  }

  if (isGeneralAdviceOrEducation(text)) {
    return {
      mode: "general_chat",
      rule_id: "GENERAL_ADVICE_OR_EDUCATION",
      confidence: "high",
      needs_clarification: false,
    };
  }

  if (hasConstraintSignals(text, input.recommendation_state)) {
    return {
      mode: "general_chat",
      rule_id: "AMBIGUOUS_WITH_CONSTRAINTS_ONLY",
      confidence: "low",
      needs_clarification: true,
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
  const requestSignals = [
    "show me",
    "show",
    "find",
    "recommend",
    "what do you have",
    "inventory",
    "options",
    "available rugs",
    "rugs",
    "rug options",
  ];
  return requestSignals.some((signal) => text.includes(signal));
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

function hasConstraintSignals(
  text: string,
  recommendationState: RecommendationState
): boolean {
  const hasSessionHardConstraints =
    Boolean(recommendationState.hard_constraints.size) ||
    typeof recommendationState.hard_constraints.budgetMax === "number";
  const hasMessageConstraintSignals =
    /(\d+\s*x\s*\d+)|(\$\s*\d+)|\b(budget|size|palette|style|room)\b/i.test(text);
  return hasSessionHardConstraints || hasMessageConstraintSignals;
}
