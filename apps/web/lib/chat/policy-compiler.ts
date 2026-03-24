import type { HardConstraints } from "@/lib/types/recommendation";
import { normalizeHardConstraints } from "@/lib/filters/extract-constraints";
import type { ParsedTurn } from "@/lib/chat/turn-parser-contract";

export type CompiledTurnPolicy = {
  mode: ParsedTurn["mode"];
  followup_intent: ParsedTurn["followup_intent"];
  hard_constraints: HardConstraints;
  strictness: ParsedTurn["strictness"];
  avoid: ParsedTurn["avoid"];
  confidence: ParsedTurn["confidence"];
  policy_source:
    | "none"
    | "parsed_turn"
    | "explicit_constraints"
    | "merged_parsed_and_explicit";
  must_prefer_avoid: {
    must: Array<"size" | "colors" | "styles" | "shape">;
    prefer: Array<"size" | "colors" | "styles" | "shape">;
    avoid: {
      colors: string[];
      styles: string[];
      shapes: string[];
    };
  };
};

function recommendedPreferToleranceIn(input: {
  widthIn: number;
  lengthIn: number;
}): number {
  const longSide = Math.max(input.widthIn, input.lengthIn);
  if (longSide < 48) return 3;
  if (longSide < 72) return 6;
  if (longSide < 96) return 8;
  if (longSide < 132) return 10;
  return 12;
}

function mergeHardConstraints(input: {
  explicit: HardConstraints;
  parsed: ParsedTurn["constraints"];
  parsedAvoid: ParsedTurn["avoid"];
  strictness: ParsedTurn["strictness"];
}): HardConstraints {
  const explicit = input.explicit;
  const parsed = input.parsed;
  const mergedStrictness = {
    size: explicit.strictness?.size ?? input.strictness.size,
    colors: explicit.strictness?.colors ?? input.strictness.colors,
    styles: explicit.strictness?.styles ?? input.strictness.styles,
    shape: explicit.strictness?.shape ?? input.strictness.shape,
  };

  const size = explicit.size
    ? explicit.size
    : parsed.size
      ? {
          widthIn: parsed.size.widthIn,
          lengthIn: parsed.size.lengthIn,
          toleranceIn:
            input.strictness.size === "must"
              ? 0
              : recommendedPreferToleranceIn({
                  widthIn: parsed.size.widthIn,
                  lengthIn: parsed.size.lengthIn,
                }),
        }
      : undefined;

  const colors =
    explicit.colors ??
    (parsed.colors.length > 0 ? parsed.colors : undefined);
  const styles =
    explicit.styles ??
    (parsed.styles.length > 0 ? parsed.styles : undefined);
  const shape = explicit.shape ?? parsed.shape ?? undefined;
  const parsedAvoid = {
    colors:
      input.parsedAvoid.colors.length > 0 ? input.parsedAvoid.colors : undefined,
    styles:
      input.parsedAvoid.styles.length > 0 ? input.parsedAvoid.styles : undefined,
    shapes:
      input.parsedAvoid.shapes.length > 0 ? input.parsedAvoid.shapes : undefined,
  };
  const avoidPreferences =
    explicit.avoid_preferences ??
    (parsedAvoid.colors || parsedAvoid.styles || parsedAvoid.shapes
      ? parsedAvoid
      : undefined);

  return {
    size,
    colors,
    styles,
    shape,
    strictness: mergedStrictness,
    avoid_preferences: avoidPreferences,
  };
}

function hasAnyHardConstraintSignals(constraints: HardConstraints): boolean {
  return Boolean(
    constraints.size ||
      (constraints.colors && constraints.colors.length > 0) ||
      (constraints.styles && constraints.styles.length > 0) ||
      constraints.shape ||
      (constraints.avoid_preferences?.colors &&
        constraints.avoid_preferences.colors.length > 0) ||
      (constraints.avoid_preferences?.styles &&
        constraints.avoid_preferences.styles.length > 0) ||
      (constraints.avoid_preferences?.shapes &&
        constraints.avoid_preferences.shapes.length > 0)
  );
}

function hasAnyParsedSignals(parsedTurn: ParsedTurn): boolean {
  return Boolean(
    parsedTurn.constraints.size ||
      parsedTurn.constraints.colors.length > 0 ||
      parsedTurn.constraints.styles.length > 0 ||
      parsedTurn.constraints.shape ||
      parsedTurn.avoid.colors.length > 0 ||
      parsedTurn.avoid.styles.length > 0 ||
      parsedTurn.avoid.shapes.length > 0
  );
}

function resolvePolicySource(input: {
  parsedTurn: ParsedTurn;
  explicitConstraints: HardConstraints;
}): CompiledTurnPolicy["policy_source"] {
  const hasParsed = hasAnyParsedSignals(input.parsedTurn);
  const hasExplicit = hasAnyHardConstraintSignals(input.explicitConstraints);
  if (hasParsed && hasExplicit) return "merged_parsed_and_explicit";
  if (hasExplicit) return "explicit_constraints";
  if (hasParsed) return "parsed_turn";
  return "none";
}

function buildMustPreferAvoid(input: {
  constraints: HardConstraints;
  strictness: ParsedTurn["strictness"];
}): CompiledTurnPolicy["must_prefer_avoid"] {
  const must: Array<"size" | "colors" | "styles" | "shape"> = [];
  const prefer: Array<"size" | "colors" | "styles" | "shape"> = [];

  const pushBucket = (
    key: "size" | "colors" | "styles" | "shape",
    active: boolean
  ) => {
    if (!active) return;
    if (input.strictness[key] === "must") {
      must.push(key);
    } else {
      prefer.push(key);
    }
  };

  pushBucket("size", Boolean(input.constraints.size));
  pushBucket("colors", Boolean(input.constraints.colors?.length));
  pushBucket("styles", Boolean(input.constraints.styles?.length));
  pushBucket("shape", Boolean(input.constraints.shape));

  return {
    must,
    prefer,
    avoid: {
      colors: input.constraints.avoid_preferences?.colors ?? [],
      styles: input.constraints.avoid_preferences?.styles ?? [],
      shapes: input.constraints.avoid_preferences?.shapes ?? [],
    },
  };
}

export function compileTurnPolicy(input: {
  parsedTurn: ParsedTurn;
  explicitConstraints?: unknown;
}): CompiledTurnPolicy {
  const explicit = normalizeHardConstraints(input.explicitConstraints);
  const hardConstraints = mergeHardConstraints({
    explicit,
    parsed: input.parsedTurn.constraints,
    parsedAvoid: input.parsedTurn.avoid,
    strictness: input.parsedTurn.strictness,
  });

  return {
    mode: input.parsedTurn.mode,
    followup_intent: input.parsedTurn.followup_intent,
    hard_constraints: hardConstraints,
    strictness: input.parsedTurn.strictness,
    avoid: input.parsedTurn.avoid,
    confidence: input.parsedTurn.confidence,
    policy_source: resolvePolicySource({
      parsedTurn: input.parsedTurn,
      explicitConstraints: explicit,
    }),
    must_prefer_avoid: buildMustPreferAvoid({
      constraints: hardConstraints,
      strictness: input.parsedTurn.strictness,
    }),
  };
}
