import type {
  HardConstraints,
  RecommendationConstraintStrictness,
  RecommendationRoomPreference,
  RecommendationShapeConstraint,
} from "@/lib/types/recommendation";
import { extractCanonicalColorsFromText } from "@/lib/config/color-taxonomy";

const MAX_CONSTRAINT_TOKENS = 6;

const STYLE_TERMS: Array<{ token: string; canonical: string }> = [
  { token: "traditional", canonical: "traditional" },
  { token: "transitional", canonical: "transitional" },
  { token: "modern", canonical: "modern" },
  { token: "contemporary", canonical: "modern" },
  { token: "minimalist", canonical: "modern" },
  { token: "abstract", canonical: "modern" },
  { token: "eclectic", canonical: "eclectic" },
  { token: "persian", canonical: "persian" },
  { token: "oushak", canonical: "oushak" },
  { token: "ushak", canonical: "oushak" },
  { token: "heriz", canonical: "heriz" },
  { token: "serapi", canonical: "serapi" },
  { token: "kashan", canonical: "kashan" },
  { token: "tabriz", canonical: "tabriz" },
  { token: "isfahan", canonical: "isfahan" },
  { token: "sarouk", canonical: "sarouk" },
  { token: "sultanabad", canonical: "sultanabad" },
  { token: "bidjar", canonical: "bidjar" },
  { token: "malayer", canonical: "malayer" },
  { token: "kazak", canonical: "kazak" },
  { token: "shirvan", canonical: "shirvan" },
  { token: "kuba", canonical: "kuba" },
  { token: "karabagh", canonical: "karabagh" },
  { token: "gabbeh", canonical: "gabbeh" },
  { token: "kilim", canonical: "kilim" },
  { token: "bokhara", canonical: "bokhara" },
  { token: "ersari", canonical: "ersari" },
  { token: "turkmen", canonical: "turkmen" },
  { token: "beni ourain", canonical: "beni ourain" },
  { token: "azilal", canonical: "azilal" },
  { token: "tribal", canonical: "tribal" },
  { token: "floral", canonical: "floral" },
  { token: "geometric", canonical: "geometric" },
  { token: "medallion", canonical: "medallion" },
  { token: "minimal", canonical: "minimal" },
  { token: "vintage", canonical: "vintage" },
];

const ROOM_TERM_MAP: Array<{
  token: string;
  room: RecommendationRoomPreference;
}> = [
  { token: "living room", room: "living_room" },
  { token: "family room", room: "living_room" },
  { token: "dining room", room: "dining_room" },
  { token: "bedroom", room: "bedroom" },
  { token: "kitchen", room: "kitchen" },
  { token: "hallway", room: "hallway" },
  { token: "hall", room: "hallway" },
  { token: "entryway", room: "entryway" },
  { token: "entry", room: "entryway" },
  { token: "office", room: "office" },
];

const MATERIAL_TERMS = [
  "wool",
  "silk",
  "cotton",
  "jute",
  "synthetic",
  "viscose",
  "nylon",
  "polyester",
] as const;

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number.parseFloat(value.replaceAll(",", "").trim());
    if (Number.isFinite(parsed)) return parsed;
  }

  return null;
}

function normalizeSize(input: unknown): HardConstraints["size"] | undefined {
  if (!input || typeof input !== "object") return undefined;
  const size = input as Record<string, unknown>;

  const widthIn = toNumber(size.widthIn);
  const lengthIn = toNumber(size.lengthIn);
  if (widthIn === null || lengthIn === null) return undefined;

  const toleranceRaw = toNumber(size.toleranceIn);
  const toleranceIn =
    toleranceRaw !== null && toleranceRaw >= 0 ? toleranceRaw : undefined;

  return { widthIn, lengthIn, toleranceIn };
}

function normalizeStringToken(value: unknown, maxChars = 32): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;
  return normalized.replace(/\s+/g, " ").slice(0, maxChars);
}

