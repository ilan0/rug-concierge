import {
  extractConstraintsFromUserMessage,
  normalizeHardConstraints,
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
  const existing = session.recommendation_state.hard_constraints;

  const merged: HardConstraints = {
    budgetMax:
      typeof explicit.budgetMax === "number"
        ? explicit.budgetMax
        : typeof inferred.budgetMax === "number"
          ? inferred.budgetMax
          : existing.budgetMax,
    size: explicit.size ?? inferred.size ?? existing.size,
  };

  return {
    ...session,
    recommendation_state: {
      ...session.recommendation_state,
      hard_constraints: merged,
    },
  };
}
