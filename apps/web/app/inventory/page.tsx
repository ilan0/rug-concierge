import Link from "next/link";
import { listInventory } from "@/lib/inventory/list";
import { isDefaultInventoryFilters } from "@/lib/inventory/filters";

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

  const recommendationHint = {
    budgetMax: result.filters.priceMax,
    size:
      result.filters.widthMin !== null && result.filters.lengthMin !== null
        ? {
            widthIn: result.filters.widthMin,
            lengthIn: result.filters.lengthMin,
          }
        : null,
  };

  return (
    <main className="inventory-page">
      <header className="inventory-header">
        <div>
          <p className="inventory-eyebrow">Owner Transparency</p>
          <h1>Inventory Browser</h1>
          <p className="inventory-subtitle">
            Read-only inventory view for trust review and recommendation support.
          </p>
        </div>
        <div className="inventory-header-actions">
          <Link href="/">Back Home</Link>
          <Link href={`${pageBase}&page=1`}>Refresh</Link>
        </div>
      </header>

      <section className="inventory-meta">
        <span>
          <strong>Data Source:</strong> Supabase `rugs` table
        </span>
        <span>
          <strong>Records:</strong> {result.total}
        </span>
        <span>
          <strong>Page:</strong> {result.totalPages === 0 ? 0 : result.page} /{" "}
          {result.totalPages}
        </span>
        <span>
          <strong>Loaded:</strong> {new Date(result.loadedAt).toLocaleString()}
        </span>
      </section>

      <section className="inventory-filters">
        <h2>Search + Filters</h2>
        <form method="GET" action="/inventory" className="inventory-filter-form">
          <input type="hidden" name="page" value="1" />
          <input type="hidden" name="page_size" value={result.pageSize} />

          <label>
            Search
            <input
              name="q"
              defaultValue={result.filters.q}
              placeholder="SKU, label, style, palette..."
            />
          </label>

          <label>
            Status
            <select name="status" defaultValue={result.filters.status}>
              <option value="available">available</option>
              <option value="all">all</option>
              <option value="sold">sold</option>
              <option value="on_hold">on_hold</option>
            </select>
          </label>

          <label>
            Sort
            <select name="sort" defaultValue={result.filters.sort}>
              <option value="newest">newest</option>
              <option value="oldest">oldest</option>
              <option value="price_low">price low</option>
              <option value="price_high">price high</option>
            </select>
          </label>

          <label>
            Min Price
            <input
              name="price_min"
              type="number"
              min="0"
              step="1"
              defaultValue={result.filters.priceMin ?? ""}
            />
          </label>

          <label>
            Max Price
            <input
              name="price_max"
              type="number"
              min="0"
              step="1"
              defaultValue={result.filters.priceMax ?? ""}
            />
          </label>

          <label>
            Min Width (in)
            <input
              name="width_min"
              type="number"
              min="0"
              step="1"
              defaultValue={result.filters.widthMin ?? ""}
            />
          </label>

          <label>
            Max Width (in)
            <input
              name="width_max"
              type="number"
              min="0"
              step="1"
              defaultValue={result.filters.widthMax ?? ""}
            />
          </label>

          <label>
            Min Length (in)
            <input
              name="length_min"
              type="number"
              min="0"
              step="1"
              defaultValue={result.filters.lengthMin ?? ""}
            />
          </label>

          <label>
            Max Length (in)
            <input
              name="length_max"
              type="number"
              min="0"
              step="1"
              defaultValue={result.filters.lengthMax ?? ""}
            />
          </label>

          <div className="inventory-filter-actions">
            <button type="submit">Apply Filters</button>
            <Link href={clearFiltersLink}>Clear</Link>
          </div>
        </form>
      </section>

      {!isDefaultInventoryFilters(result.filters) ? (
        <section className="inventory-active-filters">
          <h3>Active Filters</h3>
          <div className="inventory-chip-row">
            {activeFilterItems.map((item) => (
              <span key={item} className="inventory-chip">
                {item}
              </span>
            ))}
          </div>
        </section>
      ) : null}

      <section className="inventory-recommendation-hint">
        <h3>Recommendation Support Snapshot</h3>
        <p>
          Current filter-derived hard-constraint hint for recommendation testing:
        </p>
        <pre>{JSON.stringify(recommendationHint, null, 2)}</pre>
      </section>

      {result.error ? (
        <section className="inventory-error">
          <h2>Could not load inventory</h2>
          <p>{result.error}</p>
        </section>
      ) : result.rows.length === 0 ? (
        <section className="inventory-empty">
          <h2>No inventory rows found</h2>
          <p>
            No rugs matched current filters. Adjust search or broaden constraints.
          </p>
        </section>
      ) : (
        <section className="inventory-table-wrap">
          <table className="inventory-table">
            <thead>
              <tr>
                <th>SKU</th>
                <th>Label</th>
                <th>Status</th>
                <th>Price</th>
                <th>Sale Price</th>
                <th>Size</th>
                <th>Style</th>
                <th>Palette</th>
                <th>Pattern</th>
                <th>Best For</th>
              </tr>
            </thead>
            <tbody>
              {result.rows.map((rug) => (
                <tr key={rug.id}>
                  <td>{rug.sku ?? "-"}</td>
                  <td>
                    <div className="inventory-label">{rug.intake_label}</div>
                    <div className="inventory-id">{rug.id}</div>
                  </td>
                  <td>{rug.status ?? "-"}</td>
                  <td>{formatPrice(rug.price)}</td>
                  <td>{formatPrice(rug.sale_price)}</td>
                  <td>{formatSize(rug.width_total_in, rug.length_total_in)}</td>
                  <td>{rug.style ?? "-"}</td>
                  <td>{rug.palette ?? "-"}</td>
                  <td>{rug.pattern ?? "-"}</td>
                  <td>{rug.best_for ?? "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <footer className="inventory-pagination">
        {prevPage ? (
          <Link href={`${pageBase}&page=${prevPage}`}>Previous</Link>
        ) : (
          <span>Previous</span>
        )}
        {nextPage ? (
          <Link href={`${pageBase}&page=${nextPage}`}>Next</Link>
        ) : (
          <span>Next</span>
        )}
      </footer>
    </main>
  );
}
