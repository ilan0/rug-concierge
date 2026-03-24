import type { HardConstraints, InventoryRug } from "@/lib/types/recommendation";
import { resolveEffectiveFields } from "@/lib/inventory/resolve-fields";
import {
  expandColorRequestToFamily,
  extractCanonicalColorsFromText,
  normalizeColorList,
} from "@/lib/config/color-taxonomy";

// Keep candidate list bounded and deterministic with a quality-first pre-score.

const DEFAULT_MAX_CANDIDATES = 30;

type FollowupIntent =
  | "none"
  | "closest"
  | "larger"
  | "smaller"
  | "more_like_this"
  | "tighten";

type ShapeName = "runner" | "round_oval" | "oversized" | "area";

type ShapeOptions = {
  maxCandidates?: number;
  constraints?: HardConstraints;
  userMessage?: string;
  followupIntent?: FollowupIntent;
  discoveryMode?: boolean;
};

const STYLE_HINTS = [
  "traditional",
  "transitional",
  "modern",
  "eclectic",
  "persian",
  "heriz",
  "serapi",
  "oushak",
  "gabbeh",
  "kilim",
  "tribal",
  "floral",
  "geometric",
] as const;

const AVOID_CONTEXT_PHRASES = [
  "avoid",
  "no",
  "not",
  "without",
  "skip",
  "exclude",
  "except",
  "don't want",
  "dont want",
  "rather than",
  "instead of",
] as const;

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter((value) => value.length > 0)));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function splitMessageSegments(userMessage: string): string[] {
  return normalizeText(userMessage)
    .split(/(?:[.!?;]+|\bbut\b|\bexcept\b|\brather than\b|\binstead of\b)/i)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
}

function splitSegmentAroundAvoidPhrase(segment: string): {
  requestedSegment: string;
  avoidSegment: string;
} {
  let matchIndex = Number.POSITIVE_INFINITY;
  let matchLength = 0;

  for (const phrase of AVOID_CONTEXT_PHRASES) {
    const match = new RegExp(`\\b${escapeRegExp(phrase)}\\b`, "i").exec(segment);
    if (!match || typeof match.index !== "number") continue;
    if (match.index >= matchIndex) continue;
    matchIndex = match.index;
    matchLength = match[0].length;
  }

  if (!Number.isFinite(matchIndex)) {
    return {
      requestedSegment: segment,
      avoidSegment: "",
    };
  }

  return {
    requestedSegment: segment.slice(0, matchIndex).trim(),
    avoidSegment: segment.slice(matchIndex + matchLength).trim(),
  };
}

function extractStyleTokens(text: string): string[] {
  return STYLE_HINTS.filter((token) =>
    new RegExp(`\\b${escapeRegExp(token)}\\b`, "i").test(text)
  );
}

function extractMessageSignals(userMessage: string): {
  requestedStyles: string[];
  requestedColors: string[];
  avoidStyles: string[];
  avoidColors: string[];
} {
  const requestedStyles: string[] = [];
  const requestedColors: string[] = [];
  const avoidStyles: string[] = [];
  const avoidColors: string[] = [];

  for (const segment of splitMessageSegments(userMessage)) {
    const { requestedSegment, avoidSegment } = splitSegmentAroundAvoidPhrase(segment);

    if (requestedSegment) {
      requestedColors.push(...extractCanonicalColorsFromText(requestedSegment, 8));
      requestedStyles.push(...extractStyleTokens(requestedSegment));
    }

    if (avoidSegment) {
      avoidColors.push(...extractCanonicalColorsFromText(avoidSegment, 8));
      avoidStyles.push(...extractStyleTokens(avoidSegment));
    }
  }

  return {
    requestedStyles: unique(requestedStyles),
    requestedColors: unique(requestedColors),
    avoidStyles: unique(avoidStyles),
    avoidColors: unique(avoidColors),
  };
}

