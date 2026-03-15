export const INVENTORY_QUERY_PARAMS = {
  page: "page",
  pageSize: "page_size",
  query: "q",
  status: "status",
  sort: "sort",
  sizePresets: "size_presets",
  legacySizePreset: "size_preset",
  widthMin: "width_min",
  widthMax: "width_max",
  lengthMin: "length_min",
  lengthMax: "length_max",
} as const;

export function readQueryStringParam(
  value: string | string[] | undefined,
  fallback = ""
): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value[0] ?? fallback;
  return fallback;
}

