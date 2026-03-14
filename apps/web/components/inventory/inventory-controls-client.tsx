"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search, SlidersHorizontal, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  SIZE_PRESET_OPTIONS,
  toSizePresetLabel,
} from "@/lib/inventory/size-presets";
import type {
  InventoryFilters,
  InventorySizePreset,
  InventorySort,
  InventoryStatusFilter,
} from "@/lib/types/inventory";

type InventoryControlsClientProps = {
  filters: InventoryFilters;
  pageSize: number;
};

type FilterPatch = {
  q?: string | null;
  status?: InventoryStatusFilter;
  sort?: InventorySort;
  sizePreset?: InventorySizePreset | null;
  widthMin?: number | null;
  widthMax?: number | null;
  lengthMin?: number | null;
  lengthMax?: number | null;
};

type StatusOption = {
  value: InventoryStatusFilter;
  label: string;
};

type SortOption = {
  value: InventorySort;
  label: string;
};

type ActiveFilterItem = {
  key: string;
  label: string;
  onRemove: () => void;
};

const STATUS_OPTIONS: StatusOption[] = [
  { value: "available", label: "Available" },
  { value: "all", label: "All" },
  { value: "sold", label: "Sold" },
  { value: "on_hold", label: "On Hold" },
];

const SORT_OPTIONS: SortOption[] = [
  { value: "newest", label: "Newest" },
  { value: "oldest", label: "Oldest" },
];

function numberInputToValue(value: string): number | null {
  const normalized = value.trim();
  if (!normalized) return null;
  const parsed = Number.parseInt(normalized, 10);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return parsed;
}

function toInputValue(value: number | null): string {
  return value === null ? "" : String(value);
}

function chipClass(active: boolean): string {
  return active
    ? "inline-flex h-8 items-center rounded-full border border-primary/45 bg-primary/10 px-3 text-xs font-semibold text-foreground ring-1 ring-primary/25"
    : "inline-flex h-8 items-center rounded-full border border-border/55 bg-background px-3 text-xs font-medium text-foreground/80 hover:border-primary/30 hover:bg-primary/10 hover:text-foreground";
}

