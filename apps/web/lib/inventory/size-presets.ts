import type { InventorySizePreset } from "@/lib/types/inventory";

export type ExactSizePresetSpec = {
  widthIn: number;
  lengthIn: number;
  toleranceIn: number;
};

type SimilaritySizePreset = Exclude<InventorySizePreset, "runner" | "round-oval">;

export type SizePresetMeta = {
  value: InventorySizePreset;
  label: string;
  featured: boolean;
};

export const SIZE_PRESET_OPTIONS: readonly SizePresetMeta[] = [
  { value: "accent", label: "Accent", featured: false },
  { value: "3x5", label: "3x5", featured: false },
  { value: "4x6", label: "4x6", featured: false },
  { value: "5x8", label: "5x8", featured: true },
  { value: "6x9", label: "6x9", featured: true },
  { value: "8x10", label: "8x10", featured: true },
  { value: "9x12", label: "9x12", featured: false },
  { value: "10x14", label: "10x14", featured: false },
  { value: "oversized", label: "Oversized", featured: false },
  { value: "runner", label: "Runner", featured: true },
  { value: "round-oval", label: "Round/Oval", featured: true },
] as const;

const EXACT_SIZE_PRESET_SPECS: Record<
  Exclude<InventorySizePreset, "accent" | "oversized" | "runner" | "round-oval">,
  ExactSizePresetSpec
> = {
  "3x5": { widthIn: 36, lengthIn: 60, toleranceIn: 6 },
  "4x6": { widthIn: 48, lengthIn: 72, toleranceIn: 6 },
  "5x8": { widthIn: 60, lengthIn: 96, toleranceIn: 12 },
  "6x9": { widthIn: 72, lengthIn: 108, toleranceIn: 12 },
  "8x10": { widthIn: 96, lengthIn: 120, toleranceIn: 12 },
  "9x12": { widthIn: 108, lengthIn: 144, toleranceIn: 12 },
  "10x14": { widthIn: 120, lengthIn: 168, toleranceIn: 12 },
};

const SIMILARITY_SIZE_PRESET_ORDER: readonly SimilaritySizePreset[] = [
  "accent",
  "3x5",
  "4x6",
  "5x8",
  "6x9",
  "8x10",
  "9x12",
  "10x14",
  "oversized",
] as const;

const SIMILARITY_SIZE_PRESET_ANCHORS: Record<
  SimilaritySizePreset,
  { widthIn: number; lengthIn: number }
> = {
  accent: { widthIn: 24, lengthIn: 36 },
  "3x5": { widthIn: 36, lengthIn: 60 },
  "4x6": { widthIn: 48, lengthIn: 72 },
  "5x8": { widthIn: 60, lengthIn: 96 },
  "6x9": { widthIn: 72, lengthIn: 108 },
  "8x10": { widthIn: 96, lengthIn: 120 },
  "9x12": { widthIn: 108, lengthIn: 144 },
  "10x14": { widthIn: 120, lengthIn: 168 },
  oversized: { widthIn: 132, lengthIn: 180 },
};

const SIZE_PRESET_LABEL_BY_VALUE = new Map<string, string>(
  SIZE_PRESET_OPTIONS.map((option) => [option.value, option.label])
);

const SIZE_PRESET_VALUES = new Set<string>(
  SIZE_PRESET_OPTIONS.map((option) => option.value)
);

export function normalizeInventorySizePreset(
  value: unknown
): InventorySizePreset | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (!SIZE_PRESET_VALUES.has(normalized)) return null;
  return normalized as InventorySizePreset;
}

export function normalizeInventorySizePresetList(
  value: unknown
): InventorySizePreset[] {
  const list: string[] = Array.isArray(value)
    ? value
        .map((entry) => (typeof entry === "string" ? entry : ""))
        .flatMap((entry) => entry.split(","))
    : typeof value === "string"
      ? value.split(",")
      : [];

  const normalized = list
    .map((entry) => normalizeInventorySizePreset(entry))
    .filter((entry): entry is InventorySizePreset => entry !== null);

  return Array.from(new Set(normalized));
}

export function toSizePresetLabel(preset: InventorySizePreset): string {
  return SIZE_PRESET_LABEL_BY_VALUE.get(preset) ?? preset;
}

export function toExactSizePresetSpec(
  preset: InventorySizePreset | null
): ExactSizePresetSpec | null {
  if (!preset) return null;
  if (preset === "accent" || preset === "oversized") return null;
  if (preset === "runner" || preset === "round-oval") return null;
  return EXACT_SIZE_PRESET_SPECS[preset];
}

export function splitSizePresetGroups(): {
  featured: InventorySizePreset[];
  more: InventorySizePreset[];
} {
  const featured = SIZE_PRESET_OPTIONS.filter((option) => option.featured).map(
    (option) => option.value
  );
  const more = SIZE_PRESET_OPTIONS.filter((option) => !option.featured).map(
    (option) => option.value
  );
  return { featured, more };
}

function sizeDistance(input: {
  widthIn: number;
  lengthIn: number;
  anchorWidthIn: number;
  anchorLengthIn: number;
}): number {
  const direct =
    Math.abs(input.widthIn - input.anchorWidthIn) +
    Math.abs(input.lengthIn - input.anchorLengthIn);
  const rotated =
    Math.abs(input.widthIn - input.anchorLengthIn) +
    Math.abs(input.lengthIn - input.anchorWidthIn);
  return Math.min(direct, rotated);
}

export function toSimilaritySizePreset(input: {
  widthIn: number;
  lengthIn: number;
}): InventorySizePreset {
  const { widthIn, lengthIn } = input;
  let bestPreset: SimilaritySizePreset = "accent";
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const preset of SIMILARITY_SIZE_PRESET_ORDER) {
    const anchor = SIMILARITY_SIZE_PRESET_ANCHORS[preset];
    const distance = sizeDistance({
      widthIn,
      lengthIn,
      anchorWidthIn: anchor.widthIn,
      anchorLengthIn: anchor.lengthIn,
    });

    if (distance < bestDistance) {
      bestDistance = distance;
      bestPreset = preset;
    }
  }

  return bestPreset;
}

export function getAdjacentSizePresets(
  preset: InventorySizePreset,
  steps = 1
): InventorySizePreset[] {
  if (preset === "runner" || preset === "round-oval") {
    return [preset];
  }

  const index = SIMILARITY_SIZE_PRESET_ORDER.indexOf(preset);
  if (index < 0) return [preset];

  const out: InventorySizePreset[] = [];
  for (let offset = -steps; offset <= steps; offset += 1) {
    const nextIndex = index + offset;
    if (nextIndex < 0 || nextIndex >= SIMILARITY_SIZE_PRESET_ORDER.length) continue;
    out.push(SIMILARITY_SIZE_PRESET_ORDER[nextIndex]);
  }

  return Array.from(new Set(out));
}

export function getSizePresetDistance(
  left: InventorySizePreset,
  right: InventorySizePreset
): number | null {
  if (
    left === "runner" ||
    left === "round-oval" ||
    right === "runner" ||
    right === "round-oval"
  ) {
    return left === right ? 0 : null;
  }

  const leftIndex = SIMILARITY_SIZE_PRESET_ORDER.indexOf(left);
  const rightIndex = SIMILARITY_SIZE_PRESET_ORDER.indexOf(right);
  if (leftIndex < 0 || rightIndex < 0) return null;
  return Math.abs(leftIndex - rightIndex);
}