function parseTokenList(input: unknown): string[] {
  const source: string[] = Array.isArray(input)
    ? input
        .map((item) => (typeof item === "string" ? item : ""))
        .flatMap((item) => item.split(","))
    : typeof input === "string"
      ? input.split(",")
      : [];

  const cleaned = source
    .map((token) => normalizeStringToken(token))
    .filter((token): token is string => token !== null);

  return Array.from(new Set(cleaned)).slice(0, MAX_CONSTRAINT_TOKENS);
}

function normalizeShape(value: unknown): RecommendationShapeConstraint | undefined {
  const token = normalizeStringToken(value);
  if (!token) return undefined;

  if (token === "runner") return "runner";
  if (token === "round" || token === "oval" || token === "round_oval") {
    return "round_oval";
  }
  if (token === "oversized") return "oversized";
  if (token === "area") return "area";
  return undefined;
}

function normalizeStrictnessValue(value: unknown): "must" | "prefer" | undefined {
  const token = normalizeStringToken(value, 8);
  if (!token) return undefined;
  if (token === "must") return "must";
  if (token === "prefer") return "prefer";
  return undefined;
}

function normalizeStrictness(
  value: unknown
): RecommendationConstraintStrictness | undefined {
  if (!value || typeof value !== "object") return undefined;
  const data = value as Record<string, unknown>;
  const strictness: RecommendationConstraintStrictness = {
    size: normalizeStrictnessValue(data.size),
    colors: normalizeStrictnessValue(data.colors),
    styles: normalizeStrictnessValue(data.styles),
    shape: normalizeStrictnessValue(data.shape),
  };

  if (!strictness.size && !strictness.colors && !strictness.styles && !strictness.shape) {
    return undefined;
  }

  return strictness;
}

function normalizeAvoidPreferences(
  value: unknown
): HardConstraints["avoid_preferences"] | undefined {
  if (!value || typeof value !== "object") return undefined;
  const data = value as Record<string, unknown>;
  const colors = parseTokenList(data.colors);
  const styles = parseTokenList(data.styles);
  const shapesRaw: unknown[] = Array.isArray(data.shapes) ? data.shapes : [];
  const shapes = Array.from(
    new Set(
      shapesRaw
        .map((shape) => normalizeShape(shape))
        .filter((shape): shape is RecommendationShapeConstraint => Boolean(shape))
    )
  ).slice(0, MAX_CONSTRAINT_TOKENS);

  if (colors.length === 0 && styles.length === 0 && shapes.length === 0) {
    return undefined;
  }

  return {
    colors: colors.length > 0 ? colors : undefined,
    styles: styles.length > 0 ? styles : undefined,
    shapes: shapes.length > 0 ? shapes : undefined,
  };
}

export function normalizeHardConstraints(input: unknown): HardConstraints {
  if (!input || typeof input !== "object") {
    return {};
  }

  const data = input as Record<string, unknown>;
  const hasColorsKey = Object.prototype.hasOwnProperty.call(data, "colors");
  const hasStylesKey = Object.prototype.hasOwnProperty.call(data, "styles");
  const hasShapeKey = Object.prototype.hasOwnProperty.call(data, "shape");
  const hasStrictnessKey = Object.prototype.hasOwnProperty.call(data, "strictness");
  const hasAvoidKey = Object.prototype.hasOwnProperty.call(
    data,
    "avoid_preferences"
  );
  const size = normalizeSize(data.size);
  const colors = parseTokenList(data.colors);
  const styles = parseTokenList(data.styles);
  const shape = normalizeShape(data.shape);
  const strictness = normalizeStrictness(data.strictness);
  const avoidPreferences = normalizeAvoidPreferences(data.avoid_preferences);

  return {
    size,
    colors: hasColorsKey ? colors : undefined,
    styles: hasStylesKey ? styles : undefined,
    shape: hasShapeKey ? shape : undefined,
    strictness: hasStrictnessKey ? strictness : undefined,
    avoid_preferences: hasAvoidKey ? avoidPreferences : undefined,
  };
}

