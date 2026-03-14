import type { InventorySizePreset } from "@/lib/types/inventory";

export type ExactSizePresetSpec = {
  widthIn: number;
  lengthIn: number;
  toleranceIn: number;
};

type SizePresetMeta = {
  value: InventorySizePreset;
  label: string;
};

export const SIZE_PRESET_OPTIONS: readonly SizePresetMeta[] = [
  { value: "3x5", label: "3x5" },
  { value: "4x6", label: "4x6" },
  { value: "5x8", label: "5x8" },
  { value: "6x9", label: "6x9" },
  { value: "8x10", label: "8x10" },
  { value: "9x12", label: "9x12" },
  { value: "10x14", label: "10x14" },
  { value: "runner", label: "Runner" },
  { value: "round-oval", label: "Round/Oval" },
] as const;

const EXACT_SIZE_PRESET_SPECS: Record<
  Exclude<InventorySizePreset, "runner" | "round-oval">,
  ExactSizePresetSpec
> = {
  "3x5": { widthIn: 36, lengthIn: 60, toleranceIn: 4 },
  "4x6": { widthIn: 48, lengthIn: 72, toleranceIn: 4 },
  "5x8": { widthIn: 60, lengthIn: 96, toleranceIn: 6 },
  "6x9": { widthIn: 72, lengthIn: 108, toleranceIn: 6 },
  "8x10": { widthIn: 96, lengthIn: 120, toleranceIn: 12 },
  "9x12": { widthIn: 108, lengthIn: 144, toleranceIn: 12 },
  "10x14": { widthIn: 120, lengthIn: 168, toleranceIn: 12 },
};

const SIZE_PRESET_LABEL_BY_VALUE = new Map<string, string>(
  SIZE_PRESET_OPTIONS.map((option) => [option.value, option.label])
);

export function normalizeInventorySizePreset(
  value: unknown
): InventorySizePreset | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (!SIZE_PRESET_LABEL_BY_VALUE.has(normalized)) return null;
  return normalized as InventorySizePreset;
}

export function toSizePresetLabel(preset: InventorySizePreset): string {
  return SIZE_PRESET_LABEL_BY_VALUE.get(preset) ?? preset;
}

export function toExactSizePresetSpec(
  preset: InventorySizePreset | null
): ExactSizePresetSpec | null {
  if (!preset || preset === "runner" || preset === "round-oval") return null;
  return EXACT_SIZE_PRESET_SPECS[preset];
}
