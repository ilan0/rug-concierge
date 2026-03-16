"use client";

import type { Dispatch, ReactNode, SetStateAction } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import {
  ChevronDown,
  ChevronUp,
  Filter,
  Search,
  X,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  splitSizePresetGroups,
  toSizePresetLabel,
} from "@/lib/inventory/size-presets";
import { INVENTORY_QUERY_PARAMS } from "@/lib/inventory/query-params";
import type {
  InventoryFilters,
  InventorySizePreset,
  InventorySort,
  InventoryStatusFilter,
} from "@/lib/types/inventory";

type InventoryControlsClientProps = {
  filters: InventoryFilters;
  pageSize: number;
  children: ReactNode;
};

type FilterPatch = {
  q?: string | null;
  status?: InventoryStatusFilter;
  sort?: InventorySort;
  sizePresets?: InventorySizePreset[];
  widthMin?: number | null;
  widthMax?: number | null;
  lengthMin?: number | null;
  lengthMax?: number | null;
};

type ActiveFilterItem = {
  key: string;
  label: string;
  onRemove: () => void;
};

type SizeInputParts = {
  ft: string;
  inches: string;
};

const STATUS_OPTIONS: Array<{ value: InventoryStatusFilter; label: string }> = [
  { value: "available", label: "Available" },
  { value: "all", label: "All" },
  { value: "sold", label: "Sold" },
  { value: "on_hold", label: "On Hold" },
];

const SORT_OPTIONS: Array<{ value: InventorySort; label: string }> = [
  { value: "newest", label: "Newest" },
  { value: "oldest", label: "Oldest" },
];

function chipClass(active: boolean): string {
  return active
    ? "inline-flex min-h-7 items-center rounded-full border border-primary/55 bg-primary/12 px-2.5 text-[11px] font-semibold text-foreground ring-1 ring-primary/30"
    : "inline-flex min-h-7 items-center rounded-full border border-border/55 bg-background px-2.5 text-[11px] font-medium text-foreground/80 hover:border-primary/30 hover:bg-primary/10 hover:text-foreground";
}

function toSizeParts(value: number | null): SizeInputParts {
  if (value === null || !Number.isFinite(value) || value < 0) {
    return { ft: "", inches: "" };
  }
  const total = Math.floor(value);
  return {
    ft: String(Math.floor(total / 12)),
    inches: String(total % 12),
  };
}

function hasInput(parts: SizeInputParts): boolean {
  return parts.ft.trim().length > 0 || parts.inches.trim().length > 0;
}

function parseNonNegativeInt(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return parsed;
}

function toInches(parts: SizeInputParts): number | null {
  if (!hasInput(parts)) return null;
  const ft = parseNonNegativeInt(parts.ft);
  const inches = parseNonNegativeInt(parts.inches);
  if (ft === null && inches === null) return null;
  const baseFt = ft ?? 0;
  const baseInches = inches ?? 0;
  return baseFt * 12 + baseInches;
}

function formatInches(value: number): string {
  const total = Math.max(0, Math.floor(value));
  const ft = Math.floor(total / 12);
  const inches = total % 12;
  if (ft > 0 && inches > 0) return `${ft}' ${inches}"`;
  if (ft > 0) return `${ft}'`;
  return `${inches}"`;
}

function formatRangeLabel(
  axis: "Width" | "Length",
  min: number | null,
  max: number | null
): string | null {
  if (min === null && max === null) return null;
  if (min !== null && max !== null) {
    return `${axis} ${formatInches(min)} - ${formatInches(max)}`;
  }
  if (min !== null) return `${axis} >= ${formatInches(min)}`;
  return `${axis} <= ${formatInches(max ?? 0)}`;
}