export function InventoryControlsClient({
  filters,
  pageSize,
}: InventoryControlsClientProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [queryInput, setQueryInput] = useState(filters.q);
  const [widthMinInput, setWidthMinInput] = useState(toInputValue(filters.widthMin));
  const [widthMaxInput, setWidthMaxInput] = useState(toInputValue(filters.widthMax));
  const [lengthMinInput, setLengthMinInput] = useState(toInputValue(filters.lengthMin));
  const [lengthMaxInput, setLengthMaxInput] = useState(toInputValue(filters.lengthMax));

  const applyPatch = useCallback(
    (patch: FilterPatch) => {
      const nextParams = new URLSearchParams(searchParams.toString());

      const setMaybe = (key: string, value: string | null) => {
        if (!value) {
          nextParams.delete(key);
          return;
        }
        nextParams.set(key, value);
      };

      if (Object.prototype.hasOwnProperty.call(patch, "q")) {
        const nextQ = (patch.q ?? "").trim();
        setMaybe("q", nextQ.length > 0 ? nextQ.slice(0, 120) : null);
      }
      if (Object.prototype.hasOwnProperty.call(patch, "status")) {
        setMaybe(
          "status",
          patch.status && patch.status !== "available" ? patch.status : null
        );
      }
      if (Object.prototype.hasOwnProperty.call(patch, "sort")) {
        setMaybe(
          "sort",
          patch.sort && patch.sort !== "newest" ? patch.sort : null
        );
      }
      if (Object.prototype.hasOwnProperty.call(patch, "sizePreset")) {
        setMaybe("size_preset", patch.sizePreset ?? null);
      }
      if (Object.prototype.hasOwnProperty.call(patch, "widthMin")) {
        setMaybe(
          "width_min",
          typeof patch.widthMin === "number" ? String(patch.widthMin) : null
        );
      }
      if (Object.prototype.hasOwnProperty.call(patch, "widthMax")) {
        setMaybe(
          "width_max",
          typeof patch.widthMax === "number" ? String(patch.widthMax) : null
        );
      }
      if (Object.prototype.hasOwnProperty.call(patch, "lengthMin")) {
        setMaybe(
          "length_min",
          typeof patch.lengthMin === "number" ? String(patch.lengthMin) : null
        );
      }
      if (Object.prototype.hasOwnProperty.call(patch, "lengthMax")) {
        setMaybe(
          "length_max",
          typeof patch.lengthMax === "number" ? String(patch.lengthMax) : null
        );
      }

      nextParams.set("page", "1");
      nextParams.set("page_size", String(pageSize));

      const nextQuery = nextParams.toString();
      const nextUrl = nextQuery ? `${pathname}?${nextQuery}` : pathname;
      router.replace(nextUrl, { scroll: false });
    },
    [pathname, pageSize, router, searchParams]
  );

  useEffect(() => {
    const normalized = queryInput.trim();
    if (normalized === filters.q) return;
    const timer = window.setTimeout(() => {
      applyPatch({ q: normalized || null });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [applyPatch, filters.q, queryInput]);

  useEffect(() => {
    const widthMin = numberInputToValue(widthMinInput);
    const widthMax = numberInputToValue(widthMaxInput);
    const lengthMin = numberInputToValue(lengthMinInput);
    const lengthMax = numberInputToValue(lengthMaxInput);

    const noManualInput =
      widthMinInput.trim().length === 0 &&
      widthMaxInput.trim().length === 0 &&
      lengthMinInput.trim().length === 0 &&
      lengthMaxInput.trim().length === 0;
    const unchanged =
      widthMin === filters.widthMin &&
      widthMax === filters.widthMax &&
      lengthMin === filters.lengthMin &&
      lengthMax === filters.lengthMax &&
      (noManualInput || filters.sizePreset === null);

    if (unchanged) return;

    const timer = window.setTimeout(() => {
      applyPatch({
        widthMin,
        widthMax,
        lengthMin,
        lengthMax,
        sizePreset: noManualInput ? filters.sizePreset : null,
      });
    }, 300);

    return () => window.clearTimeout(timer);
  }, [
    applyPatch,
    filters.lengthMax,
    filters.lengthMin,
    filters.sizePreset,
    filters.widthMax,
    filters.widthMin,
    lengthMaxInput,
    lengthMinInput,
    widthMaxInput,
    widthMinInput,
  ]);

  const clearAll = useCallback(() => {
    setQueryInput("");
    setWidthMinInput("");
    setWidthMaxInput("");
    setLengthMinInput("");
    setLengthMaxInput("");
    applyPatch({
      q: null,
      status: "available",
      sort: "newest",
      sizePreset: null,
      widthMin: null,
      widthMax: null,
      lengthMin: null,
      lengthMax: null,
    });
  }, [applyPatch]);

  const onSizePresetToggle = (preset: InventorySizePreset) => {
    const nextPreset = filters.sizePreset === preset ? null : preset;
    setWidthMinInput("");
    setWidthMaxInput("");
    setLengthMinInput("");
    setLengthMaxInput("");
    applyPatch({
      sizePreset: nextPreset,
      widthMin: null,
      widthMax: null,
      lengthMin: null,
      lengthMax: null,
    });
  };

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

    if (filters.sizePreset) {
      items.push({
        key: "size_preset",
        label: toSizePresetLabel(filters.sizePreset),
        onRemove: () => applyPatch({ sizePreset: null }),
      });
    }

    if (filters.widthMin !== null || filters.widthMax !== null) {
      const label =
        filters.widthMin !== null && filters.widthMax !== null
          ? `Width ${filters.widthMin}-${filters.widthMax}in`
          : filters.widthMin !== null
            ? `Width >= ${filters.widthMin}in`
            : `Width <= ${filters.widthMax}in`;
      items.push({
        key: "width",
        label,
        onRemove: () => {
          setWidthMinInput("");
          setWidthMaxInput("");
          applyPatch({ widthMin: null, widthMax: null });
        },
      });
    }

    if (filters.lengthMin !== null || filters.lengthMax !== null) {
      const label =
        filters.lengthMin !== null && filters.lengthMax !== null
          ? `Length ${filters.lengthMin}-${filters.lengthMax}in`
          : filters.lengthMin !== null
            ? `Length >= ${filters.lengthMin}in`
            : `Length <= ${filters.lengthMax}in`;
      items.push({
        key: "length",
        label,
        onRemove: () => {
          setLengthMinInput("");
          setLengthMaxInput("");
          applyPatch({ lengthMin: null, lengthMax: null });
        },
      });
    }

    return items;
  }, [filters, applyPatch]);

  return (
    <section
      aria-labelledby="inventory-controls-heading"
      data-inventory-controls="true"
      className="space-y-2 rounded-xl border border-border/60 bg-white/90 p-2.5 shadow-sm"
    >
      <h2 id="inventory-controls-heading" className="sr-only">
        Inventory Controls
      </h2>

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
        <Button type="button" variant="ghost" size="sm" onClick={clearAll}>
          Clear all
        </Button>
      </div>

      <div className="space-y-1" data-filter-lane="status">
        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Status
        </p>
        <div className="-mx-1 overflow-x-auto px-1 pb-1">
          <div className="inline-flex min-w-full gap-1.5 whitespace-nowrap sm:min-w-0 sm:flex-wrap">
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
      </div>

      <div className="space-y-1" data-filter-lane="sort">
        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Sort
        </p>
        <div className="-mx-1 overflow-x-auto px-1 pb-1">
          <div className="inline-flex min-w-full gap-1.5 whitespace-nowrap sm:min-w-0 sm:flex-wrap">
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
      </div>

      <div className="space-y-1" data-filter-lane="size">
        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Sizes
        </p>
        <div className="-mx-1 overflow-x-auto px-1 pb-1">
          <div className="inline-flex min-w-full gap-1.5 whitespace-nowrap sm:min-w-0 sm:flex-wrap">
            {SIZE_PRESET_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                className={chipClass(filters.sizePreset === option.value)}
                onClick={() => onSizePresetToggle(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <details className="rounded-lg border border-border/45 bg-background/55 p-2">
        <summary className="flex cursor-pointer list-none items-center gap-1.5 text-xs font-medium text-foreground/80">
          <SlidersHorizontal className="size-3.5 text-muted-foreground" />
          Advanced size filters (inches)
        </summary>
        <div className="mt-2 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          <Input
            value={widthMinInput}
            onChange={(event) => setWidthMinInput(event.target.value)}
            inputMode="numeric"
            placeholder="Min width"
            className="h-9 text-sm"
          />
          <Input
            value={widthMaxInput}
            onChange={(event) => setWidthMaxInput(event.target.value)}
            inputMode="numeric"
            placeholder="Max width"
            className="h-9 text-sm"
          />
          <Input
            value={lengthMinInput}
            onChange={(event) => setLengthMinInput(event.target.value)}
            inputMode="numeric"
            placeholder="Min length"
            className="h-9 text-sm"
          />
          <Input
            value={lengthMaxInput}
            onChange={(event) => setLengthMaxInput(event.target.value)}
            inputMode="numeric"
            placeholder="Max length"
            className="h-9 text-sm"
          />
        </div>
      </details>

      {activeFilters.length > 0 ? (
        <div
          className="flex flex-wrap gap-1.5"
          aria-label="Active filters"
          data-active-filters="true"
        >
          {activeFilters.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={item.onRemove}
              className="inline-flex h-7 items-center gap-1 rounded-full border border-border/55 bg-background px-2.5 text-xs text-foreground/80 hover:border-primary/35 hover:bg-primary/10 hover:text-foreground"
              aria-label={`Remove filter ${item.label}`}
            >
              <span>{item.label}</span>
              <X className="size-3" />
            </button>
          ))}
        </div>
      ) : null}
    </section>
  );
}
