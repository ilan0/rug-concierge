import type { HardConstraints } from "@/lib/types/recommendation";
import {
  extractSoftPreferencesFromUserMessage,
  normalizeHardConstraints,
} from "@/lib/filters/extract-constraints";
import type { ParsedTurn } from "@/lib/chat/turn-parser-contract";
import {
  CANONICAL_COLORS,
  extractCanonicalColorsFromText,
  normalizeColorList,
} from "@/lib/config/color-taxonomy";

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
  inferred_colors?: string[];
  inferred_styles?: string[];
  inferred_shape?: HardConstraints["shape"];
  inferred_avoid_styles?: string[];
  inferred_avoid_colors?: string[];
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
const STYLE_SIGNAL_TERMS = [
  ...MODERN_STYLE_TERMS,
  ...TRADITIONAL_STYLE_TERMS,
] as const;

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function includesAny(text: string, terms: readonly string[]): boolean {
  return terms.some((term) => new RegExp(`\\b${term}\\b`, "i").test(text));
}

function hasExplicitStyleRequestLanguage(message: string): boolean {
  return /\b(show|find|looking for|need|want|recommend|do you have|have any)\b/i.test(
    message
  );
}

function hasAnchorRoomLanguage(message: string): boolean {
  return /\b(anchor|anchor rug|main rug)\b/i.test(message);
}

function inferAvoidColorsFromMessage(message: string): string[] {
  const normalized = normalizeText(message);
  const directColorMentions = CANONICAL_COLORS.filter((color) =>
    new RegExp(`\\b${color}s?\\b`, "i").test(normalized)
  );
  const tokens = normalizeColorList(
    [...extractCanonicalColorsFromText(message, 8), ...directColorMentions],
    8
  );
  if (tokens.length === 0) return [];
  const lowered = normalized;
  const avoided = tokens.filter((token) => {
    const singular = token.endsWith("s") ? token.slice(0, -1) : token;
    const plural = singular.endsWith("s") ? singular : `${singular}s`;
    const directNegative = new RegExp(
      `\\b(?:no|not|without|avoid|exclude|skip|less)\\b[^.!?]{0,28}\\b(?:${singular}|${plural})\\b`,
      "i"
    );
    const trailingNegative = new RegExp(
      `\\b(?:${singular}|${plural})\\b[^.!?]{0,22}\\b(?:not|avoid|without|skip)\\b`,
      "i"
    );
    return directNegative.test(lowered) || trailingNegative.test(lowered);
  });
  const normalizedAvoided = normalizeColorList(avoided, 8);
  const explicitAvoidAdds: string[] = [];
  if (/\b(no|not|without)\s+(beige|cream|tan|taupe|ivory)\b/i.test(normalized)) {
    explicitAvoidAdds.push("ivory");
  }
  if (/\b(no|not|without)\s+(bold\s+)?reds?\b/i.test(normalized)) {
    explicitAvoidAdds.push("red", "rust");
  }
  if (
    /\b(less light colors|not light|darker|deeper tones|deeper colors|no light colors)\b/i.test(
      normalized
    )
  ) {
    explicitAvoidAdds.push("ivory", "white");
  }
  return normalizeColorList([...normalizedAvoided, ...explicitAvoidAdds], 8);
}

