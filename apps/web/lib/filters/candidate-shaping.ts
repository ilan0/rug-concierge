import type { InventoryRug } from "@/lib/types/recommendation";

// Keep candidate list bounded and deterministic.

const DEFAULT_MAX_CANDIDATES = 30;

function stableCandidateOrder(candidates: InventoryRug[]): InventoryRug[] {
  return [...candidates].sort((a, b) => {
    const aLabel = a.intake_label ?? "";
    const bLabel = b.intake_label ?? "";
    const labelDiff = aLabel.localeCompare(bLabel);
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
