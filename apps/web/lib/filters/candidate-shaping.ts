import type { InventoryRug } from "@/lib/types/recommendation";

// PSEUDOCODE
// - Keep candidate list small enough for AI context.
// - Keep ordering deterministic.
// - Avoid complex diversification logic in V1.

const DEFAULT_MAX_CANDIDATES = 30;

function priceForSort(rug: InventoryRug): number {
  const price = rug.sale_price_usd ?? rug.price_usd;
  return typeof price === "number" ? price : Number.POSITIVE_INFINITY;
}

function stableCandidateOrder(candidates: InventoryRug[]): InventoryRug[] {
  return [...candidates].sort((a, b) => {
    const priceDiff = priceForSort(a) - priceForSort(b);
    if (priceDiff !== 0) return priceDiff;
    return a.label.localeCompare(b.label);
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
