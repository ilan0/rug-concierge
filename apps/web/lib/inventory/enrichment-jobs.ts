import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  INVENTORY_ENRICHMENT_MAX_ATTEMPTS,
  type InventoryEnrichmentJobState,
  type ReviewReasonCode,
} from "@/lib/inventory/enrichment-state";
import { fetchRugRecordById, type RugRecord } from "@/lib/inventory/rug-record";
import { enhanceRugPrimaryImage, resetRugImageEnhancementState } from "@/lib/inventory/image-enhancement";
import { fetchSourceRugImageUrlsForRugs } from "@/lib/storage/rug-images";
import {
  buildTradeTitle,
  sanitizeFallbackTradeLabel,
} from "@/lib/inventory/title-builder";
import { requestVisionEnrichment } from "@/lib/inventory/vision-enrichment";
import type { InventoryRugStatus } from "@/lib/types/inventory";

export const INVENTORY_ENRICHMENT_WORKER_CLAIM_LIMIT = 5;
export const INVENTORY_ENRICHMENT_WORKER_RUN_BUDGET_MS = 45_000;

const RETRY_DELAYS_MS = [60_000, 5 * 60_000, 15 * 60_000] as const;

export type InventoryEnrichmentJobRow = {
  id: string;
  tenant_id: string;
  rug_id: string;
  state: InventoryEnrichmentJobState;
  attempt_count: number;
  max_attempts: number;
  next_attempt_at: string | null;
  last_error: string | null;
  locked_at: string | null;
  lock_owner: string | null;
  created_at: string;
  updated_at: string;
  restore_available_on_ready: boolean;
};

export type EnqueueInventoryEnrichmentJobInput = {
  tenantId: string;
  rugId: string;
  maxAttempts?: number;
  restoreAvailableOnReady?: boolean;
  supabase?: SupabaseClient;
};

export type EnqueueInventoryEnrichmentJobResult = {
  ok: boolean;
  error: string | null;
};

export type InventoryEnrichmentJobOutcome =
  | "ready"
  | "needs_review_incomplete"
  | "needs_review_non_rug"
  | "retry_scheduled"
  | "needs_review_failed"
  | "skipped_missing_rug";

export type InventoryEnrichmentWorkerSummary = {
  claimed: number;
  processed: number;
  budget_exhausted: boolean;
  outcomes: Record<InventoryEnrichmentJobOutcome, number>;
  errors: string[];
};

export type VisionEnrichmentRequester = typeof requestVisionEnrichment;
export type ImageEnhancementRequester = typeof enhanceRugPrimaryImage;

function getSupabase(input?: SupabaseClient): SupabaseClient {
  return input ?? supabaseAdmin;
}

function nowIso(): string {
  return new Date().toISOString();
}

function clampMaxAttempts(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return INVENTORY_ENRICHMENT_MAX_ATTEMPTS;
  }
  const rounded = Math.floor(value);
  if (rounded < 1) return 1;
  if (rounded > 6) return 6;
  return rounded;
}

function toStringOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toIntegerOrNull(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.floor(value);
}

function toStateOrNull(value: unknown): InventoryEnrichmentJobState | null {
  if (value === "queued") return "queued";
  if (value === "retry_scheduled") return "retry_scheduled";
  if (value === "processing") return "processing";
  if (value === "completed") return "completed";
  if (value === "needs_review") return "needs_review";
  return null;
}

function parseJobRow(value: unknown): InventoryEnrichmentJobRow | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;

  const id = toStringOrNull(row.id);
  const tenantId = toStringOrNull(row.tenant_id);
  const rugId = toStringOrNull(row.rug_id);
  const state = toStateOrNull(row.state);
  const attemptCount = toIntegerOrNull(row.attempt_count);
  const maxAttempts = toIntegerOrNull(row.max_attempts);
  const createdAt = toStringOrNull(row.created_at);
  const updatedAt = toStringOrNull(row.updated_at);
  const restoreAvailableOnReady = row.restore_available_on_ready !== false;

  if (
    !id ||
    !tenantId ||
    !rugId ||
    !state ||
    attemptCount === null ||
    maxAttempts === null ||
    !createdAt ||
    !updatedAt
  ) {
    return null;
  }

  return {
    id,
    tenant_id: tenantId,
    rug_id: rugId,
    state,
    attempt_count: attemptCount,
    max_attempts: maxAttempts,
    next_attempt_at: toStringOrNull(row.next_attempt_at),
    last_error: toStringOrNull(row.last_error),
    locked_at: toStringOrNull(row.locked_at),
    lock_owner: toStringOrNull(row.lock_owner),
    created_at: createdAt,
    updated_at: updatedAt,
    restore_available_on_ready: restoreAvailableOnReady,
  };
}

