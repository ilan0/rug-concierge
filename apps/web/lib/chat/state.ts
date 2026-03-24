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

function mergeStrictnessForConstraints(input: {
  explicit: HardConstraints["strictness"] | undefined;
  existing: HardConstraints["strictness"] | undefined;
  hasSize: boolean;
  hasColors: boolean;
  hasStyles: boolean;
  hasShape: boolean;
}): HardConstraints["strictness"] | undefined {
  const merged = {
    size: input.hasSize
      ? (input.explicit?.size ?? input.existing?.size ?? "prefer")
      : undefined,
    colors: input.hasColors
      ? (input.explicit?.colors ?? input.existing?.colors ?? "prefer")
      : undefined,
    styles: input.hasStyles
      ? (input.explicit?.styles ?? input.existing?.styles ?? "prefer")
      : undefined,
    shape: input.hasShape
      ? (input.explicit?.shape ?? input.existing?.shape ?? "prefer")
      : undefined,
  };

  if (!merged.size && !merged.colors && !merged.styles && !merged.shape) {
    return undefined;
  }
  return merged;
}

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
    strictness: resets.clearAll ? undefined : existing.strictness,
    avoid_preferences: resets.clearAll ? undefined : existing.avoid_preferences,
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
  merged.strictness = mergeStrictnessForConstraints({
    explicit: explicit.strictness,
    existing: resetAdjustedExisting.strictness,
    hasSize: Boolean(merged.size),
    hasColors: Boolean(merged.colors && merged.colors.length > 0),
    hasStyles: Boolean(merged.styles && merged.styles.length > 0),
    hasShape: Boolean(merged.shape),
  });
  merged.avoid_preferences =
    explicit.avoid_preferences ?? resetAdjustedExisting.avoid_preferences;

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
