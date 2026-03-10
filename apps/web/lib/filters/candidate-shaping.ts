import type { InventoryRug } from "@/lib/types/recommendation";

// Keep candidate list bounded and deterministic.

const DEFAULT_MAX_CANDIDATES = 30;

function stableCandidateOrder(candidates: InventoryRug[]): InventoryRug[] {
  return [...candidates].sort((a, b) => {
    const labelDiff = a.intake_label.localeCompare(b.intake_label);
    if (labelDiff !== 0) return labelDiff;
    return a.id.localeCompare(b.id);
  });
}

export function shapeCandidatesForAI(
  candidates: InventoryRug[],
  options?: { maxCandidates?: number }
): InventoryRug[] {
  const maxCandidates = options?.maxCandidates ?? DEFAULT_MAX_CANDIDATES;

  if (candidates.length <= maxCandidates) {
    return stableCandidateOrder(candidates);
  }

  const ordered = stableCandidateOrder(candidates);
  return ordered.slice(0, maxCandidates);
}
