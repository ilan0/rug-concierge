import type { HardConstraints } from "@/lib/types/recommendation";

// Constraint normalization and lightweight extraction from user text.

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

export function normalizeHardConstraints(input: unknown): HardConstraints {
  if (!input || typeof input !== "object") {
    return {};
  }

  const data = input as Record<string, unknown>;
  const size = normalizeSize(data.size);

  return { size };
}

function parseSizeFromMessage(userMessage: string): HardConstraints["size"] | undefined {
  const text = userMessage.toLowerCase();
  const sizePattern =
    /(\d{1,3}(?:\.\d+)?)\s*(?:ft|feet|')?\s*[x×]\s*(\d{1,3}(?:\.\d+)?)\s*(?:ft|feet|')?(?:\s*-?\s*ish)?/i;
  const match = text.match(sizePattern);
  if (!match) return undefined;

  const left = Number.parseFloat(match[1]);
  const right = Number.parseFloat(match[2]);
  if (!Number.isFinite(left) || !Number.isFinite(right)) return undefined;

  const mentionsInches = /\b(?:inch|inches)\b|"/i.test(text);
  const probablyFeet = !mentionsInches && left <= 30 && right <= 30;
  const multiplier = probablyFeet ? 12 : 1;

  const exactRequested = /\b(?:exact|exactly|no tolerance)\b/i.test(text);
  const approximateRequested =
    /\b(?:around|about|approx|approximately|roughly|near|ish)\b/i.test(text);

  return {
    widthIn: left * multiplier,
    lengthIn: right * multiplier,
    toleranceIn: exactRequested ? 0 : approximateRequested ? 4 : undefined,
  };
}

export type ConstraintResetDirectives = {
  clearSize: boolean;
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
  ]);

  const clearSize =
    clearAll ||
    /(?:clear|remove|ignore|drop|reset)\s+(?:the\s+)?size/i.test(text) ||
    /\b(?:no|without)\s+size(?:\s+limit)?\b/i.test(text) ||
    /\bany\s+size\b/i.test(text);

  return {
    clearSize,
    clearAll,
  };
}

export function extractConstraintsFromUserMessage(
  userMessage: string
): Partial<HardConstraints> {
  if (!userMessage.trim()) return {};

  const size = parseSizeFromMessage(userMessage);

  return {
    size,
  };
}

export function mergeHardConstraints(
  explicit: HardConstraints,
  inferred: Partial<HardConstraints>
): HardConstraints {
  return {
    size: explicit.size ?? inferred.size,
  };
}
