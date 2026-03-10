import type {
  InventoryFilters,
  InventorySort,
  InventoryStatusFilter,
} from "@/lib/types/inventory";

export type InventoryFilterInput = {
  q?: string;
  status?: string;
  widthMin?: number | null;
  widthMax?: number | null;
  lengthMin?: number | null;
  lengthMax?: number | null;
  sort?: string;
};

const DEFAULT_FILTERS: InventoryFilters = {
  q: "",
  status: "available",
  widthMin: null,
  widthMax: null,
  lengthMin: null,
  lengthMax: null,
  sort: "newest",
};

const ALLOWED_STATUS: InventoryStatusFilter[] = [
  "all",
  "available",
  "sold",
  "on_hold",
];

const ALLOWED_SORT: InventorySort[] = [
  "newest",
  "oldest",
];

export function normalizeInventoryFilters(
  input: InventoryFilterInput = {}
): InventoryFilters {
  const q = typeof input.q === "string" ? input.q.trim().slice(0, 120) : "";
  const status = ALLOWED_STATUS.includes(
    input.status as InventoryStatusFilter
  )
    ? (input.status as InventoryStatusFilter)
    : DEFAULT_FILTERS.status;
  const sort = ALLOWED_SORT.includes(input.sort as InventorySort)
    ? (input.sort as InventorySort)
    : DEFAULT_FILTERS.sort;

  const widthMin = toPositiveNumberOrNull(input.widthMin);
  const widthMax = toPositiveNumberOrNull(input.widthMax);
  const lengthMin = toPositiveNumberOrNull(input.lengthMin);
  const lengthMax = toPositiveNumberOrNull(input.lengthMax);

  return {
    q,
    status,
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
