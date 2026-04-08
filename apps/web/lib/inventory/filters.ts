import type {
  InventoryFilters,
  InventorySort,
  InventoryStatusFilter,
} from "@/lib/types/inventory";
import {
  normalizeInventorySizePresetList,
} from "@/lib/inventory/size-presets";

export type InventoryFilterInput = {
  q?: string;
  status?: string;
  sizePreset?: string;
  sizePresets?: string | string[];
  widthMin?: number | null;
  widthMax?: number | null;
  lengthMin?: number | null;
  lengthMax?: number | null;
  sort?: string;
};

const DEFAULT_FILTERS: InventoryFilters = {
  q: "",
  status: "available",
  sizePresets: [],
  widthMin: null,
  widthMax: null,
  lengthMin: null,
  lengthMax: null,
  sort: "newest",
};

const ALLOWED_STATUS: InventoryStatusFilter[] = [
  "all",
  "available",
  "not_available",
];

const ALLOWED_SORT: InventorySort[] = [
  "newest",
  "oldest",
];

function isInventoryStatusFilter(value: string): value is InventoryStatusFilter {
  return ALLOWED_STATUS.some((item) => item === value);
}

function isInventorySort(value: string): value is InventorySort {
  return ALLOWED_SORT.some((item) => item === value);
}

export function normalizeInventoryFilters(
  input: InventoryFilterInput = {}
): InventoryFilters {
  const q = typeof input.q === "string" ? input.q.trim().slice(0, 120) : "";
  const status =
    typeof input.status === "string" && isInventoryStatusFilter(input.status)
      ? input.status
      : DEFAULT_FILTERS.status;
  const sort =
    typeof input.sort === "string" && isInventorySort(input.sort)
      ? input.sort
      : DEFAULT_FILTERS.sort;

  const fromModern = normalizeInventorySizePresetList(input.sizePresets);
  const fromLegacy = normalizeInventorySizePresetList(input.sizePreset);
  const sizePresets = Array.from(new Set([...fromModern, ...fromLegacy]));

  const widthMin = toPositiveNumberOrNull(input.widthMin);
  const widthMax = toPositiveNumberOrNull(input.widthMax);
  const lengthMin = toPositiveNumberOrNull(input.lengthMin);
  const lengthMax = toPositiveNumberOrNull(input.lengthMax);

  const hasManualSizeBounds =
    widthMin !== null ||
    widthMax !== null ||
    lengthMin !== null ||
    lengthMax !== null;

  return {
    q,
    status,
    sizePresets: hasManualSizeBounds ? [] : sizePresets,
    widthMin:
      widthMin !== null && widthMax !== null && widthMin > widthMax
        ? widthMax
        : widthMin,
    widthMax:
      widthMin !== null && widthMax !== null && widthMin > widthMax
        ? widthMin
        : widthMax,
    lengthMin:
      lengthMin !== null && lengthMax !== null && lengthMin > lengthMax
        ? lengthMax
        : lengthMin,
    lengthMax:
      lengthMin !== null && lengthMax !== null && lengthMin > lengthMax
        ? lengthMin
        : lengthMax,
    sort,
  };
}

export function isDefaultInventoryFilters(filters: InventoryFilters): boolean {
  return (
    filters.q === DEFAULT_FILTERS.q &&
    filters.status === DEFAULT_FILTERS.status &&
    filters.sizePresets.length === 0 &&
    filters.widthMin === DEFAULT_FILTERS.widthMin &&
    filters.widthMax === DEFAULT_FILTERS.widthMax &&
    filters.lengthMin === DEFAULT_FILTERS.lengthMin &&
    filters.lengthMax === DEFAULT_FILTERS.lengthMax &&
    filters.sort === DEFAULT_FILTERS.sort
  );
}

function toPositiveNumberOrNull(value: unknown): number | null {
  if (typeof value !== "number") return null;
  if (!Number.isFinite(value) || value < 0) return null;
  return value;
}
