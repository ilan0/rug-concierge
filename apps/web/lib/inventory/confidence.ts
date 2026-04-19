export const RUG_CONFIDENCE_VALUES = ["low", "medium", "high"] as const;

export type RugConfidence = (typeof RUG_CONFIDENCE_VALUES)[number];

const CONFIDENCE_ORDER: Record<RugConfidence, number> = {
  low: 0,
  medium: 1,
  high: 2,
};

export function normalizeConfidence(value: unknown): RugConfidence | null {
  return typeof value === "string" &&
    (RUG_CONFIDENCE_VALUES as readonly string[]).includes(value)
    ? (value as RugConfidence)
    : null;
}

export function isConfidenceAtLeast(
  value: RugConfidence | null | undefined,
  minimum: RugConfidence
): boolean {
  const normalized = normalizeConfidence(value);
  if (!normalized) return false;
  return CONFIDENCE_ORDER[normalized] >= CONFIDENCE_ORDER[minimum];
}

export function confidenceForValue(
  valuePresent: boolean,
  confidence: RugConfidence | null | undefined
): RugConfidence | null {
  const normalized = normalizeConfidence(confidence);
  if (normalized) return normalized;
  return valuePresent ? "medium" : null;
}
