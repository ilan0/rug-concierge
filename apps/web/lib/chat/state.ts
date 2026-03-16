import {
  extractConstraintsFromUserMessage,
  extractSoftPreferencesFromUserMessage,
  normalizeSoftPreferences,
  normalizeHardConstraints,
  parseConstraintResetDirectives,
} from "@/lib/filters/extract-constraints";
import type { SessionData } from "@/lib/chat/types";
import type { HardConstraints } from "@/lib/types/recommendation";

type UpdateRecommendationStateInput = {
  message: string;
  constraints?: unknown;
};

// Update recommendation state on every turn, even if turn routes to general chat.
export function updateRecommendationStateForTurn(
  session: SessionData,
  input: UpdateRecommendationStateInput
): SessionData {
  const explicit = normalizeHardConstraints(input.constraints);
  const inferred = extractConstraintsFromUserMessage(input.message);
  const explicitSoft = normalizeSoftPreferences(input.constraints);
  const inferredSoft = extractSoftPreferencesFromUserMessage(input.message);
  const resets = parseConstraintResetDirectives(input.message);
  const existing = session.recommendation_state.hard_constraints;
  const existingSoft = session.recommendation_state.soft_preferences ?? {};
  const resetAdjustedExisting: HardConstraints = {
    size: resets.clearSize ? undefined : existing.size,
    colors: resets.clearColors ? undefined : existing.colors,
    styles: resets.clearStyles ? undefined : existing.styles,
    shape: resets.clearShape ? undefined : existing.shape,
  };

  const merged: HardConstraints = {
    size: explicit.size ?? inferred.size ?? resetAdjustedExisting.size ?? undefined,
    colors:
      explicit.colors ??
      inferred.colors ??
      resetAdjustedExisting.colors ??
      undefined,
    styles:
      explicit.styles ??
      inferred.styles ??
      resetAdjustedExisting.styles ??
      undefined,
    shape:
      explicit.shape ??
      inferred.shape ??
      resetAdjustedExisting.shape ??
      undefined,
  };

  const nextSoftPreferences = {
    ...(resets.clearAll ? {} : existingSoft),
    ...inferredSoft,
    ...explicitSoft,
  };

  return {
    ...session,
    recommendation_state: {
      ...session.recommendation_state,
      hard_constraints: merged,
      soft_preferences: nextSoftPreferences,
    },
  };
}
