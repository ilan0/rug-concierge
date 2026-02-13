import type { HardConstraints, InventoryRug } from "@/lib/types/recommendation";
import { getSizeBounds, matchesSizeWithBounds } from "@/lib/filters/size-bounds";

// PSEUDOCODE
// For each rug:
// - availability is always hard -> only `available` rugs stay
// - if budget exists, compare against sale price (or list price fallback)
// - if size doesn't match (with tolerance + rotation) -> drop
// Return remaining rugs

function matchesSize(rug: InventoryRug, constraints: HardConstraints): boolean {
  const bounds = getSizeBounds(constraints.size);
  if (!bounds) return true;

  if (
    typeof rug.width_total_in !== "number" ||
    typeof rug.length_total_in !== "number"
  ) {
    return false;
  }

  return matchesSizeWithBounds(rug.width_total_in, rug.length_total_in, bounds);
}

export function filterByHardConstraints(
  inventory: InventoryRug[],
  constraints: HardConstraints
): InventoryRug[] {
  return inventory.filter((rug) => {
    if (rug.status !== "available") return false;

    const effectivePrice =
      typeof rug.sale_price_usd === "number" ? rug.sale_price_usd : rug.price_usd;

    if (
      typeof constraints.budgetMax === "number" &&
      (typeof effectivePrice !== "number" || effectivePrice > constraints.budgetMax)
    ) {
      return false;
    }

    if (!matchesSize(rug, constraints)) return false;

    return true;
  });
}
