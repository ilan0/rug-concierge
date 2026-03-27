import type { HardConstraints } from "@/lib/types/recommendation";
import {
  extractSoftPreferencesFromUserMessage,
  normalizeHardConstraints,
} from "@/lib/filters/extract-constraints";
import type { ParsedTurn } from "@/lib/chat/turn-parser-contract";

export type CompiledTurnPolicy = {
  intent: ParsedTurn["intent"];
  mode: ParsedTurn["mode"];
  discovery_requested: boolean;
  followup_intent: ParsedTurn["followup_intent"];
  hard_constraints: HardConstraints;
  persisted_hard_constraints: HardConstraints;
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

type SemanticInference = {
  inferred_size?: NonNullable<HardConstraints["size"]>;
  inferred_styles?: string[];
  inferred_shape?: HardConstraints["shape"];
  inferred_avoid_styles?: string[];
};

const MODERN_STYLE_TERMS = [
  "modern",
  "contemporary",
  "minimal",
  "minimalist",
  "abstract",
] as const;

const TRADITIONAL_STYLE_TERMS = [
  "traditional",
  "classic",
  "antique",
  "tribal",
  "persian",
  "heriz",
  "serapi",
  "kashan",
  "tabriz",
  "isfahan",
  "sultanabad",
] as const;

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function includesAny(text: string, terms: readonly string[]): boolean {
  return terms.some((term) => new RegExp(`\\b${term}\\b`, "i").test(text));
}

function inferSemanticSignals(input: {
  message: string;
  parsedTurn: ParsedTurn;
  explicit: HardConstraints;
  previous: HardConstraints;
  useInheritedBase: boolean;
}): SemanticInference {
  const message = normalizeText(input.message);
  const allowInference =
    input.parsedTurn.intent === "recommend" ||
    input.parsedTurn.intent === "followup" ||
    input.parsedTurn.intent === "reaction";

  if (!allowInference) {
    return {};
  }

  const hasExplicitSize = Boolean(
    input.explicit.size ||
      input.parsedTurn.constraints.size ||
      (input.useInheritedBase && input.previous.size)
  );
  const hasExplicitShape = Boolean(
    input.explicit.shape ||
      input.parsedTurn.constraints.shape ||
      (input.useInheritedBase && input.previous.shape)
  );
  const styleTokens = new Set(
    [
      ...(input.explicit.styles ?? []),
      ...(input.parsedTurn.constraints.styles ?? []),
      ...(input.useInheritedBase ? input.previous.styles ?? [] : []),
    ].map((value) => normalizeText(value))
  );
  const hasModernSignal =
    includesAny(message, MODERN_STYLE_TERMS) || styleTokens.has("modern");
  const hasTraditionalSignal =
    includesAny(message, TRADITIONAL_STYLE_TERMS) ||
    styleTokens.has("traditional") ||
    styleTokens.has("persian");
  const softSignals = extractSoftPreferencesFromUserMessage(input.message);
  const hasAnchorSignal = /\b(anchor|anchor rug|main rug|room anchor)\b/i.test(message);

  let inferredSize: NonNullable<HardConstraints["size"]> | undefined;
  let inferredShape: HardConstraints["shape"] | undefined;
  let inferredStyles: string[] | undefined;

  if (!hasExplicitSize) {
    if (hasAnchorSignal || softSignals.room === "living_room") {
      inferredSize = { widthIn: 96, lengthIn: 120, toleranceIn: 12 };
    } else if (softSignals.room === "dining_room") {
      inferredSize = { widthIn: 96, lengthIn: 120, toleranceIn: 12 };
    } else if (softSignals.room === "bedroom") {
      inferredSize = { widthIn: 60, lengthIn: 96, toleranceIn: 10 };
    } else if (softSignals.room === "office") {
      inferredSize = { widthIn: 60, lengthIn: 96, toleranceIn: 10 };
    } else if (softSignals.room === "entryway") {
      inferredSize = { widthIn: 36, lengthIn: 60, toleranceIn: 8 };
    } else if (softSignals.room === "kitchen") {
      inferredSize = { widthIn: 24, lengthIn: 72, toleranceIn: 8 };
    } else if (softSignals.room === "hallway") {
      inferredSize = { widthIn: 30, lengthIn: 120, toleranceIn: 8 };
    }
  }

  if (!hasExplicitShape && softSignals.room === "hallway") {
    inferredShape = "runner";
  }

  if (styleTokens.size === 0) {
    if (hasModernSignal && !hasTraditionalSignal) {
      inferredStyles = ["modern"];
    } else if (hasTraditionalSignal && !hasModernSignal) {
      inferredStyles = ["traditional"];
    }
  }

  let inferredAvoidStyles: string[] | undefined;
  if (hasModernSignal && !hasTraditionalSignal) {
    inferredAvoidStyles = [
      "traditional",
      "tribal",
      "persian",
      "heriz",
      "serapi",
      "kashan",
      "tabriz",
    ];
  } else if (hasTraditionalSignal && !hasModernSignal) {
    inferredAvoidStyles = ["modern", "contemporary", "minimalist", "abstract"];
  }

  return {
    inferred_size: inferredSize,
    inferred_shape: inferredShape,
    inferred_styles: inferredStyles,
    inferred_avoid_styles: inferredAvoidStyles,
  };
}

function mergeStringTokens(...groups: Array<string[] | undefined>): string[] | undefined {
  const merged = Array.from(
    new Set(
      groups
        .flatMap((group) => group ?? [])
        .map((value) => normalizeText(value))
        .filter((value) => value.length > 0)
    )
  );
  return merged.length > 0 ? merged : undefined;
}

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
  message: string;
  explicit: HardConstraints;
  previous: HardConstraints;
  parsed: ParsedTurn["constraints"];
  parsedAvoid: ParsedTurn["avoid"];
  strictness: ParsedTurn["strictness"];
  intent: ParsedTurn["intent"];
  mode: ParsedTurn["mode"];
  followupIntent: ParsedTurn["followup_intent"];
}): HardConstraints {
  const explicit = input.explicit;
  const parsed = input.parsed;
  const useInheritedBase =
    input.intent === "followup" ||
    input.intent === "reaction" ||
    input.mode === "recommendation_followup" ||
    input.followupIntent !== "none";
  const base = useInheritedBase ? input.previous : {};
  const semantic = inferSemanticSignals({
    message: input.message,
    parsedTurn: {
      intent: input.intent,
      mode: input.mode,
      followup_intent: input.followupIntent,
      constraints: parsed,
      strictness: input.strictness,
      avoid: input.parsedAvoid,
      session_facts: [],
      rug_reference_ambiguous: false,
      confidence: "medium",
    },
    explicit,
    previous: input.previous,
    useInheritedBase,
  });
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
      : base.size ?? semantic.inferred_size ?? undefined;

  const colors =
    explicit.colors ??
    (parsed.colors.length > 0 ? parsed.colors : base.colors ?? undefined);
  const styles =
    explicit.styles ??
    (parsed.styles.length > 0
      ? parsed.styles
      : base.styles ?? semantic.inferred_styles ?? undefined);
  const shape =
    explicit.shape ??
    parsed.shape ??
    base.shape ??
    semantic.inferred_shape ??
    undefined;
  const parsedAvoid = {
    colors:
      input.parsedAvoid.colors.length > 0 ? input.parsedAvoid.colors : undefined,
    styles:
      input.parsedAvoid.styles.length > 0 ? input.parsedAvoid.styles : undefined,
    shapes:
      input.parsedAvoid.shapes.length > 0 ? input.parsedAvoid.shapes : undefined,
  };
  const avoidPreferences =
    explicit.avoid_preferences ||
    parsedAvoid.colors ||
    parsedAvoid.styles ||
    parsedAvoid.shapes ||
    base.avoid_preferences ||
    semantic.inferred_avoid_styles
      ? {
          colors: mergeStringTokens(
            base.avoid_preferences?.colors,
            parsedAvoid.colors,
            explicit.avoid_preferences?.colors
          ),
          styles: mergeStringTokens(
            base.avoid_preferences?.styles,
            semantic.inferred_avoid_styles,
            parsedAvoid.styles,
            explicit.avoid_preferences?.styles
          ),
          shapes: Array.from(
            new Set([
              ...(base.avoid_preferences?.shapes ?? []),
              ...(parsedAvoid.shapes ?? []),
              ...(explicit.avoid_preferences?.shapes ?? []),
            ])
          ),
        }
      : undefined;

  const strictness = {
    size: mergedStrictness.size ?? base.strictness?.size ?? "prefer",
    colors: mergedStrictness.colors ?? base.strictness?.colors ?? "prefer",
    styles: mergedStrictness.styles ?? base.strictness?.styles ?? "prefer",
    shape: mergedStrictness.shape ?? base.strictness?.shape ?? "prefer",
  };

  return {
    size,
    colors,
    styles,
    shape,
    strictness,
    avoid_preferences:
      avoidPreferences &&
      ((avoidPreferences.colors?.length ?? 0) > 0 ||
        (avoidPreferences.styles?.length ?? 0) > 0 ||
        (avoidPreferences.shapes?.length ?? 0) > 0)
        ? avoidPreferences
        : undefined,
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

function shouldRequestDiscoveryMode(input: {
  parsedTurn: ParsedTurn;
  compiledConstraints: HardConstraints;
}): boolean {
  if (input.parsedTurn.intent !== "recommend") return false;
  if (input.parsedTurn.followup_intent !== "none") return false;
  if (input.parsedTurn.mode === "discovery") return true;
  return !hasAnyHardConstraintSignals(input.compiledConstraints);
}

export function compileTurnPolicy(input: {
  parsedTurn: ParsedTurn;
  message?: string;
  explicitConstraints?: unknown;
  previousConstraints?: HardConstraints;
}): CompiledTurnPolicy {
  const explicit = normalizeHardConstraints(input.explicitConstraints);
  const previous = normalizeHardConstraints(input.previousConstraints);
  const hardConstraints = mergeHardConstraints({
    message: input.message ?? "",
    explicit,
    previous,
    parsed: input.parsedTurn.constraints,
    parsedAvoid: input.parsedTurn.avoid,
    strictness: input.parsedTurn.strictness,
    intent: input.parsedTurn.intent,
    mode: input.parsedTurn.mode,
    followupIntent: input.parsedTurn.followup_intent,
  });
  const persistedHardConstraints =
    input.parsedTurn.intent === "educate" ||
    input.parsedTurn.intent === "general" ||
    input.parsedTurn.intent === "purchase"
      ? previous
      : hardConstraints;

  return {
    intent: input.parsedTurn.intent,
    mode: input.parsedTurn.mode,
    discovery_requested: shouldRequestDiscoveryMode({
      parsedTurn: input.parsedTurn,
      compiledConstraints: hardConstraints,
    }),
    followup_intent: input.parsedTurn.followup_intent,
    hard_constraints: hardConstraints,
    persisted_hard_constraints: persistedHardConstraints,
    strictness: input.parsedTurn.strictness,
    avoid: input.parsedTurn.avoid,
    confidence: input.parsedTurn.confidence,
    policy_source: resolvePolicySource({
      parsedTurn: input.parsedTurn,
      explicitConstraints: explicit,
    }),
    must_prefer_avoid: buildMustPreferAvoid({
      constraints: hardConstraints,
      strictness: {
        size:
          hardConstraints.strictness?.size ?? input.parsedTurn.strictness.size,
        colors:
          hardConstraints.strictness?.colors ??
          input.parsedTurn.strictness.colors,
        styles:
          hardConstraints.strictness?.styles ??
          input.parsedTurn.strictness.styles,
        shape:
          hardConstraints.strictness?.shape ?? input.parsedTurn.strictness.shape,
      },
    }),
  };
}
