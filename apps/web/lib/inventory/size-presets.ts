import type { InventorySizePreset } from "@/lib/types/inventory";

export type ExactSizePresetSpec = {
  widthIn: number;
  lengthIn: number;
  toleranceIn: number;
};

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