function inferShapeFromRug(rug: InventoryRug): ShapeName {
  const width = rug.width_total_in;
  const length = rug.length_total_in;
  const text = normalizeText(`${rug.intake_label ?? ""} ${rug.ai_description ?? ""}`);
  const hasRoundKeyword = /\b(round|circular|circle|oval)\b/.test(text);
  if (hasRoundKeyword) return "round_oval";

  if (typeof width !== "number" || typeof length !== "number") {
    return "area";
  }

  const shortSide = Math.min(width, length);
  const longSide = Math.max(width, length);
  if (shortSide <= 42 && longSide >= 84 && longSide / shortSide >= 2.2) {
    return "runner";
  }
  if (shortSide >= 84 && longSide >= 133) {
    return "oversized";
  }
  return "area";
}

function getSizeDistanceIn(rug: InventoryRug, constraints: HardConstraints): number | null {
  if (
    !constraints.size ||
    typeof rug.width_total_in !== "number" ||
    typeof rug.length_total_in !== "number"
  ) {
    return null;
  }

  const direct =
    Math.abs(rug.width_total_in - constraints.size.widthIn) +
    Math.abs(rug.length_total_in - constraints.size.lengthIn);
  const rotated =
    Math.abs(rug.width_total_in - constraints.size.lengthIn) +
    Math.abs(rug.length_total_in - constraints.size.widthIn);
  return Math.min(direct, rotated);
}

function scoreSizeProximity(rug: InventoryRug, constraints: HardConstraints): number {
  const distance = getSizeDistanceIn(rug, constraints);
  if (distance === null) return 20;
  if (distance <= 2) return 40;
  if (distance <= 6) return 34;
  if (distance <= 12) return 28;
  if (distance <= 24) return 20;
  return 8;
}

function scoreStructuredMatch(
  rug: InventoryRug,
  userMessage: string,
  constraints: HardConstraints
): number {
  const signals = unique([
    ...extractMessageSignals(userMessage).requestedStyles,
    ...((constraints.styles ?? []).map((value) => normalizeText(value))),
  ]);
  if (signals.length === 0) return 10;

  const fields = rug.effective_fields
    ? rug.effective_fields
    : resolveEffectiveFields(
        rug.intake_label ?? null,
        rug.ai_structured_fields ?? null,
        rug.staff_overrides ?? null,
        rug.ai_description ?? null
      );

  const haystack = normalizeText(
    [
      fields.style ?? "",
      fields.origin ?? "",
      fields.mood ?? "",
      ...(fields.pattern ?? []),
      rug.ai_description ?? "",
      rug.intake_label ?? "",
    ].join(" ")
  );

  const matches = signals.filter((token) => haystack.includes(token)).length;
  if (matches >= 3) return 20;
  if (matches === 2) return 16;
  if (matches === 1) return 12;
  return 4;
}

function scoreColorMatch(rug: InventoryRug, constraints: HardConstraints, userMessage: string): number {
  const requested = unique([
    ...normalizeColorList(constraints.colors ?? [], 8),
    ...extractMessageSignals(userMessage).requestedColors,
  ]);
  if (requested.length === 0) return 8;

  const fields = rug.effective_fields
    ? rug.effective_fields
    : resolveEffectiveFields(
        rug.intake_label ?? null,
        rug.ai_structured_fields ?? null,
        rug.staff_overrides ?? null,
        rug.ai_description ?? null
      );
  const candidateColors = new Set([
    ...normalizeColorList(fields.primary_colors ?? [], 8),
    ...extractCanonicalColorsFromText(
      normalizeText(
        [
          fields.label ?? "",
          fields.origin ?? "",
          fields.style ?? "",
          fields.mood ?? "",
          ...(fields.pattern ?? []),
          rug.ai_description ?? "",
          rug.intake_label ?? "",
          ...(fields.primary_colors ?? []),
        ].join(" ")
      ),
      8
    ),
  ]);
  const requestedColors = expandColorRequestToFamily(requested);
  const matches = requestedColors.filter((token) => candidateColors.has(token))
    .length;
  if (matches >= 2) return 15;
  if (matches === 1) return 11;
  return 3;
}

function scoreShapeSuitability(rug: InventoryRug, constraints: HardConstraints): number {
  const inferredShape = inferShapeFromRug(rug);
  if (!constraints.shape) return 8;
  if (constraints.shape === inferredShape) return 15;
  if (constraints.shape === "area" && inferredShape === "oversized") return 11;
  return 2;
}

