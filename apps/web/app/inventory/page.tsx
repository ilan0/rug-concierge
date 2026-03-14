import Link from "next/link";
import { CheckCircle2, Package2 } from "lucide-react";
import { AccessGuard } from "@/components/ui/access-guard";
import { AppShell } from "@/components/ui/app-shell";
import { PageHeader } from "@/components/ui/page-header";
import { SectionCard } from "@/components/ui/section-card";
import { Button } from "@/components/ui/button";
import { InventoryControlsClient } from "@/components/inventory/inventory-controls-client";
import { InventoryTableClient } from "@/components/inventory/inventory-table-client";
import { getInventoryStats, listInventory } from "@/lib/inventory/list";
import { getServerUiTenantId } from "@/lib/ui/server-role";

type InventoryPageProps = {
  searchParams?:
    | Promise<Record<string, string | string[] | undefined>>
    | Record<string, string | string[] | undefined>;
};

function readString(
  value: string | string[] | undefined,
  fallback = ""
): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value[0] ?? fallback;
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
    sizePresets: readString(params.size_presets),
    sizePreset: readString(params.size_preset),
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
    size_presets:
      result.filters.sizePresets.length > 0
        ? result.filters.sizePresets.join(",")
        : null,
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

  const refreshLink = pageLink(result.page);
  const visiblePageNumbers = getVisiblePageNumbers(result.page, result.totalPages, 7);
  const controlsKey = buildQueryString({
    q: result.filters.q || null,
    status: result.filters.status,
    size_presets:
      result.filters.sizePresets.length > 0
        ? result.filters.sizePresets.join(",")
        : null,
    width_min: result.filters.widthMin,
    width_max: result.filters.widthMax,
    length_min: result.filters.lengthMin,
    length_max: result.filters.lengthMax,
    sort: result.filters.sort,
  });

  return (
    <AppShell variant="catalog" className="pt-4">
      <PageHeader
        title="Inventory Browser"
        subtitle="Browse and manage AI-enriched inventory records."
        variant="minimal"
        className="mb-3"
        actions={
          <Button asChild variant="outline" size="sm">
            <Link href={refreshLink}>Refresh</Link>
          </Button>
        }
      />

      <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-2.5 py-1 font-medium text-foreground">
          <Package2 className="size-3.5 text-primary" />
          Total {inventoryStats.total}
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/30 bg-emerald-50 px-2.5 py-1 font-medium text-foreground">
          <CheckCircle2 className="size-3.5 text-emerald-600" />
          Available {inventoryStats.available}
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
            <SectionCard tone="soft" density="compact" className="border-border/55">
              <InventoryTableClient rows={result.rows} />
            </SectionCard>
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