function inferAvoidStylesFromMessage(message: string): string[] {
  const normalized = normalizeText(message);
  const avoided = STYLE_SIGNAL_TERMS.filter((token) => {
    const pattern = new RegExp(
      `\\b(?:no|not|without|avoid|exclude|skip|less|nothing|forget|drop)\\b[^.!?]{0,30}\\b${token}\\b`,
      "i"
    );
    return pattern.test(normalized);
  });
  const inferred = new Set(avoided.map((value) => normalizeText(value)));
  if (
    /\b(less busy|not too busy|cleaner|understated|simpler|calmer)\b/i.test(
      normalized
    )
  ) {
    inferred.add("traditional");
    inferred.add("tribal");
    inferred.add("floral");
    inferred.add("ornate");
  }
  return Array.from(inferred);
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

  const softSignals = extractSoftPreferencesFromUserMessage(input.message);
  const hasRoomDrivenRescope = Boolean(softSignals.room);
  const hasExplicitSize = Boolean(
    input.explicit.size ||
      input.parsedTurn.constraints.size ||
      (input.useInheritedBase && input.previous.size && !hasRoomDrivenRescope)
  );
  const hasExplicitShape = Boolean(
    input.explicit.shape ||
      input.parsedTurn.constraints.shape ||
      (input.useInheritedBase && input.previous.shape)
  );
  const hasExplicitColors = Boolean(
    input.explicit.colors?.length ||
      input.parsedTurn.constraints.colors.length > 0 ||
      (input.useInheritedBase && input.previous.colors?.length)
  );
  const styleTokens = new Set(
    [
      ...(input.explicit.styles ?? []),
      ...(input.parsedTurn.constraints.styles ?? []),
    ].map((value) => normalizeText(value))
  );
  const hasModernMention =
    includesAny(message, MODERN_STYLE_TERMS) || styleTokens.has("modern");
  const hasTraditionalMention =
    includesAny(message, TRADITIONAL_STYLE_TERMS) ||
    styleTokens.has("traditional") ||
    styleTokens.has("persian");
  const modernNegated = /\b(no|not|without|avoid|exclude|skip|forget|drop)\b[^.!?]{0,24}\b(modern|contemporary|minimal|minimalist|abstract)\b/i.test(
    message
  );
  const traditionalNegated = /\b(no|not|without|avoid|exclude|skip|forget|drop)\b[^.!?]{0,24}\b(traditional|persian|tribal|heriz|serapi|kashan|tabriz|isfahan)\b/i.test(
    message
  );
  const hasModernSignal = hasModernMention && !modernNegated;
  const hasTraditionalSignal = hasTraditionalMention && !traditionalNegated;
  const hasPersianMention = /\bpersian\b/i.test(message);
  const hasAnchorSignal = /\b(anchor|anchor rug|main rug|room anchor)\b/i.test(message);
  const hasCalmerSignal =
    /\b(less busy|not too busy|cleaner|cleanest|understated|simpler|calmer)\b/i.test(
      message
    );
  const hasBoldSignal =
    /\b(bold|bolder|vibrant|statement|dramatic|eye-?catching|more personality|more color)\b/i.test(
      message
    );
  const hasPracticalSignal =
    /\b(kid|kids|child|children|dog|dogs|pet|pets|high traffic|durable|easy to clean|low maintenance|beach house)\b/i.test(
      message
    );
  const hasNeutralSignal =
    /\b(neutral|goes with everything|versatile|calm palette|subtle palette)\b/i.test(
      message
    );
  const hasElegantSignal =
    /\b(elegant|refined|formal|dressy|sophisticated)\b/i.test(message);

  let inferredSize: NonNullable<HardConstraints["size"]> | undefined;
  let inferredColors: string[] | undefined;
  let inferredShape: HardConstraints["shape"] | undefined;
  let inferredStyles: string[] | undefined;
  let inferredAvoidColors: string[] | undefined;
  let inferredAvoidStyles: string[] | undefined;
  const suppressRoomSizeInferenceForPractical =
    hasPracticalSignal && !hasAnchorSignal;
  const mentionedRooms = [
    /\bliving room\b/i.test(message) ? "living_room" : null,
    /\bdining room\b/i.test(message) ? "dining_room" : null,
    /\bbedroom\b/i.test(message) ? "bedroom" : null,
    /\bentryway|entry\b/i.test(message) ? "entryway" : null,
    /\bhallway\b/i.test(message) ? "hallway" : null,
    /\bkitchen\b/i.test(message) ? "kitchen" : null,
  ].filter((value): value is string => Boolean(value));
  const hasMultiRoomSignal = new Set(mentionedRooms).size > 1;

  if (!hasExplicitSize) {
    if (hasMultiRoomSignal) {
      inferredSize = undefined;
    } else if (hasAnchorSignal || softSignals.room === "living_room") {
      if (!suppressRoomSizeInferenceForPractical) {
        inferredSize = { widthIn: 96, lengthIn: 120, toleranceIn: 12 };
      }
    } else if (softSignals.room === "dining_room") {
      if (!suppressRoomSizeInferenceForPractical) {
        inferredSize = { widthIn: 96, lengthIn: 120, toleranceIn: 12 };
      }
    } else if (softSignals.room === "bedroom") {
      if (!suppressRoomSizeInferenceForPractical) {
        inferredSize = { widthIn: 60, lengthIn: 96, toleranceIn: 10 };
      }
    } else if (softSignals.room === "office") {
      if (!suppressRoomSizeInferenceForPractical) {
        inferredSize = { widthIn: 60, lengthIn: 96, toleranceIn: 10 };
      }
    } else if (softSignals.room === "entryway") {
      inferredSize = { widthIn: 36, lengthIn: 60, toleranceIn: 8 };
    } else if (softSignals.room === "kitchen") {
      inferredSize = { widthIn: 24, lengthIn: 96, toleranceIn: 10 };
    } else if (softSignals.room === "hallway") {
      inferredSize = { widthIn: 30, lengthIn: 120, toleranceIn: 8 };
    }
  }

  if (hasPracticalSignal && inferredSize) {
    inferredSize = {
      ...inferredSize,
      toleranceIn: Math.max(inferredSize.toleranceIn ?? 0, 24),
    };
  }

  if (!hasExplicitShape && softSignals.room === "hallway") {
    inferredShape = "runner";
  }

  if (styleTokens.size === 0) {
    if (hasModernSignal && !hasTraditionalSignal) {
      inferredStyles = ["modern"];
    } else if (hasBoldSignal && !hasTraditionalSignal) {
      inferredStyles = ["eclectic", "modern", "contemporary"];
    } else if (hasCalmerSignal && !hasTraditionalSignal) {
      inferredStyles = ["modern", "transitional"];
    } else if (hasElegantSignal && !hasModernSignal) {
      inferredStyles = ["traditional"];
    } else if (hasTraditionalSignal && !hasModernSignal) {
      inferredStyles = hasPersianMention ? ["traditional", "persian"] : ["traditional"];
    }
  } else if (hasPersianMention && !styleTokens.has("persian")) {
    inferredStyles = ["persian"];
  }

  if (!hasExplicitColors && hasNeutralSignal) {
    inferredColors = ["ivory", "gray", "brown"];
    inferredAvoidColors = ["red", "rust", "pink", "purple"];
    inferredAvoidStyles = Array.from(
      new Set([
        ...(inferredAvoidStyles ?? []),
        "tribal",
        "kazak",
        "ornate",
        "traditional",
        "bokhara",
        "kashan",
        "heriz",
        "serapi",
      ])
    );
  }
  if (styleTokens.size === 0 && /\b(no|not|without)\s+(bold\s+)?reds?\b/i.test(message)) {
    inferredStyles = mergeStringTokens(inferredStyles, ["modern", "transitional"]);
    inferredAvoidStyles = Array.from(
      new Set([
        ...(inferredAvoidStyles ?? []),
        "traditional",
        "persian",
        "tribal",
        "kazak",
        "medallion",
        "ornate",
        "heriz",
        "serapi",
      ])
    );
  }
  if (
    !hasExplicitColors &&
    /\b(terracotta|rust|clay|cinnamon)\b/i.test(message) &&
    /\b(cream|ivory)\b/i.test(message)
  ) {
    inferredColors = mergeStringTokens(inferredColors, ["rust", "ivory"]);
  }

  if (hasModernSignal && !hasTraditionalSignal) {
    inferredAvoidStyles = [
      "traditional",
      "tribal",
      "persian",
      "heriz",
      "serapi",
      "kashan",
      "tabriz",
      "isfahan",
      "sultanabad",
      "bidjar",
      "malayer",
      "oushak",
      "medallion",
      "floral",
      "ornate",
      "kazak",
      "shirvan",
      "karabagh",
      "baluch",
      "bokhara",
      "turkmen",
    ];
  } else if (hasTraditionalSignal && !hasModernSignal) {
    inferredAvoidStyles = ["modern", "contemporary", "minimalist", "abstract"];
  }
  if (hasBoldSignal && !hasTraditionalSignal) {
    inferredAvoidStyles = Array.from(
      new Set([
        ...(inferredAvoidStyles ?? []),
        "traditional",
        "persian",
        "heriz",
        "serapi",
        "kashan",
        "tabriz",
        "isfahan",
        "sultanabad",
        "medallion",
      ])
    );
  }
  if (hasPracticalSignal) {
    inferredAvoidStyles = Array.from(
      new Set([
        ...(inferredAvoidStyles ?? []),
        "silk",
        "delicate",
        "antique",
        "vintage",
        "traditional",
        "tribal",
        "ornate",
      ])
    );
  }
  if (hasElegantSignal) {
    inferredAvoidStyles = Array.from(
      new Set([
        ...(inferredAvoidStyles ?? []),
        "kilim",
        "baluch",
        "bokhara",
      ])
    );
  }
  const messageAvoidColors = inferAvoidColorsFromMessage(input.message);
  const messageAvoidStyles = inferAvoidStylesFromMessage(input.message);
  if (messageAvoidColors.length > 0) {
    inferredAvoidColors = Array.from(
      new Set([...(inferredAvoidColors ?? []), ...messageAvoidColors])
    );
  }
  if (messageAvoidStyles.length > 0) {
    inferredAvoidStyles = Array.from(
      new Set([...(inferredAvoidStyles ?? []), ...messageAvoidStyles])
    );
  }

  return {
    inferred_size: inferredSize,
    inferred_colors: inferredColors,
    inferred_shape: inferredShape,
    inferred_styles: inferredStyles,
    inferred_avoid_styles: inferredAvoidStyles,
    inferred_avoid_colors: inferredAvoidColors,
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
  const refinementSignal =
    /\b(prefer|more|less|around|closer|bigger|larger|smaller|shorter|longer|same|like that|like this)\b/i.test(
      normalizeText(input.message)
    );
  const useInheritedBase =
    input.intent === "followup" ||
    input.intent === "reaction" ||
    input.mode === "recommendation_followup" ||
      input.followupIntent !== "none" ||
      refinementSignal;
  const base = useInheritedBase ? input.previous : {};
  const normalizedMessage = normalizeText(input.message);
  const baseStylesNormalized = (base.styles ?? []).map((value) => normalizeText(value));
  const baseHasModernDirection = baseStylesNormalized.some((value) =>
    MODERN_STYLE_TERMS.includes(value as (typeof MODERN_STYLE_TERMS)[number])
  );
  const styleResetByExplicitNegation = /\b(forget|instead|rather|actually|not|no|without|avoid)\b[^.!?]{0,32}\b(modern|contemporary|minimal|minimalist|traditional|persian|tribal|heriz|serapi|kashan|tabriz|isfahan)\b/i.test(
    normalizedMessage
  );
  const styleResetByCalmerPivot =
    /\b(less busy|not too busy|cleaner|cleanest|calmer|simpler|more minimal|more modern)\b/i.test(
      normalizedMessage
    ) && !baseHasModernDirection;
  const hasStyleResetSignal = styleResetByExplicitNegation || styleResetByCalmerPivot;
  const inheritedStyles = hasStyleResetSignal ? undefined : base.styles;
  const avoidColorsFromMessage = inferAvoidColorsFromMessage(input.message);
  const parsedColorsNormalized = normalizeColorList(parsed.colors ?? [], 8);
  const parsedColorsLookLikeAvoid =
    avoidColorsFromMessage.length > 0 &&
    parsedColorsNormalized.length > 0 &&
    parsedColorsNormalized.every((token) => avoidColorsFromMessage.includes(token));
  const effectiveParsedColors = parsedColorsLookLikeAvoid ? [] : parsed.colors;
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
  const hasCurrentStyleDirective =
    (explicit.styles?.length ?? 0) > 0 || parsed.styles.length > 0;
  const hasCurrentColorDirective =
    (explicit.colors?.length ?? 0) > 0 || effectiveParsedColors.length > 0;
  const hasCurrentSizeDirective = Boolean(explicit.size || parsed.size);
  const hasCurrentShapeDirective = Boolean(explicit.shape || parsed.shape);
  const hasRoomRescopeSignal =
    /\b(living room|dining room|bedroom|entryway|entry|hallway|kitchen)\b/i.test(
      normalizeText(input.message)
    );
  const mergedStrictness = {
    size:
      explicit.strictness?.size ??
      (hasCurrentSizeDirective ? input.strictness.size : undefined),
    colors:
      explicit.strictness?.colors ??
      (hasCurrentColorDirective ? input.strictness.colors : undefined),
    styles:
      explicit.strictness?.styles ??
      (hasCurrentStyleDirective ? input.strictness.styles : undefined),
    shape:
      explicit.strictness?.shape ??
      (hasCurrentShapeDirective ? input.strictness.shape : undefined),
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
      : hasRoomRescopeSignal && semantic.inferred_size
        ? semantic.inferred_size
        : base.size ?? semantic.inferred_size ?? undefined;

  let colors = explicit.colors
    ? explicit.colors
    : mergeStringTokens(
        effectiveParsedColors.length > 0 ? effectiveParsedColors : undefined,
        base.colors,
        semantic.inferred_colors
      );
  const explicitNoBoldRedSignal = /\b(no|not|without)\s+(bold\s+)?reds?\b/i.test(
    normalizedMessage
  );
  if (explicitNoBoldRedSignal && !hasCurrentColorDirective) {
    colors = undefined;
  }
  let styles = explicit.styles
    ? explicit.styles
    : mergeStringTokens(
        parsed.styles.length > 0 ? parsed.styles : undefined,
        inheritedStyles,
        semantic.inferred_styles
      );
  const hasPersianMention = /\bpersian\b/i.test(normalizeText(input.message));
  const hasPersianAvoidSignal =
    /\b(no|not|without|avoid|exclude|skip|forget|drop)\b[^.!?]{0,24}\bpersian\b/i.test(
      normalizeText(input.message)
    );
  if (hasPersianMention && !hasPersianAvoidSignal) {
    styles = mergeStringTokens(styles, ["persian"]);
  }
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
    semantic.inferred_avoid_colors ||
    semantic.inferred_avoid_styles
      ? {
          colors: mergeStringTokens(
            hasCurrentColorDirective ? undefined : base.avoid_preferences?.colors,
            semantic.inferred_avoid_colors,
            avoidColorsFromMessage,
            parsedAvoid.colors,
            explicit.avoid_preferences?.colors
          ),
          styles: mergeStringTokens(
            hasCurrentStyleDirective ? undefined : base.avoid_preferences?.styles,
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

  if (styles && styles.length > 0) {
    const avoidStyleSet = new Set(
      (avoidPreferences?.styles ?? []).map((value) => normalizeText(value))
    );
    const normalizedStyles = styles
      .map((value) => normalizeText(value))
      .filter((value) => value.length > 0 && !avoidStyleSet.has(value));
    styles = normalizedStyles.length > 0 ? normalizedStyles : undefined;
  }
  if (colors && colors.length > 0) {
    const avoidColorSet = new Set(
      normalizeColorList(avoidPreferences?.colors ?? [], 8).map((value) =>
        normalizeText(value)
      )
    );
    const normalizedColors = colors
      .map((value) => normalizeText(value))
      .filter((value) => value.length > 0 && !avoidColorSet.has(value));
    colors = normalizedColors.length > 0 ? normalizedColors : undefined;
  }

  const strictness = {
    size: mergedStrictness.size ?? base.strictness?.size ?? "prefer",
    colors: mergedStrictness.colors ?? base.strictness?.colors ?? "prefer",
    styles: mergedStrictness.styles ?? base.strictness?.styles ?? "prefer",
    shape: mergedStrictness.shape ?? base.strictness?.shape ?? "prefer",
  };
  const carryingModernDirection =
    (input.intent === "followup" || input.intent === "reaction") &&
    !hasStyleResetSignal &&
    !hasCurrentStyleDirective &&
    baseStylesNormalized.some((value) =>
      MODERN_STYLE_TERMS.includes(value as (typeof MODERN_STYLE_TERMS)[number])
    );
  const carryingPersianDirection =
    (input.intent === "followup" || input.intent === "reaction") &&
    !hasStyleResetSignal &&
    !hasCurrentStyleDirective &&
    baseStylesNormalized.includes("persian");
  if (carryingModernDirection || carryingPersianDirection) {
    strictness.styles = "must";
  }

  if (
    input.intent === "recommend" &&
    (parsed.styles.length > 0 || explicit.styles?.length) &&
    hasExplicitStyleRequestLanguage(input.message)
  ) {
    strictness.styles = "must";
  }

  if (
    input.intent === "recommend" &&
    !explicit.size &&
    !parsed.size &&
    semantic.inferred_size &&
    hasAnchorRoomLanguage(input.message)
  ) {
    strictness.size = "must";
  }
  if (
    input.intent === "recommend" &&
    /\b(neutral|goes with everything|versatile|subtle palette)\b/i.test(
      normalizeText(input.message)
    ) &&
    Boolean(colors && colors.length > 0)
  ) {
    strictness.colors = "must";
  }
  if (explicitNoBoldRedSignal) {
    strictness.colors = "prefer";
  }

  if (
    (input.intent === "recommend" ||
      input.intent === "followup" ||
      input.intent === "reaction") &&
    Boolean(explicit.shape || parsed.shape)
  ) {
    strictness.shape = "must";
  }
  if (
    /\b(same size|same dimensions|exact same size|exact dimensions)\b/i.test(
      normalizeText(input.message)
    ) &&
    !hasCurrentSizeDirective &&
    Boolean(base.size)
  ) {
    strictness.size = "must";
  }

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
  const supportsDiscoveryIntent =
    input.parsedTurn.intent === "recommend" ||
    input.parsedTurn.intent === "followup" ||
    input.parsedTurn.intent === "reaction";
  if (!supportsDiscoveryIntent) return false;
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