function scoreMetadataCompleteness(rug: InventoryRug): number {
  const fields = rug.effective_fields
    ? rug.effective_fields
    : resolveEffectiveFields(
        rug.intake_label ?? null,
        rug.ai_structured_fields ?? null,
        rug.staff_overrides ?? null,
        rug.ai_description ?? null
      );

  let score = 0;
  if (rug.ai_description && rug.ai_description.trim().length > 0) score += 4;
  if (fields.origin) score += 1;
  if (fields.style) score += 1;
  if (fields.mood) score += 1;
  if ((fields.pattern ?? []).length > 0) score += 1;
  if ((fields.primary_colors ?? []).length > 0) score += 2;
  return score;
}

function toCandidateColorTokens(rug: InventoryRug): Set<string> {
  const fields = rug.effective_fields
    ? rug.effective_fields
    : resolveEffectiveFields(
        rug.intake_label ?? null,
        rug.ai_structured_fields ?? null,
        rug.staff_overrides ?? null,
        rug.ai_description ?? null
      );

  return new Set([
    ...normalizeColorList(fields.primary_colors ?? [], 8),
    ...extractCanonicalColorsFromText(
      normalizeText(
        [
          fields.label ?? "",
          fields.origin ?? "",
          fields.style ?? "",
          fields.mood ?? "",
          ...(fields.pattern ?? []),
          rug.ai_description ?? "",
          rug.intake_label ?? "",
          ...(fields.primary_colors ?? []),
        ].join(" ")
      ),
      8
    ),
  ]);
}

function scoreAvoidPenalty(rug: InventoryRug, userMessage: string, constraints: HardConstraints): number {
  const signals = extractMessageSignals(userMessage);
  const avoidColors = unique([
    ...normalizeColorList(constraints.avoid_preferences?.colors ?? [], 8),
    ...signals.avoidColors,
  ]);
  const avoidStyles = unique([
    ...((constraints.avoid_preferences?.styles ?? []).map((value) =>
      normalizeText(value)
    )),
    ...signals.avoidStyles.map((value) => normalizeText(value)),
  ]);
  const avoidShapes = Array.from(
    new Set(constraints.avoid_preferences?.shapes ?? [])
  );

  if (
    avoidColors.length === 0 &&
    avoidStyles.length === 0 &&
    avoidShapes.length === 0
  ) {
    return 0;
  }

  const fields = rug.effective_fields
    ? rug.effective_fields
    : resolveEffectiveFields(
        rug.intake_label ?? null,
        rug.ai_structured_fields ?? null,
        rug.staff_overrides ?? null,
        rug.ai_description ?? null
      );
  const candidateColors = toCandidateColorTokens(rug);
  const candidateText = normalizeText(
    [
      fields.label ?? "",
      rug.intake_label ?? "",
      rug.ai_description ?? "",
      fields.style ?? "",
      fields.origin ?? "",
      fields.mood ?? "",
      ...(fields.pattern ?? []),
    ].join(" ")
  );

  const avoidedColorTokens = expandColorRequestToFamily(avoidColors);
  const colorMatches = avoidedColorTokens.filter((token) => candidateColors.has(token))
    .length;
  const styleMatches = avoidStyles.filter((token) =>
    candidateText.includes(token)
  ).length;
  const candidateShape = inferShapeFromRug(rug);
  const shapeMatches = avoidShapes.includes(candidateShape) ? 1 : 0;

  const colorPenalty = Math.min(colorMatches * 16, 32);
  const stylePenalty = Math.min(styleMatches * 12, 24);
  const shapePenalty = shapeMatches > 0 ? 18 : 0;
  return -(colorPenalty + stylePenalty + shapePenalty);
}

function followupBias(
  rug: InventoryRug,
  constraints: HardConstraints,
  followupIntent: FollowupIntent
): number {
  if (
    followupIntent !== "larger" &&
    followupIntent !== "smaller" &&
    followupIntent !== "closest"
  ) {
    return 0;
  }

  const distance = getSizeDistanceIn(rug, constraints);
  if (distance === null || !constraints.size) return 0;
  const longSide = Math.max(rug.width_total_in ?? 0, rug.length_total_in ?? 0);
  const targetLongSide = Math.max(constraints.size.widthIn, constraints.size.lengthIn);

  if (followupIntent === "closest") {
    return Math.max(0, 8 - distance / 4);
  }
  if (followupIntent === "larger") {
    return longSide >= targetLongSide ? 6 : -6;
  }
  if (followupIntent === "smaller") {
    return longSide <= targetLongSide ? 6 : -6;
  }
  return 0;
}

