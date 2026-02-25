import type { HardConstraints } from "@/lib/types/recommendation";

// PSEUDOCODE
// - Normalize constraints from request body into safe numeric values.
// - Parse lightweight constraints from user message (size + budget).
// - Merge both sources, with explicit request constraints taking precedence.

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
  const budgetRaw = toNumber(data.budgetMax);
  const budgetMax = budgetRaw !== null && budgetRaw >= 0 ? budgetRaw : undefined;
  const size = normalizeSize(data.size);

  return { budgetMax, size };
}

function parseBudgetMax(userMessage: string): number | undefined {
  const text = userMessage.toLowerCase();
  const budgetPattern =
    /\b(?:under|below|up to|max|maximum|at most|budget(?:\s*(?:is|:))?)\s*\$?\s*([\d,.]+)\s*(k)?\b/i;
  const match = text.match(budgetPattern);
  if (!match) return undefined;

  const base = Number.parseFloat(match[1].replaceAll(",", ""));
  if (!Number.isFinite(base)) return undefined;

  const multiplier = match[2] ? 1000 : 1;
  const value = base * multiplier;
  return value >= 0 ? value : undefined;
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
  clearBudget: boolean;
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

  const clearBudget =
    clearAll ||
    /(?:clear|remove|ignore|drop|reset)\s+(?:the\s+)?budget/i.test(text);
  const clearSize =
    clearAll || /(?:clear|remove|ignore|drop|reset)\s+(?:the\s+)?size/i.test(text);

  return {
    clearBudget,
    clearSize,
    clearAll,
  };
}

export function extractConstraintsFromUserMessage(
  userMessage: string
): Partial<HardConstraints> {
  if (!userMessage.trim()) return {};

  const budgetMax = parseBudgetMax(userMessage);
  const size = parseSizeFromMessage(userMessage);

  return {
    budgetMax,
    size,
  };
}

export function mergeHardConstraints(
  explicit: HardConstraints,
  inferred: Partial<HardConstraints>
): HardConstraints {
  return {
    budgetMax:
      typeof explicit.budgetMax === "number"
        ? explicit.budgetMax
        : inferred.budgetMax,
    size: explicit.size ?? inferred.size,
  };
}
