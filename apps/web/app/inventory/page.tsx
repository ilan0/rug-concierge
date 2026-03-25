import Link from "next/link";
import { CheckCircle2, Package2, SlidersHorizontal } from "lucide-react";
import { AccessGuard } from "@/components/ui/access-guard";
import { AppShell } from "@/components/ui/app-shell";
import { PageHeader } from "@/components/ui/page-header";
import { SectionCard } from "@/components/ui/section-card";
import { InventoryControlsClient } from "@/components/inventory/inventory-controls-client";
import { InventoryTableClient } from "@/components/inventory/inventory-table-client";
import { isStaffUnlocked } from "@/lib/auth/staff";
import { getInventoryStats, listInventory } from "@/lib/inventory/list";
import {
  INVENTORY_QUERY_PARAMS,
  readQueryStringParam,
} from "@/lib/inventory/query-params";
import { getServerUiTenantId } from "@/lib/ui/server-role";
import { redirect } from "next/navigation";

type InventoryPageProps = {
  searchParams?:
    | Promise<Record<string, string | string[] | undefined>>
    | Record<string, string | string[] | undefined>;
};

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
  const tenantId = await getServerUiTenantId();
  const unlocked = tenantId ? await isStaffUnlocked(tenantId) : false;
  if (!tenantId) {
    return (
      <AccessGuard
        title="Store Tenant Required"
        description="Select your store tenant before browsing inventory."
      />
    );
  }

  if (!unlocked) {
    redirect("/concierge");
  }

  const params = (await searchParams) ?? {};
  const page = toPositiveInt(
    readQueryStringParam(params[INVENTORY_QUERY_PARAMS.page]),
    1
  );
  const pageSize = toPositiveInt(
    readQueryStringParam(params[INVENTORY_QUERY_PARAMS.pageSize]),
    50
  );

  const filtersInput = {
    q: readQueryStringParam(params[INVENTORY_QUERY_PARAMS.query]),
    status: readQueryStringParam(params[INVENTORY_QUERY_PARAMS.status]),
    sizePresets: readQueryStringParam(params[INVENTORY_QUERY_PARAMS.sizePresets]),
    sizePreset: readQueryStringParam(
      params[INVENTORY_QUERY_PARAMS.legacySizePreset]
    ),
    widthMin: toNumberOrNull(
      readQueryStringParam(params[INVENTORY_QUERY_PARAMS.widthMin])
    ),
    widthMax: toNumberOrNull(
      readQueryStringParam(params[INVENTORY_QUERY_PARAMS.widthMax])
    ),
    lengthMin: toNumberOrNull(
      readQueryStringParam(params[INVENTORY_QUERY_PARAMS.lengthMin])
    ),
    lengthMax: toNumberOrNull(
      readQueryStringParam(params[INVENTORY_QUERY_PARAMS.lengthMax])
    ),
    sort: readQueryStringParam(params[INVENTORY_QUERY_PARAMS.sort]),
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
    [INVENTORY_QUERY_PARAMS.pageSize]: result.pageSize,
    [INVENTORY_QUERY_PARAMS.query]: result.filters.q || null,
    [INVENTORY_QUERY_PARAMS.status]:
      result.filters.status !== "available" ? result.filters.status : null,
    [INVENTORY_QUERY_PARAMS.sizePresets]:
      result.filters.sizePresets.length > 0
        ? result.filters.sizePresets.join(",")
        : null,
    [INVENTORY_QUERY_PARAMS.widthMin]: result.filters.widthMin,
    [INVENTORY_QUERY_PARAMS.widthMax]: result.filters.widthMax,
    [INVENTORY_QUERY_PARAMS.lengthMin]: result.filters.lengthMin,
    [INVENTORY_QUERY_PARAMS.lengthMax]: result.filters.lengthMax,
    [INVENTORY_QUERY_PARAMS.sort]:
      result.filters.sort !== "newest" ? result.filters.sort : null,
  };

  const pageLink = (next: number) =>
    `/inventory?${buildQueryString({
      ...queryBase,
      [INVENTORY_QUERY_PARAMS.page]: next,
    })}`;

  const visiblePageNumbers = getVisiblePageNumbers(result.page, result.totalPages, 7);
  const controlsKey = buildQueryString({
    [INVENTORY_QUERY_PARAMS.query]: result.filters.q || null,
    [INVENTORY_QUERY_PARAMS.status]: result.filters.status,
    [INVENTORY_QUERY_PARAMS.sizePresets]:
      result.filters.sizePresets.length > 0
        ? result.filters.sizePresets.join(",")
        : null,
    [INVENTORY_QUERY_PARAMS.widthMin]: result.filters.widthMin,
    [INVENTORY_QUERY_PARAMS.widthMax]: result.filters.widthMax,
    [INVENTORY_QUERY_PARAMS.lengthMin]: result.filters.lengthMin,
    [INVENTORY_QUERY_PARAMS.lengthMax]: result.filters.lengthMax,
    [INVENTORY_QUERY_PARAMS.sort]: result.filters.sort,
  });

  return (
    <AppShell variant="catalog" className="pt-3">
      <PageHeader
        title="Inventory Browser"
        subtitle="Browse, filter, and update your current collection."
        variant="minimal"
        className="mb-2"
      />

      <div className="mb-2.5 flex flex-wrap items-center gap-2 text-xs">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-2.5 py-1 font-medium text-foreground">
          <Package2 className="size-3.5 text-primary" />
          Total {inventoryStats.total}
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/30 bg-emerald-50 px-2.5 py-1 font-medium text-foreground">
          <CheckCircle2 className="size-3.5 text-emerald-600" />
          Available {inventoryStats.available}
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-border/50 bg-card px-2.5 py-1 font-medium text-foreground/85">
          <SlidersHorizontal className="size-3.5 text-muted-foreground" />
          Showing {result.rows.length} of {result.total}
        </span>
      </div>

      <InventoryControlsClient
        key={controlsKey}
        filters={result.filters}
        pageSize={result.pageSize}
      >
        <section
          aria-labelledby="inventory-results-heading"
          className="mt-1"
          data-inventory-results="true"
        >
          <h2 id="inventory-results-heading" className="mb-1.5 text-sm font-semibold text-foreground">
            Inventory
          </h2>

          {result.error ? (
            <SectionCard tone="soft" density="compact" className="border-border/55">
              <p className="text-sm font-medium text-foreground">Could not load inventory</p>
              <p className="mt-1 text-sm text-muted-foreground">{result.error}</p>
            </SectionCard>
          ) : result.rows.length === 0 ? (
            <SectionCard tone="soft" density="compact" className="border-border/55">
              <p className="text-sm font-medium text-foreground">No inventory rows found</p>
              <p className="mt-1 text-sm text-muted-foreground">
                No rugs matched current filters. Try broadening size or search terms.
              </p>
            </SectionCard>
          ) : (
            <div className="rounded-2xl border border-border/60 bg-card/86 p-2 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-card/76">
              <InventoryTableClient rows={result.rows} />
            </div>
          )}
        </section>

        {result.totalPages > 1 ? (
          <nav aria-label="Inventory pagination" className="mt-4 flex flex-wrap items-center justify-center gap-2">
            {prevPage ? (
              <Link
                href={pageLink(prevPage)}
                className="inline-flex h-9 items-center rounded-full border border-border/50 px-3 text-sm font-medium text-foreground/80 hover:border-primary/30 hover:bg-primary/10 hover:text-foreground"
              >
                {'<<'}
              </Link>
            ) : (
              <span className="inline-flex h-9 items-center rounded-full border border-border/30 px-3 text-sm text-muted-foreground">
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
                      ? "inline-flex h-9 min-w-9 items-center justify-center rounded-full bg-primary px-3 text-sm font-bold text-primary-foreground"
                      : "inline-flex h-9 min-w-9 items-center justify-center rounded-full border border-border/50 px-3 text-sm font-medium text-foreground/80 hover:border-primary/30 hover:bg-primary/10 hover:text-foreground"
                  }
                >
                  {pageNumber}
                </Link>
              );
            })}

            {nextPage ? (
              <Link
                href={pageLink(nextPage)}
                className="inline-flex h-9 items-center rounded-full border border-border/50 px-3 text-sm font-medium text-foreground/80 hover:border-primary/30 hover:bg-primary/10 hover:text-foreground"
              >
                {'>>'}
              </Link>
            ) : (
              <span className="inline-flex h-9 items-center rounded-full border border-border/30 px-3 text-sm text-muted-foreground">
                {'>>'}
              </span>
            )}
          </nav>
        ) : null}
      </InventoryControlsClient>
    </AppShell>
  );
}