function diversityKey(rug: InventoryRug): string {
  const fields = rug.effective_fields
    ? rug.effective_fields
    : resolveEffectiveFields(
        rug.intake_label ?? null,
        rug.ai_structured_fields ?? null,
        rug.staff_overrides ?? null,
        rug.ai_description ?? null
      );
  return normalizeText(
    `${fields.style ?? ""}|${fields.origin ?? ""}|${fields.mood ?? ""}|${
      fields.primary_colors?.[0] ?? ""
    }|${fields.pattern?.[0] ?? ""}`
  );
}

function scoreDiscoveryRange(rug: InventoryRug): number {
  const fields = rug.effective_fields
    ? rug.effective_fields
    : resolveEffectiveFields(
        rug.intake_label ?? null,
        rug.ai_structured_fields ?? null,
        rug.staff_overrides ?? null,
        rug.ai_description ?? null
      );

  let score = 0;
  if (fields.style) score += 4;
  if (fields.origin) score += 4;
  if (fields.mood) score += 3;
  if ((fields.pattern ?? []).length > 0) score += 3;
  if ((fields.primary_colors ?? []).length > 0) score += 4;
  return score;
}

export function shapeCandidatesForAI(
  candidates: InventoryRug[],
  options?: ShapeOptions
): InventoryRug[] {
  const maxCandidates = options?.maxCandidates ?? DEFAULT_MAX_CANDIDATES;
  const constraints = options?.constraints ?? {};
  const userMessage = options?.userMessage ?? "";
  const followupIntent = options?.followupIntent ?? "none";
  const discoveryMode = options?.discoveryMode ?? false;

  const scored = candidates.map((rug) => {
    const baseScore = discoveryMode
      ? scoreMetadataCompleteness(rug) + scoreDiscoveryRange(rug)
      : scoreSizeProximity(rug, constraints) +
        scoreStructuredMatch(rug, userMessage, constraints) +
        scoreColorMatch(rug, constraints, userMessage) +
        scoreShapeSuitability(rug, constraints) +
        scoreAvoidPenalty(rug, userMessage, constraints) +
        scoreMetadataCompleteness(rug) +
        followupBias(rug, constraints, followupIntent);

    return { rug, baseScore };
  });

  scored.sort((a, b) => {
    if (b.baseScore !== a.baseScore) return b.baseScore - a.baseScore;
    const aLabel = (a.rug.effective_fields?.label ?? a.rug.intake_label ?? "").toLowerCase();
    const bLabel = (b.rug.effective_fields?.label ?? b.rug.intake_label ?? "").toLowerCase();
    const labelDiff = aLabel.localeCompare(bLabel);
    if (labelDiff !== 0) return labelDiff;
    return a.rug.id.localeCompare(b.rug.id);
  });

  const selected: InventoryRug[] = [];
  const seenKeys = new Map<string, number>();

  for (const item of scored) {
    if (selected.length >= maxCandidates) break;

    const key = diversityKey(item.rug);
    const seenCount = seenKeys.get(key) ?? 0;
    const diversityPenalty = seenCount * (discoveryMode ? 6 : 4);
    const minimumScore = discoveryMode ? 8 : 10;
    if (item.baseScore - diversityPenalty < minimumScore && selected.length > 0) {
      continue;
    }

    selected.push(item.rug);
    seenKeys.set(key, seenCount + 1);
  }

  if (selected.length >= maxCandidates || selected.length >= scored.length) {
    return selected.slice(0, maxCandidates);
  }

  for (const item of scored) {
    if (selected.length >= maxCandidates) break;
    if (selected.some((rug) => rug.id === item.rug.id)) continue;
    selected.push(item.rug);
  }

  return selected.slice(0, maxCandidates);
}
