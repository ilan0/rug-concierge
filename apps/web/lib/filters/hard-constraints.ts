import type { HardConstraints, InventoryRug } from "@/lib/types/recommendation";
import { getSizeBounds, matchesSizeWithBounds } from "@/lib/filters/size-bounds";

// Hard filters: availability and size bounds.

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

    if (!matchesSize(rug, constraints)) return false;

    return true;
  });
}