function parseSizeFromMessage(userMessage: string): HardConstraints["size"] | undefined {
  const text = userMessage.toLowerCase();
  const sizePattern =
    /(\d{1,3}(?:\.\d+)?)\s*(ft|feet|'|in|inch|inches|")?\s*(?:[x×]|\bby\b)\s*(\d{1,3}(?:\.\d+)?)\s*(ft|feet|'|in|inch|inches|")?(?:\s*-?\s*ish)?/i;
  const match = text.match(sizePattern);
  if (!match) return undefined;

  const left = Number.parseFloat(match[1]);
  const right = Number.parseFloat(match[3]);
  if (!Number.isFinite(left) || !Number.isFinite(right)) return undefined;

  const leftUnit = (match[2] ?? "").toLowerCase();
  const rightUnit = (match[4] ?? "").toLowerCase();
  const hasFeetUnit =
    /\b(?:ft|feet)\b/.test(leftUnit) ||
    /\b(?:ft|feet)\b/.test(rightUnit) ||
    leftUnit === "'" ||
    rightUnit === "'";
  const hasInchUnit =
    /\b(?:in|inch|inches)\b/.test(leftUnit) ||
    /\b(?:in|inch|inches)\b/.test(rightUnit) ||
    leftUnit === "\"" ||
    rightUnit === "\"";

  const mentionsInches = hasInchUnit || /\b(?:inch|inches)\b|"/i.test(text);
  const explicitFeet = hasFeetUnit && !hasInchUnit;
  const explicitInches = hasInchUnit && !hasFeetUnit;
  const maxSide = Math.max(left, right);
  const probablyFeet =
    !mentionsInches &&
    ((left <= 30 && right <= 30) ||
      maxSide >= 36 ||
      /\b(?:rug|rugs|runner|hallway|living room|bedroom|dining room|entryway)\b/i.test(
        text
      ));
  const multiplier = explicitFeet ? 12 : explicitInches ? 1 : probablyFeet ? 12 : 1;

  const exactRequested = /\b(?:exact|exactly|no tolerance)\b/i.test(text);
  const approximateRequested =
    /\b(?:around|about|approx|approximately|roughly|near|ish)\b/i.test(text);

  return {
    widthIn: left * multiplier,
    lengthIn: right * multiplier,
    toleranceIn: exactRequested ? 0 : approximateRequested ? 4 : undefined,
  };
}

function includesToken(text: string, token: string): boolean {
  return text.includes(token);
}

function parseColorsFromMessage(userMessage: string): string[] {
  return extractCanonicalColorsFromText(userMessage, MAX_CONSTRAINT_TOKENS);
}

function parseStylesFromMessage(userMessage: string): string[] {
  const text = userMessage.toLowerCase();
  const matches = STYLE_TERMS.filter((entry) =>
    includesToken(text, entry.token)
  ).map((entry) => entry.canonical);
  return Array.from(new Set(matches)).slice(0, MAX_CONSTRAINT_TOKENS);
}

function parseShapeFromMessage(
  userMessage: string
): RecommendationShapeConstraint | undefined {
  const text = userMessage.toLowerCase();
  if (/\brunner\b/.test(text)) return "runner";
  if (/\b(round|circular|circle|oval)\b/.test(text)) return "round_oval";
  if (/\boversized\b/.test(text)) return "oversized";
  if (/\barea rug\b/.test(text)) return "area";
  return undefined;
}

function parseRoomFromMessage(
  userMessage: string
): RecommendationRoomPreference | undefined {
  const text = userMessage.toLowerCase();
  for (const entry of ROOM_TERM_MAP) {
    if (includesToken(text, entry.token)) return entry.room;
  }
  return undefined;
}

function parseMaterialFromMessage(userMessage: string): string | undefined {
  const text = userMessage.toLowerCase();
  const match = MATERIAL_TERMS.find((term) => includesToken(text, term));
  return match ?? undefined;
}

export type ConstraintResetDirectives = {
  clearSize: boolean;
  clearColors: boolean;
  clearStyles: boolean;
  clearShape: boolean;
  clearAll: boolean;
};

function includesAnyPhrase(text: string, phrases: string[]): boolean {
  return phrases.some((phrase) => text.includes(phrase));
}

export function parseConstraintResetDirectives(
  userMessage: string
): ConstraintResetDirectives {
  const text = userMessage.toLowerCase();
  const clearAll = includesAnyPhrase(text, [
    "start over constraints",
    "reset constraints",
    "clear constraints",
    "start over filters",
    "clear all filters",
  ]);

  const clearSize =
    clearAll ||
    /(?:clear|remove|ignore|drop|reset)\s+(?:the\s+)?size/i.test(text) ||
    /\b(?:no|without)\s+size(?:\s+limit)?\b/i.test(text) ||
    /\bany\s+size\b/i.test(text);

  const clearColors =
    clearAll ||
    /(?:clear|remove|ignore|drop|reset)\s+(?:the\s+)?(?:color|colors)/i.test(
      text
    );
  const clearStyles =
    clearAll ||
    /(?:clear|remove|ignore|drop|reset)\s+(?:the\s+)?(?:style|styles)/i.test(
      text
    );
  const clearShape =
    clearAll ||
    /(?:clear|remove|ignore|drop|reset)\s+(?:the\s+)?(?:shape|runner|round|oval)/i.test(
      text
    );

  return {
    clearSize,
    clearColors,
    clearStyles,
    clearShape,
    clearAll,
  };
}

export type SoftPreferenceSignals = {
  style?: string;
  palette?: string;
  room?: RecommendationRoomPreference;
  material?: string;
};

export function normalizeSoftPreferences(input: unknown): SoftPreferenceSignals {
  if (!input || typeof input !== "object") return {};
  const data = input as Record<string, unknown>;

  const style = normalizeStringToken(data.style, 48) ?? undefined;
  const palette = normalizeStringToken(data.palette, 64) ?? undefined;
  const roomToken = normalizeStringToken(data.room, 32);
  const room = ROOM_TERM_MAP.find(
    (entry) => entry.room === roomToken || entry.token === roomToken
  )?.room;
  const material = normalizeStringToken(data.material, 32) ?? undefined;

  return {
    style,
    palette,
    room,
    material,
  };
}

export function extractSoftPreferencesFromUserMessage(
  userMessage: string
): SoftPreferenceSignals {
  if (!userMessage.trim()) return {};

  const styles = parseStylesFromMessage(userMessage);
  const colors = parseColorsFromMessage(userMessage);
  const room = parseRoomFromMessage(userMessage);
  const material = parseMaterialFromMessage(userMessage);

  return {
    style: styles[0],
    palette: colors.length > 0 ? colors.join(", ") : undefined,
    room,
    material,
  };
}

export function extractConstraintsFromUserMessage(
  userMessage: string
): Partial<HardConstraints> {
  if (!userMessage.trim()) return {};

  const size = parseSizeFromMessage(userMessage);
  const colors = parseColorsFromMessage(userMessage);
  const styles = parseStylesFromMessage(userMessage);
  const shape = parseShapeFromMessage(userMessage);

  return {
    size,
    colors: colors.length > 0 ? colors : undefined,
    styles: styles.length > 0 ? styles : undefined,
    shape,
  };
}

export function mergeHardConstraints(
  explicit: HardConstraints,
  inferred: Partial<HardConstraints>
): HardConstraints {
  return {
    size: explicit.size ?? inferred.size,
    colors: explicit.colors ?? inferred.colors,
    styles: explicit.styles ?? inferred.styles,
    shape: explicit.shape ?? inferred.shape,
  };
}
