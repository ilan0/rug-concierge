import type { ChatMode, RecommendationState, RoleType } from "@/lib/chat/types";

type RouteTurnModeInput = {
  message: string;
  role: RoleType;
  recommendation_state: RecommendationState;
};

// Lightweight router placeholder.
// This should eventually be replaced with a stronger intent layer.
export function routeTurnMode(input: RouteTurnModeInput): ChatMode {
  const text = input.message.toLowerCase();

  const recommendationKeywords = [
    "show",
    "find",
    "recommend",
    "inventory",
    "rug",
    "style",
    "palette",
    "budget",
    "size",
  ];

  const asksForInventory = recommendationKeywords.some((keyword) =>
    text.includes(keyword)
  );

  if (asksForInventory) return "recommendation";

  // If constraints already exist in session state, keep routing recommendation
  // when user asks a short follow-up like "show options".
  if (
    input.recommendation_state.hard_constraints.size ||
    typeof input.recommendation_state.hard_constraints.budgetMax === "number"
  ) {
    if (text.includes("options") || text.includes("show")) {
      return "recommendation";
    }
  }

  return "general_chat";
}