export function InventoryControlsClient({
  filters,
  pageSize,
  children,
}: InventoryControlsClientProps) {
  const pathname = usePathname();
  const suppressAutoQueryPatchRef = useRef(false);
  const queryDebounceRef = useRef<number | null>(null);
  const sizeDebounceRef = useRef<number | null>(null);

  const [queryInput, setQueryInput] = useState(filters.q);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [showAllSizes, setShowAllSizes] = useState(false);
  const [widthMinInput, setWidthMinInput] = useState<SizeInputParts>(
    toSizeParts(filters.widthMin)
  );
  const [widthMaxInput, setWidthMaxInput] = useState<SizeInputParts>(
    toSizeParts(filters.widthMax)
  );
  const [lengthMinInput, setLengthMinInput] = useState<SizeInputParts>(
    toSizeParts(filters.lengthMin)
  );
  const [lengthMaxInput, setLengthMaxInput] = useState<SizeInputParts>(
    toSizeParts(filters.lengthMax)
  );

  const applyPatch = useCallback(
    (patch: FilterPatch) => {
      const currentSearch =
        typeof window === "undefined" ? "" : window.location.search;
      const nextParams = new URLSearchParams(currentSearch);

      const setMaybe = (key: string, value: string | null) => {
        if (!value) {
          nextParams.delete(key);
          return;
        }
        nextParams.set(key, value);
      };

      if (Object.prototype.hasOwnProperty.call(patch, "q")) {
        const nextQ = (patch.q ?? "").trim();
        setMaybe(
          INVENTORY_QUERY_PARAMS.query,
          nextQ.length > 0 ? nextQ.slice(0, 120) : null
        );
      }
      if (Object.prototype.hasOwnProperty.call(patch, "status")) {
        setMaybe(
          INVENTORY_QUERY_PARAMS.status,
          patch.status && patch.status !== "available" ? patch.status : null
        );
      }
      if (Object.prototype.hasOwnProperty.call(patch, "sort")) {
        setMaybe(
          INVENTORY_QUERY_PARAMS.sort,
          patch.sort && patch.sort !== "newest" ? patch.sort : null
        );
      }
      if (Object.prototype.hasOwnProperty.call(patch, "sizePresets")) {
        const joined = (patch.sizePresets ?? []).join(",");
        setMaybe(
          INVENTORY_QUERY_PARAMS.sizePresets,
          joined.length > 0 ? joined : null
        );
      }
      nextParams.delete(INVENTORY_QUERY_PARAMS.legacySizePreset);
      if (Object.prototype.hasOwnProperty.call(patch, "widthMin")) {
        setMaybe(
          INVENTORY_QUERY_PARAMS.widthMin,
          typeof patch.widthMin === "number" ? String(patch.widthMin) : null
        );
      }
      if (Object.prototype.hasOwnProperty.call(patch, "widthMax")) {
        setMaybe(
          INVENTORY_QUERY_PARAMS.widthMax,
          typeof patch.widthMax === "number" ? String(patch.widthMax) : null
        );
      }
      if (Object.prototype.hasOwnProperty.call(patch, "lengthMin")) {
        setMaybe(
          INVENTORY_QUERY_PARAMS.lengthMin,
          typeof patch.lengthMin === "number" ? String(patch.lengthMin) : null
        );
      }
      if (Object.prototype.hasOwnProperty.call(patch, "lengthMax")) {
        setMaybe(
          INVENTORY_QUERY_PARAMS.lengthMax,
          typeof patch.lengthMax === "number" ? String(patch.lengthMax) : null
        );
      }

      nextParams.set(INVENTORY_QUERY_PARAMS.page, "1");
      nextParams.set(INVENTORY_QUERY_PARAMS.pageSize, String(pageSize));

      const nextQuery = nextParams.toString();
      const nextUrl = nextQuery ? `${pathname}?${nextQuery}` : pathname;

      if (typeof window !== "undefined") {
        const currentUrl = `${window.location.pathname}${window.location.search}`;
        if (currentUrl !== nextUrl) {
          window.location.replace(nextUrl);
        }
      }
    },
    [pathname, pageSize]
  );

  useEffect(() => {
    const normalized = queryInput.trim();
    if (suppressAutoQueryPatchRef.current) return;
    if (normalized === filters.q) return;
    if (queryDebounceRef.current !== null) {
      window.clearTimeout(queryDebounceRef.current);
      queryDebounceRef.current = null;
    }
    queryDebounceRef.current = window.setTimeout(() => {
      applyPatch({ q: normalized || null });
      queryDebounceRef.current = null;
    }, 300);
    return () => {
      if (queryDebounceRef.current !== null) {
        window.clearTimeout(queryDebounceRef.current);
        queryDebounceRef.current = null;
      }
    };
  }, [applyPatch, filters.q, queryInput]);

  useEffect(() => {
    const widthMin = toInches(widthMinInput);
    const widthMax = toInches(widthMaxInput);
    const lengthMin = toInches(lengthMinInput);
    const lengthMax = toInches(lengthMaxInput);

    const hasCustomInput =
      hasInput(widthMinInput) ||
      hasInput(widthMaxInput) ||
      hasInput(lengthMinInput) ||
      hasInput(lengthMaxInput);
    const unchanged =
      widthMin === filters.widthMin &&
      widthMax === filters.widthMax &&
      lengthMin === filters.lengthMin &&
      lengthMax === filters.lengthMax &&
      (!hasCustomInput || filters.sizePresets.length === 0);

    if (unchanged) return;

    if (sizeDebounceRef.current !== null) {
      window.clearTimeout(sizeDebounceRef.current);
      sizeDebounceRef.current = null;
    }
    sizeDebounceRef.current = window.setTimeout(() => {
      applyPatch({
        widthMin,
        widthMax,
        lengthMin,
        lengthMax,
        sizePresets: hasCustomInput ? [] : filters.sizePresets,
      });
      sizeDebounceRef.current = null;
    }, 300);

    return () => {
      if (sizeDebounceRef.current !== null) {
        window.clearTimeout(sizeDebounceRef.current);
        sizeDebounceRef.current = null;
      }
    };
  }, [
    applyPatch,
    filters.lengthMax,
    filters.lengthMin,
    filters.sizePresets,
    filters.widthMax,
    filters.widthMin,
    lengthMaxInput,
    lengthMinInput,
    widthMaxInput,
    widthMinInput,
  ]);

  const clearAll = useCallback(() => {
    suppressAutoQueryPatchRef.current = true;
    if (queryDebounceRef.current !== null) {
      window.clearTimeout(queryDebounceRef.current);
      queryDebounceRef.current = null;
    }
    if (sizeDebounceRef.current !== null) {
      window.clearTimeout(sizeDebounceRef.current);
      sizeDebounceRef.current = null;
    }
    setQueryInput("");
    setWidthMinInput({ ft: "", inches: "" });
    setWidthMaxInput({ ft: "", inches: "" });
    setLengthMinInput({ ft: "", inches: "" });
    setLengthMaxInput({ ft: "", inches: "" });
    setShowAllSizes(false);
    if (typeof window !== "undefined") {
      const resetParams = new URLSearchParams();
      resetParams.set(INVENTORY_QUERY_PARAMS.page, "1");
      resetParams.set(INVENTORY_QUERY_PARAMS.pageSize, String(pageSize));
      window.location.replace(`${pathname}?${resetParams.toString()}`);
    }
  }, [pageSize, pathname]);

  const onSizePresetToggle = useCallback(
    (preset: InventorySizePreset) => {
      const exists = filters.sizePresets.includes(preset);
      const next = exists
        ? filters.sizePresets.filter((value) => value !== preset)
        : [...filters.sizePresets, preset];

      setWidthMinInput({ ft: "", inches: "" });
      setWidthMaxInput({ ft: "", inches: "" });
      setLengthMinInput({ ft: "", inches: "" });
      setLengthMaxInput({ ft: "", inches: "" });
      applyPatch({
        sizePresets: next,
        widthMin: null,
        widthMax: null,
        lengthMin: null,
        lengthMax: null,
      });
    },
    [applyPatch, filters.sizePresets]
  );

  const activeFilters = useMemo(() => {
    const items: ActiveFilterItem[] = [];

    if (filters.q) {
      items.push({
        key: "q",
        label: filters.q,
        onRemove: () => {
          setQueryInput("");
          applyPatch({ q: null });
        },
      });
    }

    if (filters.status !== "available") {
      items.push({
        key: "status",
        label:
          filters.status === "on_hold"
            ? "On Hold"
            : filters.status.charAt(0).toUpperCase() + filters.status.slice(1),
        onRemove: () => applyPatch({ status: "available" }),
      });
    }

    if (filters.sort === "oldest") {
      items.push({
        key: "sort",
        label: "Oldest",
        onRemove: () => applyPatch({ sort: "newest" }),
      });
    }

    for (const preset of filters.sizePresets) {
      items.push({
        key: `size_preset_${preset}`,
        label: toSizePresetLabel(preset),
        onRemove: () =>
          applyPatch({
            sizePresets: filters.sizePresets.filter((value) => value !== preset),
          }),
      });
    }

    const widthLabel = formatRangeLabel("Width", filters.widthMin, filters.widthMax);
    if (widthLabel) {
      items.push({
        key: "width",
        label: widthLabel,
        onRemove: () => {
          setWidthMinInput({ ft: "", inches: "" });
          setWidthMaxInput({ ft: "", inches: "" });
          applyPatch({ widthMin: null, widthMax: null });
        },
      });
    }

    const lengthLabel = formatRangeLabel(
      "Length",
      filters.lengthMin,
      filters.lengthMax
    );
    if (lengthLabel) {
      items.push({
        key: "length",
        label: lengthLabel,
        onRemove: () => {
          setLengthMinInput({ ft: "", inches: "" });
          setLengthMaxInput({ ft: "", inches: "" });
          applyPatch({ lengthMin: null, lengthMax: null });
        },
      });
    }

    return items;
  }, [applyPatch, filters]);

  const sizePresetGroups = useMemo(() => splitSizePresetGroups(), []);
  const visiblePresets = showAllSizes
    ? [...sizePresetGroups.featured, ...sizePresetGroups.more]
    : sizePresetGroups.featured;

  const hasCustomInput =
    hasInput(widthMinInput) ||
    hasInput(widthMaxInput) ||
    hasInput(lengthMinInput) ||
    hasInput(lengthMaxInput);

  const renderCustomBound = (
    label: string,
    value: SizeInputParts,
    setValue: Dispatch<SetStateAction<SizeInputParts>>
  ) => (
    <label className="space-y-1.5">
      <span className="text-xs font-medium text-foreground/80">{label}</span>
      <div className="grid grid-cols-2 gap-1.5">
        <Input
          value={value.ft}
          onChange={(event) =>
            setValue((prev) => ({ ...prev, ft: event.target.value }))
          }
          inputMode="numeric"
          placeholder="ft"
          className="h-8 text-sm"
        />
        <Input
          value={value.inches}
          onChange={(event) =>
            setValue((prev) => ({ ...prev, inches: event.target.value }))
          }
          inputMode="numeric"
          placeholder="in"
          className="h-8 text-sm"
        />
      </div>
    </label>
  );

  const renderFilterSections = (mobile: boolean) => (
    <div
      className={
        mobile
          ? "space-y-3"
          : "space-y-2.5 rounded-xl border border-border/60 bg-white/90 p-2.5 shadow-sm"
      }
      data-inventory-filters="true"
    >
      <div className="space-y-1.5" data-filter-lane="status">
        <p className="text-[9px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          Status
        </p>
        <div className="flex flex-wrap gap-1.5">
          {STATUS_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              className={chipClass(filters.status === option.value)}
              onClick={() => applyPatch({ status: option.value })}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-1.5" data-filter-lane="sort">
        <p className="text-[9px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          Sort
        </p>
        <div className="flex flex-wrap gap-1.5">
          {SORT_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              className={chipClass(filters.sort === option.value)}
              onClick={() => applyPatch({ sort: option.value })}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-1.5" data-filter-lane="size">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[9px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            Sizes
          </p>
          {sizePresetGroups.more.length > 0 ? (
            <button
              type="button"
              className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
              onClick={() => setShowAllSizes((prev) => !prev)}
            >
              {showAllSizes ? "Less" : "More"}
              {showAllSizes ? (
                <ChevronUp className="size-3.5" />
              ) : (
                <ChevronDown className="size-3.5" />
              )}
            </button>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {visiblePresets.map((preset) => (
            <button
              key={preset}
              type="button"
              className={chipClass(filters.sizePresets.includes(preset))}
              onClick={() => onSizePresetToggle(preset)}
            >
              {toSizePresetLabel(preset)}
            </button>
          ))}
        </div>
      </div>

      <details
        className="rounded-lg border border-border/40 bg-background/70 p-2.5"
        open={hasCustomInput}
      >
        <summary className="cursor-pointer list-none text-[9px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          Custom Size (ft/in)
        </summary>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {renderCustomBound("Width Min", widthMinInput, setWidthMinInput)}
          {renderCustomBound("Width Max", widthMaxInput, setWidthMaxInput)}
          {renderCustomBound("Length Min", lengthMinInput, setLengthMinInput)}
          {renderCustomBound("Length Max", lengthMaxInput, setLengthMaxInput)}
        </div>
      </details>

      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="w-full justify-center"
        onClick={clearAll}
        disabled={
          activeFilters.length === 0 &&
          !hasCustomInput &&
          queryInput.trim().length === 0
        }
      >
        Clear all filters
      </Button>
    </div>
  );

  return (
    <div className="space-y-2">
      <section
        aria-label="Inventory search"
        data-inventory-controls="true"
        className="rounded-xl border border-border/60 bg-white/90 p-2.5 shadow-sm"
      >
        <div className="flex items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={queryInput}
              onChange={(event) => setQueryInput(event.target.value)}
              placeholder="Search labels, stock id, or description"
              className="h-9 pl-8 text-sm"
            />
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="lg:hidden"
            onClick={() => setSheetOpen(true)}
          >
            <Filter className="mr-1.5 size-3.5" />
            Filters
          </Button>
        </div>

        {activeFilters.length > 0 ? (
          <div
            className="mt-2 flex flex-wrap gap-1.5"
            aria-label="Active filters"
            data-active-filters="true"
          >
            {activeFilters.map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={item.onRemove}
                className="inline-flex min-h-7 items-center gap-1 rounded-full border border-border/55 bg-background px-2.5 text-xs text-foreground/80 hover:border-primary/35 hover:bg-primary/10 hover:text-foreground"
                aria-label={`Remove filter ${item.label}`}
              >
                <span>{item.label}</span>
                <X className="size-3" />
              </button>
            ))}
          </div>
        ) : null}
      </section>

      <div className="grid gap-3 lg:grid-cols-[18rem_minmax(0,1fr)]">
        <aside className="hidden lg:block">
          <div className="sticky top-24">{renderFilterSections(false)}</div>
        </aside>
        <div>{children}</div>
      </div>

      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent side="right" className="w-full p-4 sm:max-w-md">
          <SheetHeader>
            <SheetTitle>Inventory Filters</SheetTitle>
            <SheetDescription>
              Combine presets or use custom feet and inches ranges.
            </SheetDescription>
          </SheetHeader>
          <div className="mt-4">{renderFilterSections(true)}</div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
