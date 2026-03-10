import Link from "next/link";
import { WorkspaceNav } from "@/components/shell/workspace-nav";
import { AccessGuard } from "@/components/ui/access-guard";
import { AppShell } from "@/components/ui/app-shell";
import { PageHeader } from "@/components/ui/page-header";
import { SectionCard } from "@/components/ui/section-card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { RugImage } from "@/components/ui/rug-image";
import { listInventory } from "@/lib/inventory/list";
import { isDefaultInventoryFilters } from "@/lib/inventory/filters";
import { getServerUiRole, getServerUiTenantId } from "@/lib/ui/server-role";
import { canRoleAccessRoute } from "@/lib/auth/policy";

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

function formatPrice(value: number | null): string {
  if (typeof value !== "number") return "-";
  return `$${value.toLocaleString()}`;
}

function formatSize(widthIn: number | null, lengthIn: number | null): string {
  if (typeof widthIn !== "number" || typeof lengthIn !== "number") return "-";
  return `${widthIn}" x ${lengthIn}"`;
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

export default async function InventoryPage({ searchParams }: InventoryPageProps) {
  const role = await getServerUiRole();
  if (!role || !canRoleAccessRoute(role, "/inventory")) {
    return (
      <AccessGuard
        title="Inventory Browser"
        description="This page is available only to store staff and developers."
        ctaLabel="Go Home to switch role"
      />
    );
  }

  const tenantId = await getServerUiTenantId();
  if (!tenantId) {
    return (
      <AccessGuard
        title="Store Tenant Required"
        description="Select your store tenant on Home before browsing inventory."
      />
    );
  }

  const params = (await searchParams) ?? {};
  const page = toPositiveInt(readString(params.page), 1);
  const pageSize = toPositiveInt(readString(params.page_size), 50);

  const filtersInput = {
    q: readString(params.q),
    status: readString(params.status),
    priceMin: toNumberOrNull(readString(params.price_min)),
    priceMax: toNumberOrNull(readString(params.price_max)),
    widthMin: toNumberOrNull(readString(params.width_min)),
    widthMax: toNumberOrNull(readString(params.width_max)),
    lengthMin: toNumberOrNull(readString(params.length_min)),
    lengthMax: toNumberOrNull(readString(params.length_max)),
    sort: readString(params.sort),
  };

  const result = await listInventory({
    tenantId,
    page,
    pageSize,
    filters: filtersInput,
  });

  const prevPage = result.page > 1 ? result.page - 1 : null;
  const nextPage =
    result.totalPages > 0 && result.page < result.totalPages
      ? result.page + 1
      : null;

  const baseQuery = buildQueryString({
    page_size: result.pageSize,
    q: result.filters.q || null,
    status: result.filters.status !== "available" ? result.filters.status : null,
    price_min: result.filters.priceMin,
    price_max: result.filters.priceMax,
    width_min: result.filters.widthMin,
    width_max: result.filters.widthMax,
    length_min: result.filters.lengthMin,
    length_max: result.filters.lengthMax,
    sort: result.filters.sort !== "newest" ? result.filters.sort : null,
  });

  const pageBase = `/inventory?${baseQuery}`;
  const clearFiltersLink = `/inventory?${buildQueryString({
    page: 1,
    page_size: result.pageSize,
  })}`;

  const activeFilterItems = [
    result.filters.q ? `Query: ${result.filters.q}` : null,
    result.filters.status !== "available"
      ? `Status: ${result.filters.status}`
      : null,
    result.filters.priceMin !== null ? `Min Price: $${result.filters.priceMin}` : null,
    result.filters.priceMax !== null ? `Max Price: $${result.filters.priceMax}` : null,
    result.filters.widthMin !== null ? `Min Width: ${result.filters.widthMin}"` : null,
    result.filters.widthMax !== null ? `Max Width: ${result.filters.widthMax}"` : null,
    result.filters.lengthMin !== null
      ? `Min Length: ${result.filters.lengthMin}"`
      : null,
    result.filters.lengthMax !== null
      ? `Max Length: ${result.filters.lengthMax}"`
      : null,
    result.filters.sort !== "newest" ? `Sort: ${result.filters.sort}` : null,
  ].filter((item): item is string => Boolean(item));

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
          subtitle="Browse store inventory with simple filters and recommendation context."
          variant="catalog"
          actions={
            <Button asChild variant="outline">
              <Link href={`${pageBase}&page=1`}>Refresh</Link>
            </Button>
          }
        />

        <SectionCard tone="transparent" density="compact">
          <div className="flex flex-wrap gap-2 text-[0.95rem]">
            <Badge variant="secondary">Source: Supabase rugs</Badge>
            <Badge
              variant="outline"
              className="max-w-[17rem] overflow-hidden text-ellipsis whitespace-nowrap"
            >
              Tenant: {tenantId}
            </Badge>
            <Badge variant="outline">Records: {result.total}</Badge>
            <Badge variant="outline">
              Page: {result.totalPages === 0 ? 0 : result.page} / {result.totalPages}
            </Badge>
            <Badge variant="outline" className="hidden md:inline-flex">
              Loaded: {new Date(result.loadedAt).toLocaleString()}
            </Badge>
          </div>
        </SectionCard>

        <div className="mt-5 space-y-5">
          <SectionCard title="Search and Filters" tone="soft" className="border-border/55">
            <form method="GET" action="/inventory" className="grid gap-3 md:grid-cols-3 xl:grid-cols-5">
              <input type="hidden" name="page" value="1" />
              <input type="hidden" name="page_size" value={result.pageSize} />

              <div className="space-y-2 xl:col-span-2">
                <label className="text-sm font-medium" htmlFor="q">Search</label>
                <Input
                  id="q"
                  name="q"
                  defaultValue={result.filters.q}
                  placeholder="SKU, label, style, palette"
                  className="h-11 text-base"
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium" htmlFor="status">Status</label>
                <select
                  id="status"
                  name="status"
                  defaultValue={result.filters.status}
                  className="h-11 w-full rounded-md border border-input bg-background px-3 text-base"
                >
                  <option value="available">available</option>
                  <option value="all">all</option>
                  <option value="sold">sold</option>
                  <option value="on_hold">on_hold</option>
                </select>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium" htmlFor="sort">Sort</label>
                <select
                  id="sort"
                  name="sort"
                  defaultValue={result.filters.sort}
                  className="h-11 w-full rounded-md border border-input bg-background px-3 text-base"
                >
                  <option value="newest">newest</option>
                  <option value="oldest">oldest</option>
                  <option value="price_low">price low</option>
                  <option value="price_high">price high</option>
                </select>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium" htmlFor="price_min">Min Price</label>
                <Input
                  id="price_min"
                  name="price_min"
                  type="number"
                  min="0"
                  step="1"
                  defaultValue={result.filters.priceMin ?? ""}
                  className="h-11 text-base"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium" htmlFor="price_max">Max Price</label>
                <Input
                  id="price_max"
                  name="price_max"
                  type="number"
                  min="0"
                  step="1"
                  defaultValue={result.filters.priceMax ?? ""}
                  className="h-11 text-base"
                />
              </div>

              <details className="rounded-xl border border-border/60 bg-background/55 p-3 md:col-span-3 xl:col-span-5">
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
              <div className="space-y-3 md:hidden">
                {result.rows.map((rug) => (
                  <article
                    key={rug.id}
                    className="rounded-xl border border-border/65 bg-background/80 p-3"
                  >
                    <div className="mb-2 flex items-start gap-3">
                      <div className="h-16 w-16 shrink-0 overflow-hidden rounded-md border border-border/70 bg-muted">
                        <RugImage src={rug.primary_image_url} alt={rug.intake_label} />
                      </div>
                      <div>
                        <p className="text-base font-semibold">{rug.intake_label}</p>
                        <p className="text-xs text-muted-foreground">{rug.sku ?? rug.id}</p>
                        <p className="mt-1 text-sm text-muted-foreground">{rug.status ?? "-"}</p>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <p>
                        <span className="font-semibold">Price:</span> {formatPrice(rug.price)}
                      </p>
                      <p>
                        <span className="font-semibold">Sale:</span> {formatPrice(rug.sale_price)}
                      </p>
                      <p>
                        <span className="font-semibold">Size:</span>{" "}
                        {formatSize(rug.width_total_in, rug.length_total_in)}
                      </p>
                      <p>
                        <span className="font-semibold">Style:</span> {rug.style ?? "-"}
                      </p>
                    </div>
                  </article>
                ))}
              </div>

              <div className="hidden overflow-x-auto rounded-xl border border-border/70 md:block">
                <table className="w-full min-w-[1080px] border-collapse text-[0.95rem]">
                  <thead className="bg-secondary/50 text-left">
                    <tr>
                      <th className="p-3 font-semibold">Image</th>
                      <th className="p-3 font-semibold">SKU</th>
                      <th className="p-3 font-semibold">Label</th>
                      <th className="p-3 font-semibold">Status</th>
                      <th className="p-3 font-semibold">Price</th>
                      <th className="p-3 font-semibold">Sale Price</th>
                      <th className="p-3 font-semibold">Size</th>
                      <th className="p-3 font-semibold">Style</th>
                      <th className="p-3 font-semibold">Palette</th>
                      <th className="p-3 font-semibold">Pattern</th>
                      <th className="p-3 font-semibold">Best For</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.rows.map((rug) => (
                      <tr key={rug.id} className="border-t border-border">
                        <td className="p-3 align-top">
                          <div className="h-16 w-16 overflow-hidden rounded-md border border-border/70 bg-muted">
                            <RugImage
                              src={rug.primary_image_url}
                              alt={rug.intake_label}
                            />
                          </div>
                        </td>
                        <td className="p-3">{rug.sku ?? "-"}</td>
                        <td className="p-3 align-top">
                          <p className="font-medium">{rug.intake_label}</p>
                          <p className="mt-1 text-xs text-muted-foreground">{rug.id}</p>
                        </td>
                        <td className="p-3">{rug.status ?? "-"}</td>
                        <td className="p-3">{formatPrice(rug.price)}</td>
                        <td className="p-3">{formatPrice(rug.sale_price)}</td>
                        <td className="p-3">{formatSize(rug.width_total_in, rug.length_total_in)}</td>
                        <td className="p-3">{rug.style ?? "-"}</td>
                        <td className="p-3">{rug.palette ?? "-"}</td>
                        <td className="p-3">{rug.pattern ?? "-"}</td>
                        <td className="p-3">{rug.best_for ?? "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </SectionCard>
          )}

          <div className="flex items-center justify-between gap-3">
            {prevPage ? (
              <Button asChild variant="secondary">
                <Link href={`${pageBase}&page=${prevPage}`}>Previous</Link>
              </Button>
            ) : (
              <span className="text-sm text-muted-foreground">Previous</span>
            )}
            {nextPage ? (
              <Button asChild variant="secondary">
                <Link href={`${pageBase}&page=${nextPage}`}>Next</Link>
              </Button>
            ) : (
              <span className="text-sm text-muted-foreground">Next</span>
            )}
          </div>
        </div>
      </AppShell>
    </>
  );
}
