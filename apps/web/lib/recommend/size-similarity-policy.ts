import type { InventorySizePreset } from "@/lib/types/inventory";
import {
  getAdjacentSizePresets,
  getSizePresetDistance,
  toSimilaritySizePreset,
} from "@/lib/inventory/size-presets";

export const DEFAULT_PREFER_ADJACENT_STEPS = 1;
export const DEFAULT_MAX_RELAXED_BUCKET_DISTANCE = 2;
export const DEFAULT_MAX_REASONABLE_LONG_SIDE_RATIO = 1.65;

export type SizeConstraintStrictness = "must" | "prefer";

export function resolveRequestedSizePreset(input: {
  widthIn: number;
  lengthIn: number;
}): InventorySizePreset {
  return toSimilaritySizePreset(input);
}

export function resolveAllowedSizePresets(input: {
  requestedPreset: InventorySizePreset;
  strictness: SizeConstraintStrictness;
}): InventorySizePreset[] {
  if (input.strictness === "must") {
    return [input.requestedPreset];
  }
  return getAdjacentSizePresets(
    input.requestedPreset,
    DEFAULT_PREFER_ADJACENT_STEPS
  );
}

export function isWithinRelaxedBucketDistance(input: {
  requestedPreset: InventorySizePreset;
  candidatePreset: InventorySizePreset;
  maxDistance?: number;
}): boolean {
  const distance = getSizePresetDistance(
    input.requestedPreset,
    input.candidatePreset
  );
  if (distance === null) return false;
  return distance <= (input.maxDistance ?? DEFAULT_MAX_RELAXED_BUCKET_DISTANCE);
}

export function isReasonableLongSideRatio(input: {
  requestedLongSideIn: number;
  candidateLongSideIn: number;
  maxRatio?: number;
}): boolean {
  const requested = Math.max(1, input.requestedLongSideIn);
  const candidate = Math.max(1, input.candidateLongSideIn);
  const ratio = Math.max(requested, candidate) / Math.min(requested, candidate);
  return ratio <= (input.maxRatio ?? DEFAULT_MAX_REASONABLE_LONG_SIDE_RATIO);
}
