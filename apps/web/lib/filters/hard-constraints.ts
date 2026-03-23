import type { HardConstraints, InventoryRug } from "@/lib/types/recommendation";
import {
  getSizeBounds,
  matchesSizeWithBounds,
  matchesSizeWithWindow,
  type SizeWindow,
} from "@/lib/filters/size-bounds";
import { resolveEffectiveFields } from "@/lib/inventory/resolve-fields";

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function toSearchText(rug: InventoryRug): string {
  const fields = rug.effective_fields
    ? rug.effective_fields
    : resolveEffectiveFields(
        rug.intake_label ?? null,
        rug.ai_structured_fields ?? null,
        rug.staff_overrides ?? null,
        rug.ai_description ?? null
      );

  const parts: string[] = [
    rug.intake_label ?? "",
    rug.ai_description ?? "",
    fields.label ?? "",
    fields.origin ?? "",
    fields.style ?? "",
    fields.mood ?? "",
    ...(fields.pattern ?? []),
    ...(fields.primary_colors ?? []),
  ];

  return normalizeText(parts.join(" "));
}

function toPrimaryColors(rug: InventoryRug): string[] {
  const fields = rug.effective_fields
    ? rug.effective_fields
    : resolveEffectiveFields(
        rug.intake_label ?? null,
        rug.ai_structured_fields ?? null,
        rug.staff_overrides ?? null,
        rug.ai_description ?? null
      );

  return (fields.primary_colors ?? [])
    .map((value) => normalizeText(value))
    .filter((value) => value.length > 0);
}

function toStyles(rug: InventoryRug): string[] {
  const fields = rug.effective_fields
    ? rug.effective_fields
    : resolveEffectiveFields(
        rug.intake_label ?? null,
        rug.ai_structured_fields ?? null,
        rug.staff_overrides ?? null,
        rug.ai_description ?? null
      );

  const styleTokens = [fields.style ?? "", ...(fields.pattern ?? [])];
  return styleTokens
    .map((value) => normalizeText(value))
    .filter((value) => value.length > 0);
}

function isRunnerByDimensions(
  widthTotalIn: number,
  lengthTotalIn: number
): boolean {
  const shortSide = Math.min(widthTotalIn, lengthTotalIn);
  const longSide = Math.max(widthTotalIn, lengthTotalIn);
  if (shortSide <= 0 || longSide <= 0) return false;
  return shortSide <= 42 && longSide >= 84 && longSide / shortSide >= 2.2;
}

function isOversizedByDimensions(
  widthTotalIn: number,
  lengthTotalIn: number
): boolean {
  const shortSide = Math.min(widthTotalIn, lengthTotalIn);
  const longSide = Math.max(widthTotalIn, lengthTotalIn);
  return shortSide >= 84 && longSide >= 133;
}

function hasRoundOvalKeyword(rug: InventoryRug): boolean {
  const text = toSearchText(rug);
  return /\b(round|circular|circle|oval)\b/.test(text);
}

function matchesShape(rug: InventoryRug, constraints: HardConstraints): boolean {
  if (!constraints.shape) return true;

  const width = rug.width_total_in;
  const length = rug.length_total_in;
  const hasDimensions = typeof width === "number" && typeof length === "number";

  if (constraints.shape === "round_oval") {
    return hasRoundOvalKeyword(rug);
  }

  if (!hasDimensions) return false;

  const isRunner = isRunnerByDimensions(width, length);
  const isOversized = isOversizedByDimensions(width, length);
  const isRoundOval = hasRoundOvalKeyword(rug);

  if (constraints.shape === "runner") return isRunner;
  if (constraints.shape === "oversized") return isOversized;
  if (constraints.shape === "area") {
    return !isRunner && !isRoundOval;
  }

  return true;
}

function matchesColors(rug: InventoryRug, constraints: HardConstraints): boolean {
  if (!constraints.colors || constraints.colors.length === 0) return true;
  const wanted = constraints.colors.map((value) => normalizeText(value));
  const colorTokens = new Set(toPrimaryColors(rug));
  const searchText = toSearchText(rug);

  return wanted.some(
    (token) => colorTokens.has(token) || searchText.includes(token)
  );
}

function matchesStyles(rug: InventoryRug, constraints: HardConstraints): boolean {
  if (!constraints.styles || constraints.styles.length === 0) return true;

  const wanted = constraints.styles.map((value) => normalizeText(value));
  const styleTokens = new Set(toStyles(rug));
  const searchText = toSearchText(rug);

  return wanted.some(
    (token) => styleTokens.has(token) || searchText.includes(token)
  );
}

function matchesSize(
  rug: InventoryRug,
  constraints: HardConstraints,
  sizeWindow?: SizeWindow | null
): boolean {
  if (sizeWindow) {
    if (
      typeof rug.width_total_in !== "number" ||
      typeof rug.length_total_in !== "number"
    ) {
      return false;
    }

    return matchesSizeWithWindow(
      rug.width_total_in,
      rug.length_total_in,
      sizeWindow
    );
  }

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
  constraints: HardConstraints,
  sizeWindow?: SizeWindow | null
): InventoryRug[] {
  return inventory.filter((rug) => {
    if (rug.status !== "available") return false;
    if (!matchesSize(rug, constraints, sizeWindow)) return false;
    if (!matchesColors(rug, constraints)) return false;
    if (!matchesStyles(rug, constraints)) return false;
    if (!matchesShape(rug, constraints)) return false;
    return true;
  });
}