function getRetryDelayMs(nextAttemptCount: number): number {
  const index = Math.max(0, Math.min(RETRY_DELAYS_MS.length - 1, nextAttemptCount - 1));
  return RETRY_DELAYS_MS[index];
}

function isMissingRestoreAvailabilityColumnError(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("restore_available_on_ready") &&
    (normalized.includes("column") || normalized.includes("schema cache"))
  );
}

function normalizeText(value: string | null | undefined): string {
  if (typeof value !== "string") return "";
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function containsNonRugLanguage(value: string | null | undefined): boolean {
  const text = normalizeText(value);
  if (!text) return false;

  const patterns: readonly RegExp[] = [
    /\bnot\s+(a\s+)?rug\b/i,
    /\bnot\s+(a\s+)?carpet\b/i,
    /\bnon[-\s]?rug\b/i,
    /\bdecorative art piece\b/i,
    /\bmanuscript\b/i,
    /\bnewspaper\b/i,
    /\bpainting\b/i,
    /\bwall art\b/i,
  ];

  return patterns.some((pattern) => pattern.test(text));
}

async function updateRugReviewState(input: {
  supabase: SupabaseClient;
  tenantId: string;
  rugId: string;
  enrichmentStatus: "ready" | "needs_review" | "processing";
  reviewReasonCode: ReviewReasonCode | null;
  status?: InventoryRugStatus;
  intakeLabel?: string | null;
  aiDescription?: string | null;
  aiStructuredFields?: unknown;
}): Promise<void> {
  const payload: Record<string, unknown> = {
    enrichment_status: input.enrichmentStatus,
    review_reason_code: input.reviewReasonCode,
  };

  if (Object.prototype.hasOwnProperty.call(input, "intakeLabel")) {
    payload.intake_label = input.intakeLabel ?? null;
  }
  if (Object.prototype.hasOwnProperty.call(input, "aiDescription")) {
    payload.ai_description = input.aiDescription ?? null;
  }
  if (Object.prototype.hasOwnProperty.call(input, "aiStructuredFields")) {
    payload.ai_structured_fields = input.aiStructuredFields ?? null;
  }
  if (Object.prototype.hasOwnProperty.call(input, "status")) {
    payload.status = input.status ?? null;
  }

  await input.supabase
    .from("rugs")
    .update(payload)
    .eq("tenant_id", input.tenantId)
    .eq("id", input.rugId);
}

async function updateJobState(input: {
  supabase: SupabaseClient;
  jobId: string;
  state: InventoryEnrichmentJobState;
  attemptCount?: number;
  nextAttemptAt?: string | null;
  lastError?: string | null;
}): Promise<void> {
  const payload: Record<string, unknown> = {
    state: input.state,
    locked_at: null,
    lock_owner: null,
    updated_at: nowIso(),
  };

  if (Object.prototype.hasOwnProperty.call(input, "attemptCount")) {
    payload.attempt_count = input.attemptCount;
  }
  if (Object.prototype.hasOwnProperty.call(input, "nextAttemptAt")) {
    payload.next_attempt_at = input.nextAttemptAt ?? null;
  }
  if (Object.prototype.hasOwnProperty.call(input, "lastError")) {
    payload.last_error = input.lastError ?? null;
  }

  await input.supabase
    .from("inventory_enrichment_jobs")
    .update(payload)
    .eq("id", input.jobId);
}

async function scheduleRetryOrFail(input: {
  supabase: SupabaseClient;
  job: InventoryEnrichmentJobRow;
  errorMessage: string;
  reviewReasonCode?: ReviewReasonCode;
}): Promise<InventoryEnrichmentJobOutcome> {
  const nextAttemptCount = input.job.attempt_count + 1;

  if (nextAttemptCount < input.job.max_attempts) {
    const delayMs = getRetryDelayMs(nextAttemptCount);
    const nextAttemptAt = new Date(Date.now() + delayMs).toISOString();
    await updateJobState({
      supabase: input.supabase,
      jobId: input.job.id,
      state: "retry_scheduled",
      attemptCount: nextAttemptCount,
      nextAttemptAt,
      lastError: input.errorMessage,
    });
    return "retry_scheduled";
  }

  await updateRugReviewState({
    supabase: input.supabase,
    tenantId: input.job.tenant_id,
    rugId: input.job.rug_id,
    enrichmentStatus: "needs_review",
    reviewReasonCode: input.reviewReasonCode ?? "ANALYSIS_FAILED",
    status: "not_available",
  });
  await updateJobState({
    supabase: input.supabase,
    jobId: input.job.id,
    state: "needs_review",
    attemptCount: input.job.max_attempts,
    nextAttemptAt: null,
    lastError: input.errorMessage,
  });
  return "needs_review_failed";
}

async function loadSourceImageUrl(input: {
  supabase: SupabaseClient;
  tenantId: string;
  rugId: string;
}): Promise<string | null> {
  const map = await fetchSourceRugImageUrlsForRugs({
    supabase: input.supabase,
    tenantId: input.tenantId,
    rugIds: [input.rugId],
  });
  return map.get(input.rugId) ?? null;
}

export async function processInventoryEnrichmentJob(input: {
  supabase: SupabaseClient;
  job: InventoryEnrichmentJobRow;
  requestVisionEnrichmentFn?: VisionEnrichmentRequester;
  enhanceRugPrimaryImageFn?: ImageEnhancementRequester;
}): Promise<InventoryEnrichmentJobOutcome> {
  const rug = await fetchRugRecordById({
    supabase: input.supabase,
    tenantId: input.job.tenant_id,
    id: input.job.rug_id,
  });

  if (!rug) {
    await updateJobState({
      supabase: input.supabase,
      jobId: input.job.id,
      state: "completed",
      nextAttemptAt: null,
      lastError: "Rug no longer exists.",
    });
    return "skipped_missing_rug";
  }

  const primaryImageUrl = await loadSourceImageUrl({
    supabase: input.supabase,
    tenantId: input.job.tenant_id,
    rugId: input.job.rug_id,
  });

  if (!primaryImageUrl) {
    await updateRugReviewState({
      supabase: input.supabase,
      tenantId: input.job.tenant_id,
      rugId: input.job.rug_id,
      enrichmentStatus: "needs_review",
      reviewReasonCode: "ANALYSIS_FAILED",
      status: "not_available",
    });
    await updateJobState({
      supabase: input.supabase,
      jobId: input.job.id,
      state: "needs_review",
      attemptCount: Math.max(input.job.attempt_count, 1),
      nextAttemptAt: null,
      lastError: "Primary image missing.",
    });
    return "needs_review_failed";
  }

  const requestVision = input.requestVisionEnrichmentFn ?? requestVisionEnrichment;
  const enrichment = await requestVision({
    imageUrl: primaryImageUrl,
    widthTotalIn: rug.width_total_in,
    lengthTotalIn: rug.length_total_in,
  });

  if (!enrichment) {
    return scheduleRetryOrFail({
      supabase: input.supabase,
      job: input.job,
      errorMessage: "Vision enrichment failed or timed out.",
    });
  }

  const detectedAsNonRug =
    enrichment.aiStructuredFields?.is_rug === false ||
    containsNonRugLanguage(enrichment.aiDescription) ||
    containsNonRugLanguage(enrichment.intakeLabel);

  if (detectedAsNonRug) {
    await updateRugReviewState({
      supabase: input.supabase,
      tenantId: input.job.tenant_id,
      rugId: input.job.rug_id,
      enrichmentStatus: "needs_review",
      reviewReasonCode: "NON_RUG_DETECTED",
      status: "not_available",
      intakeLabel: "Non-Rug Image, Needs Review",
      aiDescription: enrichment.aiDescription,
      aiStructuredFields: enrichment.aiStructuredFields,
    });
    await updateJobState({
      supabase: input.supabase,
      jobId: input.job.id,
      state: "needs_review",
      nextAttemptAt: null,
      lastError: "Detected non-rug image content.",
    });
    return "needs_review_non_rug";
  }

  const enhancePrimaryImage = input.enhanceRugPrimaryImageFn ?? enhanceRugPrimaryImage;
  try {
    await enhancePrimaryImage({
      supabase: input.supabase,
      tenantId: input.job.tenant_id,
      rugId: input.job.rug_id,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Image enhancement failed.";
    return scheduleRetryOrFail({
      supabase: input.supabase,
      job: input.job,
      errorMessage: message,
      reviewReasonCode: "IMAGE_ENHANCEMENT_FAILED",
    });
  }

  const deterministicTitle = buildTradeTitle({
    aiFields: enrichment.aiStructuredFields,
    widthTotalIn: rug.width_total_in,
    lengthTotalIn: rug.length_total_in,
    fallbackLabel: enrichment.intakeLabel,
  });

  if (deterministicTitle) {
    await updateRugReviewState({
      supabase: input.supabase,
      tenantId: input.job.tenant_id,
      rugId: input.job.rug_id,
      enrichmentStatus: "ready",
      reviewReasonCode: null,
      status: input.job.restore_available_on_ready ? "available" : "not_available",
      intakeLabel: deterministicTitle,
      aiDescription: enrichment.aiDescription,
      aiStructuredFields: enrichment.aiStructuredFields,
    });

    await updateJobState({
      supabase: input.supabase,
      jobId: input.job.id,
      state: "completed",
      nextAttemptAt: null,
      lastError: null,
    });
    return "ready";
  }

  const fallbackTitle = sanitizeFallbackTradeLabel(enrichment.intakeLabel);
  const fallbackOrExistingTitle = fallbackTitle ?? rug.intake_label ?? null;

  await updateRugReviewState({
    supabase: input.supabase,
    tenantId: input.job.tenant_id,
    rugId: input.job.rug_id,
    enrichmentStatus: "needs_review",
    reviewReasonCode: "ANALYSIS_INCOMPLETE",
    status: "not_available",
    intakeLabel: fallbackOrExistingTitle,
    aiDescription: enrichment.aiDescription,
    aiStructuredFields: enrichment.aiStructuredFields,
  });

  await updateJobState({
    supabase: input.supabase,
    jobId: input.job.id,
    state: "needs_review",
    nextAttemptAt: null,
    lastError: "Structured output incomplete for deterministic title.",
  });

  return "needs_review_incomplete";
}

export async function enqueueInventoryEnrichmentJob(
  input: EnqueueInventoryEnrichmentJobInput
): Promise<EnqueueInventoryEnrichmentJobResult> {
  const supabase = getSupabase(input.supabase);
  const maxAttempts = clampMaxAttempts(input.maxAttempts);
  const restoreAvailableOnReady = input.restoreAvailableOnReady ?? true;

  const basePayload = {
    tenant_id: input.tenantId,
    rug_id: input.rugId,
    state: "queued" as const,
    attempt_count: 0,
    max_attempts: maxAttempts,
    next_attempt_at: null,
    last_error: null,
    locked_at: null,
    lock_owner: null,
    updated_at: nowIso(),
  };

  let result = await supabase
    .from("inventory_enrichment_jobs")
    .upsert(
      {
        ...basePayload,
        restore_available_on_ready: restoreAvailableOnReady,
      },
      { onConflict: "rug_id" }
    );

  if (
    result.error &&
    isMissingRestoreAvailabilityColumnError(result.error.message ?? "")
  ) {
    result = await supabase
      .from("inventory_enrichment_jobs")
      .upsert(basePayload, { onConflict: "rug_id" });
  }

  if (result.error) {
    return { ok: false, error: result.error.message ?? "Unable to enqueue job." };
  }
  return { ok: true, error: null };
}

export async function claimInventoryEnrichmentJobs(input: {
  workerId: string;
  tenantId?: string;
  limit?: number;
  supabase?: SupabaseClient;
}): Promise<InventoryEnrichmentJobRow[]> {
  const supabase = getSupabase(input.supabase);
  const limit = Math.max(
    1,
    Math.min(INVENTORY_ENRICHMENT_WORKER_CLAIM_LIMIT, input.limit ?? INVENTORY_ENRICHMENT_WORKER_CLAIM_LIMIT)
  );

  if (typeof input.tenantId === "string" && input.tenantId.trim().length > 0) {
    const tenantId = input.tenantId.trim();
    const now = nowIso();
    const candidateResult = await supabase
      .from("inventory_enrichment_jobs")
      .select("*")
      .eq("tenant_id", tenantId)
      .in("state", ["queued", "retry_scheduled"])
      .is("lock_owner", null)
      .or(`next_attempt_at.is.null,next_attempt_at.lte.${now}`)
      .order("created_at", { ascending: true })
      .limit(limit);

    if (candidateResult.error || !Array.isArray(candidateResult.data)) {
      throw new Error(
        candidateResult.error?.message ?? "Unable to claim tenant enrichment jobs."
      );
    }

    const candidateIds = candidateResult.data
      .map((row) => toStringOrNull((row as Record<string, unknown>).id))
      .filter((id): id is string => Boolean(id));
    if (candidateIds.length === 0) return [];

    const lockPayload = {
      state: "processing" as const,
      lock_owner: input.workerId,
      locked_at: nowIso(),
      updated_at: nowIso(),
    };
    const lockedResult = await supabase
      .from("inventory_enrichment_jobs")
      .update(lockPayload)
      .eq("tenant_id", tenantId)
      .in("id", candidateIds)
      .is("lock_owner", null)
      .select("*");

    if (lockedResult.error || !Array.isArray(lockedResult.data)) {
      throw new Error(
        lockedResult.error?.message ?? "Unable to lock tenant enrichment jobs."
      );
    }

    return lockedResult.data
      .map((row) => parseJobRow(row))
      .filter((row): row is InventoryEnrichmentJobRow => row !== null);
  }

  const result = await supabase.rpc("claim_inventory_enrichment_jobs", {
    claim_limit: limit,
    worker_id: input.workerId,
  });

  if (result.error || !Array.isArray(result.data)) {
    throw new Error(result.error?.message ?? "Unable to claim enrichment jobs.");
  }

  return result.data
    .map((row) => parseJobRow(row))
    .filter((row): row is InventoryEnrichmentJobRow => row !== null);
}

export async function runInventoryEnrichmentWorker(input: {
  workerId: string;
  tenantId?: string;
  claimLimit?: number;
  runBudgetMs?: number;
  supabase?: SupabaseClient;
  requestVisionEnrichmentFn?: VisionEnrichmentRequester;
  enhanceRugPrimaryImageFn?: ImageEnhancementRequester;
}): Promise<InventoryEnrichmentWorkerSummary> {
  const supabase = getSupabase(input.supabase);
  const runBudgetMs = Math.max(10_000, Math.min(55_000, input.runBudgetMs ?? INVENTORY_ENRICHMENT_WORKER_RUN_BUDGET_MS));

  const outcomes: Record<InventoryEnrichmentJobOutcome, number> = {
    ready: 0,
    needs_review_incomplete: 0,
    needs_review_non_rug: 0,
    retry_scheduled: 0,
    needs_review_failed: 0,
    skipped_missing_rug: 0,
  };
  const errors: string[] = [];

  const claimed = await claimInventoryEnrichmentJobs({
    workerId: input.workerId,
    tenantId: input.tenantId,
    limit: input.claimLimit,
    supabase,
  });

  const startedAt = Date.now();
  let processed = 0;
  let budgetExhausted = false;

  for (const job of claimed) {
    if (Date.now() - startedAt >= runBudgetMs) {
      budgetExhausted = true;
      break;
    }

    try {
      const outcome = await processInventoryEnrichmentJob({
        supabase,
        job,
        requestVisionEnrichmentFn: input.requestVisionEnrichmentFn,
        enhanceRugPrimaryImageFn: input.enhanceRugPrimaryImageFn,
      });
      outcomes[outcome] += 1;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unexpected enrichment worker error.";
      errors.push(`job=${job.id}: ${message}`);

      try {
        const outcome = await scheduleRetryOrFail({
          supabase,
          job,
          errorMessage: message,
        });
        outcomes[outcome] += 1;
      } catch (scheduleError) {
        const scheduleMessage =
          scheduleError instanceof Error
            ? scheduleError.message
            : "Unable to schedule retry after worker failure.";
        errors.push(`job=${job.id}: ${scheduleMessage}`);
      }
    }

    processed += 1;
  }

  return {
    claimed: claimed.length,
    processed,
    budget_exhausted: budgetExhausted,
    outcomes,
    errors,
  };
}

export async function setRugProcessingState(input: {
  tenantId: string;
  rugId: string;
  currentStatus?: InventoryRugStatus | null;
  currentEnrichmentStatus?: "processing" | "ready" | "needs_review" | null;
  supabase?: SupabaseClient;
}): Promise<{ restoreAvailableOnReady: boolean }> {
  const supabase = getSupabase(input.supabase);
  let status = input.currentStatus ?? null;
  let enrichmentStatus = input.currentEnrichmentStatus ?? null;

  if (!status || !enrichmentStatus) {
    const existing = await fetchRugRecordById({
      supabase,
      tenantId: input.tenantId,
      id: input.rugId,
    });
    status = existing?.status ?? status ?? null;
    enrichmentStatus = existing?.enrichment_status ?? enrichmentStatus ?? null;
  }

  const restoreAvailableOnReady =
    status === "available" && enrichmentStatus === "ready";

  await updateRugReviewState({
    supabase,
    tenantId: input.tenantId,
    rugId: input.rugId,
    enrichmentStatus: "processing",
    reviewReasonCode: null,
    status: "not_available",
  });

  await resetRugImageEnhancementState({
    supabase,
    tenantId: input.tenantId,
    rugId: input.rugId,
  });

  return { restoreAvailableOnReady };
}

export function deriveRugLabelForDuplicate(rug: RugRecord | null): string | null {
  if (!rug) return null;
  const staffLabel = toStringOrNull(rug.staff_overrides?.label ?? null);
  if (staffLabel) return staffLabel;
  return toStringOrNull(rug.intake_label);
}
