import type { HardConstraints, InventoryRug } from "@/lib/types/recommendation";
import { resolveEffectiveFields } from "@/lib/inventory/resolve-fields";

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
};

const ROOM_HINTS = [
  "living room",
  "dining room",
  "bedroom",
  "kitchen",
  "hallway",
  "entryway",
  "office",
] as const;

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

const COLOR_HINTS = [
  "red",
  "navy",
  "ivory",
  "gold",
  "rust",
  "teal",
  "brown",
  "green",
  "blue",
  "black",
  "cream",
  "coral",
  "beige",
  "gray",
  "white",
] as const;

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter((value) => value.length > 0)));
}

function extractMessageSignals(userMessage: string): {
  rooms: string[];
  styles: string[];
  colors: string[];
} {
  const normalized = normalizeText(userMessage);
  return {
    rooms: ROOM_HINTS.filter((token) => normalized.includes(token)),
    styles: STYLE_HINTS.filter((token) => normalized.includes(token)),
    colors: COLOR_HINTS.filter((token) => normalized.includes(token)),
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
    ...extractMessageSignals(userMessage).styles,
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
    ...(constraints.colors ?? []).map((color) => normalizeText(color)),
    ...extractMessageSignals(userMessage).colors,
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
  const haystack = normalizeText(
    `${(fields.primary_colors ?? []).join(" ")} ${rug.ai_description ?? ""} ${
      rug.intake_label ?? ""
    }`
  );
  const matches = requested.filter((token) => haystack.includes(token)).length;
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

function scoreRoomSuitability(rug: InventoryRug, userMessage: string): number {
  const rooms = extractMessageSignals(userMessage).rooms;
  if (rooms.length === 0) return 8;

  const inferredShape = inferShapeFromRug(rug);
  const longSide = Math.max(rug.width_total_in ?? 0, rug.length_total_in ?? 0);
  const shortSide = Math.min(rug.width_total_in ?? 0, rug.length_total_in ?? 0);
  const room = rooms[0];

  if (room === "hallway") {
    return inferredShape === "runner" ? 15 : 2;
  }
  if (room === "dining room") {
    return longSide >= 120 && shortSide >= 84 ? 14 : 6;
  }
  if (room === "living room") {
    return longSide >= 96 && shortSide >= 60 ? 13 : 7;
  }
  if (room === "bedroom") {
    return longSide >= 72 && shortSide >= 48 ? 13 : 6;
  }

  return 9;
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

export function shapeCandidatesForAI(
  candidates: InventoryRug[],
  options?: ShapeOptions
): InventoryRug[] {
  const maxCandidates = options?.maxCandidates ?? DEFAULT_MAX_CANDIDATES;
  const constraints = options?.constraints ?? {};
  const userMessage = options?.userMessage ?? "";
  const followupIntent = options?.followupIntent ?? "none";

  const scored = candidates.map((rug) => {
    const baseScore =
      scoreSizeProximity(rug, constraints) +
      scoreStructuredMatch(rug, userMessage, constraints) +
      scoreColorMatch(rug, constraints, userMessage) +
      scoreShapeSuitability(rug, constraints) +
      scoreRoomSuitability(rug, userMessage) +
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
    const diversityPenalty = seenCount * 4;
    if (item.baseScore - diversityPenalty < 10 && selected.length > 0) {
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
