import Link from "next/link";
import { CheckCircle, Package, Search } from "lucide-react";
import { WorkspaceNav } from "@/components/shell/workspace-nav";
import { AccessGuard } from "@/components/ui/access-guard";
import { AppShell } from "@/components/ui/app-shell";
import { PageHeader } from "@/components/ui/page-header";
import { SectionCard } from "@/components/ui/section-card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { InventoryTableClient } from "@/components/inventory/inventory-table-client";
import { getInventoryStats, listInventory } from "@/lib/inventory/list";
import { isDefaultInventoryFilters } from "@/lib/inventory/filters";
import { getServerUiRole, getServerUiTenantId } from "@/lib/ui/server-role";
import { canRoleAccessRoute } from "@/lib/auth/policy";
import type {
  InventorySort,
  InventoryStatusFilter,
} from "@/lib/types/inventory";

type InventoryPageProps = {
  searchParams?:
    | Promise<Record<string, string | string[] | undefined>>
    | Record<string, string | string[] | undefined>;
};

type StatusOption = {
  value: InventoryStatusFilter;
  label: string;
};

type SortOption = {
  value: InventorySort;
  label: string;
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

function readString(
  value: string | string[] | undefined,
  fallback = ""
): string {
  if (typeof value === "string") return value;
  return fallback;
}

function toPositiveInt(value: string, fallback: number): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return parsed;
}

function toNumberOrNull(value: string): number | null {
  if (!value.trim()) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return parsed;
}

function buildQueryString(input: Record<string, string | number | null | undefined>) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(input)) {
    if (value === null || value === undefined) continue;
    const next = String(value).trim();
    if (!next) continue;
    params.set(key, next);
  }
  return params.toString();
}

function getVisiblePageNumbers(
  currentPage: number,
  totalPages: number,
  maxVisible: number
): number[] {
  if (totalPages <= 0) return [];
  if (totalPages <= maxVisible) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }

  const half = Math.floor(maxVisible / 2);
  let start = Math.max(1, currentPage - half);
  let end = Math.min(totalPages, start + maxVisible - 1);

  start = Math.max(1, end - maxVisible + 1);
  end = Math.min(totalPages, start + maxVisible - 1);

  return Array.from({ length: end - start + 1 }, (_, index) => start + index);
}

