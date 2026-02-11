import type { HardConstraints, InventoryRug } from "@/lib/types/recommendation";

// PSEUDOCODE
// For each rug:
// - if status not available -> drop
// - if price > budgetMax -> drop
// - if size doesn't match (with tolerance + rotation) -> drop
// Return remaining rugs

const DEFAULT_TOLERANCE_IN = 2;

function matchesSize(rug: InventoryRug, constraints: HardConstraints): boolean {
  if (!constraints.size) return true;

  const { widthIn, lengthIn, toleranceIn } = constraints.size;
  const tol = toleranceIn ?? DEFAULT_TOLERANCE_IN;

  if (!rug.width_total_in || !rug.length_total_in) return false;

  const w = rug.width_total_in;
  const l = rug.length_total_in;

  const directMatch =
    Math.abs(w - widthIn) <= tol && Math.abs(l - lengthIn) <= tol;
  const rotatedMatch =
    Math.abs(w - lengthIn) <= tol && Math.abs(l - widthIn) <= tol;

  return directMatch || rotatedMatch;
}

export function filterByHardConstraints(
  inventory: InventoryRug[],
  constraints: HardConstraints
): InventoryRug[] {
  return inventory.filter((rug) => {
    if (rug.status && rug.status !== "available") return false;

    if (
      typeof constraints.budgetMax === "number" &&
      typeof rug.price_usd === "number" &&
      rug.price_usd > constraints.budgetMax
    ) {
      return false;
    }

    if (!matchesSize(rug, constraints)) return false;

    return true;
  });
}
