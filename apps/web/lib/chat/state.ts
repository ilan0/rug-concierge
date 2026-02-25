import {
  extractConstraintsFromUserMessage,
  normalizeHardConstraints,
  parseConstraintResetDirectives,
} from "@/lib/filters/extract-constraints";
import type { SessionData } from "@/lib/chat/types";
import type { HardConstraints } from "@/lib/types/recommendation";

type UpdateRecommendationStateInput = {
  message: string;
  constraints?: HardConstraints;
};

// Update recommendation state on every turn, even if turn routes to general chat.
export function updateRecommendationStateForTurn(
  session: SessionData,
  input: UpdateRecommendationStateInput
): SessionData {
  const explicit = normalizeHardConstraints(input.constraints);
  const inferred = extractConstraintsFromUserMessage(input.message);
  const resets = parseConstraintResetDirectives(input.message);
  const existing = session.recommendation_state.hard_constraints;
  const resetAdjustedExisting: HardConstraints = {
    budgetMax: resets.clearBudget ? undefined : existing.budgetMax,
    size: resets.clearSize ? undefined : existing.size,
  };

  const merged: HardConstraints = {
    budgetMax:
      typeof explicit.budgetMax === "number"
        ? explicit.budgetMax
        : typeof inferred.budgetMax === "number"
          ? inferred.budgetMax
          : resetAdjustedExisting.budgetMax,
    size: explicit.size ?? inferred.size ?? resetAdjustedExisting.size,
  };

  return {
    ...session,
    recommendation_state: {
      ...session.recommendation_state,
      hard_constraints: merged,
    },
  };
}