export default async function InventoryPage({ searchParams }: InventoryPageProps) {
  const role = await getServerUiRole();
  if (!role || !canRoleAccessRoute(role, "/inventory")) {
    return (
      <AccessGuard
        title="Inventory Browser"
        description="This page is available only to store staff."
        ctaLabel="Go to concierge"
      />
    );
  }

  const tenantId = await getServerUiTenantId();
  if (!tenantId) {
    return (
      <AccessGuard
        title="Store Tenant Required"
        description="Select your store tenant before browsing inventory."
      />
    );
  }

  const params = (await searchParams) ?? {};
  const page = toPositiveInt(readString(params.page), 1);
  const pageSize = toPositiveInt(readString(params.page_size), 50);

  const filtersInput = {
    q: readString(params.q),
    status: readString(params.status),
    widthMin: toNumberOrNull(readString(params.width_min)),
    widthMax: toNumberOrNull(readString(params.width_max)),
    lengthMin: toNumberOrNull(readString(params.length_min)),
    lengthMax: toNumberOrNull(readString(params.length_max)),
    sort: readString(params.sort),
  };

  const [result, inventoryStats] = await Promise.all([
    listInventory({
      tenantId,
      page,
      pageSize,
      filters: filtersInput,
    }),
    getInventoryStats(tenantId),
  ]);

  const prevPage = result.page > 1 ? result.page - 1 : null;
  const nextPage =
    result.totalPages > 0 && result.page < result.totalPages
      ? result.page + 1
      : null;

  const queryBase = {
    page_size: result.pageSize,
    q: result.filters.q || null,
    status: result.filters.status !== "available" ? result.filters.status : null,
    width_min: result.filters.widthMin,
    width_max: result.filters.widthMax,
    length_min: result.filters.lengthMin,
    length_max: result.filters.lengthMax,
    sort: result.filters.sort !== "newest" ? result.filters.sort : null,
  };

  const pageLink = (next: number) =>
    `/inventory?${buildQueryString({
      ...queryBase,
      page: next,
    })}`;

  const statusLink = (status: InventoryStatusFilter) =>
    `/inventory?${buildQueryString({
      ...queryBase,
      page: 1,
      status: status === "available" ? null : status,
    })}`;

  const sortLink = (sort: InventorySort) =>
    `/inventory?${buildQueryString({
      ...queryBase,
      page: 1,
      sort: sort === "newest" ? null : sort,
    })}`;

  const refreshLink = pageLink(1);
  const clearFiltersLink = `/inventory?${buildQueryString({
    page: 1,
    page_size: result.pageSize,
  })}`;

  const activeFilterItems = [
    result.filters.q ? `Query: ${result.filters.q}` : null,
    result.filters.status !== "available"
      ? `Status: ${result.filters.status}`
      : null,
    result.filters.widthMin !== null ? `Min Width: ${result.filters.widthMin}\"` : null,
    result.filters.widthMax !== null ? `Max Width: ${result.filters.widthMax}\"` : null,
    result.filters.lengthMin !== null
      ? `Min Length: ${result.filters.lengthMin}\"`
      : null,
    result.filters.lengthMax !== null
      ? `Max Length: ${result.filters.lengthMax}\"`
      : null,
    result.filters.sort !== "newest" ? `Sort: ${result.filters.sort}` : null,
  ].filter((item): item is string => Boolean(item));

  const visiblePageNumbers = getVisiblePageNumbers(result.page, result.totalPages, 7);

  return (
    <>
      <WorkspaceNav
        role={role}
        currentPath="/inventory"
        variant="workspace-soft"
        showHomeLink={role === "developer"}
      />
      <AppShell variant="catalog">
        <PageHeader
          kicker="Catalog"
          title="Inventory Browser"
          subtitle="Browse current available rugs and their AI-generated descriptions."
          variant="catalog"
          actions={
            <Button asChild variant="outline">
              <Link href={refreshLink}>Refresh</Link>
            </Button>
          }
        />

        <div className="mt-5 space-y-5">
          <div className="grid grid-cols-2 gap-4">
            <div className="flex items-center gap-4 rounded-xl border border-primary/20 bg-primary/10 p-5">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
                <Package className="size-5" />
              </div>
              <div>
                <p className="text-xs font-bold uppercase tracking-widest text-primary">Total Stock</p>
                <p className="text-2xl font-serif font-bold text-foreground">{inventoryStats.total}</p>
              </div>
            </div>

            <div className="flex items-center gap-4 rounded-xl border border-emerald-500/20 bg-emerald-50 p-5">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white">
                <CheckCircle className="size-5" />
              </div>
              <div>
                <p className="text-xs font-bold uppercase tracking-widest text-emerald-700">Available</p>
                <p className="text-2xl font-serif font-bold text-foreground">{inventoryStats.available}</p>
              </div>
            </div>
          </div>

          <SectionCard title="Search and Filters" tone="soft" className="border-border/55">
            <div className="space-y-4 rounded-xl border border-border/60 bg-white p-4 shadow-sm">
              <div className="space-y-2">
                <p className="text-sm font-medium text-foreground">Status</p>
                <div className="flex flex-wrap gap-2">
                  {STATUS_OPTIONS.map((option) => {
                    const active = result.filters.status === option.value;
                    return (
                      <Link
                        key={option.value}
                        href={statusLink(option.value)}
                        className={
                          active
                            ? "inline-flex h-10 items-center rounded-full border border-primary/40 bg-primary/10 px-4 text-sm font-semibold text-foreground ring-1 ring-primary/25"
                            : "inline-flex h-10 items-center rounded-full border border-border/50 bg-background px-4 text-sm font-medium text-foreground/80 hover:border-primary/30 hover:bg-primary/10 hover:text-foreground"
                        }
                      >
                        {option.label}
                      </Link>
                    );
                  })}
                </div>
              </div>

              <div className="space-y-2">
                <p className="text-sm font-medium text-foreground">Sort</p>
                <div className="flex flex-wrap gap-2">
                  {SORT_OPTIONS.map((option) => {
                    const active = result.filters.sort === option.value;
                    return (
                      <Link
                        key={option.value}
                        href={sortLink(option.value)}
                        className={
                          active
                            ? "inline-flex h-10 items-center rounded-full border border-primary/40 bg-primary/10 px-4 text-sm font-semibold text-foreground ring-1 ring-primary/25"
                            : "inline-flex h-10 items-center rounded-full border border-border/50 bg-background px-4 text-sm font-medium text-foreground/80 hover:border-primary/30 hover:bg-primary/10 hover:text-foreground"
                        }
                      >
                        {option.label}
                      </Link>
                    );
                  })}
                </div>
              </div>

              <form method="GET" action="/inventory" className="grid gap-3 md:grid-cols-3 xl:grid-cols-5">
                <input type="hidden" name="page" value="1" />
                <input type="hidden" name="page_size" value={result.pageSize} />
                <input type="hidden" name="status" value={result.filters.status} />
                <input type="hidden" name="sort" value={result.filters.sort} />

                <div className="space-y-2 xl:col-span-2">
                  <label className="text-sm font-medium" htmlFor="q">Search</label>
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      id="q"
                      name="q"
                      defaultValue={result.filters.q}
                      placeholder="Search by label or description"
                      className="h-11 pl-10 text-base"
                    />
                  </div>
                </div>

                <details className="rounded-xl border border-border/60 bg-background/55 p-3 md:col-span-3 xl:col-span-3">
                  <summary className="cursor-pointer text-sm font-semibold text-foreground">
                    Size filters (optional)
                  </summary>
                  <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                    <div className="space-y-2">
                      <label className="text-sm font-medium" htmlFor="width_min">Min Width (in)</label>
                      <Input
                        id="width_min"
                        name="width_min"
                        type="number"
                        min="0"
                        step="1"
                        defaultValue={result.filters.widthMin ?? ""}
                        className="h-11 text-base"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium" htmlFor="width_max">Max Width (in)</label>
                      <Input
                        id="width_max"
                        name="width_max"
                        type="number"
                        min="0"
                        step="1"
                        defaultValue={result.filters.widthMax ?? ""}
                        className="h-11 text-base"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium" htmlFor="length_min">Min Length (in)</label>
                      <Input
                        id="length_min"
                        name="length_min"
                        type="number"
                        min="0"
                        step="1"
                        defaultValue={result.filters.lengthMin ?? ""}
                        className="h-11 text-base"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium" htmlFor="length_max">Max Length (in)</label>
                      <Input
                        id="length_max"
                        name="length_max"
                        type="number"
                        min="0"
                        step="1"
                        defaultValue={result.filters.lengthMax ?? ""}
                        className="h-11 text-base"
                      />
                    </div>
                  </div>
                </details>

                <div className="flex flex-wrap items-end gap-2 md:col-span-3 xl:col-span-5">
                  <Button type="submit" className="h-11 px-5 text-base">Apply Filters</Button>
                  <Button asChild variant="ghost">
                    <Link href={clearFiltersLink}>Clear</Link>
                  </Button>
                </div>
              </form>
            </div>
          </SectionCard>

          {!isDefaultInventoryFilters(result.filters) ? (
            <SectionCard title="Active Filters" tone="transparent" density="compact">
              <div className="flex flex-wrap gap-2">
                {activeFilterItems.map((item) => (
                  <Badge key={item} variant="outline">
                    {item}
                  </Badge>
                ))}
              </div>
            </SectionCard>
          ) : null}

          {result.error ? (
            <SectionCard title="Could not load inventory" description={result.error} />
          ) : result.rows.length === 0 ? (
            <SectionCard
              title="No inventory rows found"
              description="No rugs matched current filters. Adjust search or broaden constraints."
            />
          ) : (
            <SectionCard title="Inventory" tone="soft" className="border-border/55">
              <InventoryTableClient rows={result.rows} />
            </SectionCard>
          )}

          {result.totalPages > 1 ? (
            <div className="flex flex-wrap items-center justify-center gap-2">
              {prevPage ? (
                <Link
                  href={pageLink(prevPage)}
                  className="inline-flex h-10 items-center rounded-full border border-border/50 px-4 text-sm font-medium text-foreground/80 hover:border-primary/30 hover:bg-primary/10 hover:text-foreground"
                >
                  {'<<'}
                </Link>
              ) : (
                <span className="inline-flex h-10 items-center rounded-full border border-border/30 px-4 text-sm text-muted-foreground">
                  {'<<'}
                </span>
              )}

              {visiblePageNumbers.map((pageNumber) => {
                const isCurrent = pageNumber === result.page;
                return (
                  <Link
                    key={pageNumber}
                    href={pageLink(pageNumber)}
                    className={
                      isCurrent
                        ? "inline-flex h-10 min-w-10 items-center justify-center rounded-full bg-primary px-3 text-sm font-bold text-primary-foreground"
                        : "inline-flex h-10 min-w-10 items-center justify-center rounded-full border border-border/50 px-3 text-sm font-medium text-foreground/80 hover:border-primary/30 hover:bg-primary/10 hover:text-foreground"
                    }
                  >
                    {pageNumber}
                  </Link>
                );
              })}

              {nextPage ? (
                <Link
                  href={pageLink(nextPage)}
                  className="inline-flex h-10 items-center rounded-full border border-border/50 px-4 text-sm font-medium text-foreground/80 hover:border-primary/30 hover:bg-primary/10 hover:text-foreground"
                >
                  {'>>'}
                </Link>
              ) : (
                <span className="inline-flex h-10 items-center rounded-full border border-border/30 px-4 text-sm text-muted-foreground">
                  {'>>'}
                </span>
              )}
            </div>
          ) : null}
        </div>
      </AppShell>
    </>
  );
}
