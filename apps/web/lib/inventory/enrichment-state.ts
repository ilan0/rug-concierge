export const ENRICHMENT_STATUS_VALUES = [
  "processing",
  "ready",
  "needs_review",
] as const;

export type EnrichmentStatus = (typeof ENRICHMENT_STATUS_VALUES)[number];

export const REVIEW_REASON_CODES = [
  "ANALYSIS_INCOMPLETE",
  "ANALYSIS_FAILED",
] as const;

export type ReviewReasonCode = (typeof REVIEW_REASON_CODES)[number];

export const JOB_STATE_VALUES = [
  "queued",
  "retry_scheduled",
  "processing",
  "completed",
  "needs_review",
] as const;

export type InventoryEnrichmentJobState = (typeof JOB_STATE_VALUES)[number];

export const INVENTORY_ENRICHMENT_MAX_ATTEMPTS = 3;

export function isEnrichmentStatus(value: unknown): value is EnrichmentStatus {
  return (
    typeof value === "string" &&
    (ENRICHMENT_STATUS_VALUES as readonly string[]).includes(value)
  );
}

export function isReviewReasonCode(value: unknown): value is ReviewReasonCode {
  return (
    typeof value === "string" &&
    (REVIEW_REASON_CODES as readonly string[]).includes(value)
  );
}

export function reviewReasonMessage(
  code: ReviewReasonCode | null | undefined
): string {
  if (code === "ANALYSIS_INCOMPLETE") {
    return "Analysis incomplete - AI couldn't confidently identify this rug, please verify details manually.";
  }
  if (code === "ANALYSIS_FAILED") {
    return "Analysis failed - tap Re-analyze to try again, or enter details manually.";
  }
  return "Needs review - please verify this rug manually.";
}

