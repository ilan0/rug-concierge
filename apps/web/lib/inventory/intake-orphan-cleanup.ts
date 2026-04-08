import { supabaseAdmin } from "@/lib/supabase/admin";
import { RUG_IMAGES_BUCKET } from "@/lib/intake/direct-upload";

const DEFAULT_STALE_AFTER_MS = 24 * 60 * 60 * 1000;
const LIST_PAGE_SIZE = 1000;
const DELETE_BATCH_SIZE = 100;
const MAX_SCANNED_OBJECTS_PER_RUN = 25_000;

type StorageListEntry = {
  name?: string;
  id?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  last_accessed_at?: string | null;
};

type CleanupTenantSummary = {
  tenant_id: string;
  scanned: number;
  deleted: number;
  kept_referenced: number;
  kept_fresh: number;
  errors: string[];
};

export type IntakeOrphanCleanupSummary = {
  started_at: string;
  finished_at: string;
  stale_after_hours: number;
  max_scanned_objects: number;
  tenants: CleanupTenantSummary[];
  totals: {
    scanned: number;
    deleted: number;
    kept_referenced: number;
    kept_fresh: number;
    errors: number;
  };
};

function normalizePath(path: string): string {
  return path.trim().replace(/^\/+/, "").replace(/\/+/g, "/");
}

function parseDateMs(value: string | null | undefined): number | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function isFolderEntry(entry: StorageListEntry): boolean {
  if (typeof entry.id === "string" && entry.id.trim()) return false;
  return true;
}

async function listTenantStoragePaths(input: {
  tenantId: string;
  maxObjects: number;
}): Promise<{ paths: Array<{ path: string; updatedAtMs: number | null }>; errors: string[] }> {
  const queue: string[] = [input.tenantId];
  const paths: Array<{ path: string; updatedAtMs: number | null }> = [];
  const errors: string[] = [];

  while (queue.length > 0 && paths.length < input.maxObjects) {
    const prefix = queue.shift();
    if (!prefix) continue;

    let offset = 0;
    while (paths.length < input.maxObjects) {
      const listed = await supabaseAdmin.storage.from(RUG_IMAGES_BUCKET).list(prefix, {
        limit: LIST_PAGE_SIZE,
        offset,
      });

      if (listed.error || !Array.isArray(listed.data)) {
        errors.push(
          `list_failed:${prefix}:${listed.error?.message ?? "unknown storage list error"}`
        );
        break;
      }

      const rows = listed.data as StorageListEntry[];
      for (const row of rows) {
        const name = typeof row.name === "string" ? row.name.trim() : "";
        if (!name) continue;

        const nextPath = normalizePath(`${prefix}/${name}`);
        if (isFolderEntry(row)) {
          queue.push(nextPath);
          continue;
        }

        const updatedAtMs =
          parseDateMs(row.updated_at) ??
          parseDateMs(row.last_accessed_at) ??
          parseDateMs(row.created_at);
        paths.push({ path: nextPath, updatedAtMs });

        if (paths.length >= input.maxObjects) break;
      }

      if (rows.length < LIST_PAGE_SIZE || paths.length >= input.maxObjects) {
        break;
      }
      offset += LIST_PAGE_SIZE;
    }
  }

  return { paths, errors };
}

async function loadReferencedPathsForTenant(
  tenantId: string
): Promise<{ paths: Set<string>; error: string | null }> {
  const referenced = new Set<string>();
  let from = 0;

  while (true) {
    const to = from + LIST_PAGE_SIZE - 1;
    const query = await supabaseAdmin
      .from("rug_images")
      .select("path")
      .eq("tenant_id", tenantId)
      .range(from, to);

    if (query.error || !Array.isArray(query.data)) {
      return {
        paths: referenced,
        error: query.error?.message ?? "failed_to_query_rug_images",
      };
    }

    for (const row of query.data) {
      const path = typeof row.path === "string" ? row.path.trim() : "";
      if (!path) continue;
      referenced.add(normalizePath(path));
    }

    if (query.data.length < LIST_PAGE_SIZE) {
      break;
    }
    from += LIST_PAGE_SIZE;
  }

  return {
    paths: referenced,
    error: null,
  };
}

async function deletePaths(paths: string[]): Promise<{ deleted: number; error: string | null }> {
  if (paths.length === 0) return { deleted: 0, error: null };
  const removed = await supabaseAdmin.storage.from(RUG_IMAGES_BUCKET).remove(paths);
  if (removed.error) {
    return { deleted: 0, error: removed.error.message };
  }
  return { deleted: paths.length, error: null };
}

export async function runIntakeOrphanCleanup(input?: {
  staleAfterMs?: number;
  maxScannedObjects?: number;
}): Promise<IntakeOrphanCleanupSummary> {
  const startedAt = new Date().toISOString();
  const staleAfterMs =
    typeof input?.staleAfterMs === "number" && Number.isFinite(input.staleAfterMs)
      ? Math.max(1, Math.floor(input.staleAfterMs))
      : DEFAULT_STALE_AFTER_MS;
  const maxScannedObjects =
    typeof input?.maxScannedObjects === "number" && Number.isFinite(input.maxScannedObjects)
      ? Math.max(100, Math.floor(input.maxScannedObjects))
      : MAX_SCANNED_OBJECTS_PER_RUN;
  const staleCutoffMs = Date.now() - staleAfterMs;

  const tenantsQuery = await supabaseAdmin.from("tenants").select("id");
  const tenantIds =
    !tenantsQuery.error && Array.isArray(tenantsQuery.data)
      ? tenantsQuery.data
          .map((row) => (typeof row.id === "string" ? row.id.trim() : ""))
          .filter((id): id is string => id.length > 0)
      : [];

  const tenantSummaries: CleanupTenantSummary[] = [];
  let remainingScanBudget = maxScannedObjects;

  for (const tenantId of tenantIds) {
    const tenantSummary: CleanupTenantSummary = {
      tenant_id: tenantId,
      scanned: 0,
      deleted: 0,
      kept_referenced: 0,
      kept_fresh: 0,
      errors: [],
    };

    if (remainingScanBudget <= 0) {
      tenantSummary.errors.push("scan_budget_exhausted");
      tenantSummaries.push(tenantSummary);
      continue;
    }

    const [referenced, listed] = await Promise.all([
      loadReferencedPathsForTenant(tenantId),
      listTenantStoragePaths({
        tenantId,
        maxObjects: remainingScanBudget,
      }),
    ]);

    if (referenced.error) {
      tenantSummary.errors.push(`rug_images_query_failed:${referenced.error}`);
      tenantSummaries.push(tenantSummary);
      continue;
    }

    tenantSummary.errors.push(...listed.errors);

    const deletable: string[] = [];
    for (const object of listed.paths) {
      tenantSummary.scanned += 1;
      remainingScanBudget = Math.max(0, remainingScanBudget - 1);

      const normalizedPath = normalizePath(object.path);
      if (referenced.paths.has(normalizedPath)) {
        tenantSummary.kept_referenced += 1;
        continue;
      }

      if (object.updatedAtMs !== null && object.updatedAtMs > staleCutoffMs) {
        tenantSummary.kept_fresh += 1;
        continue;
      }

      deletable.push(normalizedPath);
    }

    for (let index = 0; index < deletable.length; index += DELETE_BATCH_SIZE) {
      const chunk = deletable.slice(index, index + DELETE_BATCH_SIZE);
      const deleted = await deletePaths(chunk);
      if (deleted.error) {
        tenantSummary.errors.push(`delete_failed:${deleted.error}`);
        continue;
      }
      tenantSummary.deleted += deleted.deleted;
    }

    tenantSummaries.push(tenantSummary);
  }

  const totals = tenantSummaries.reduce(
    (acc, summary) => {
      acc.scanned += summary.scanned;
      acc.deleted += summary.deleted;
      acc.kept_referenced += summary.kept_referenced;
      acc.kept_fresh += summary.kept_fresh;
      acc.errors += summary.errors.length;
      return acc;
    },
    {
      scanned: 0,
      deleted: 0,
      kept_referenced: 0,
      kept_fresh: 0,
      errors: 0,
    }
  );

  return {
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    stale_after_hours: Math.round((staleAfterMs / (60 * 60 * 1000)) * 100) / 100,
    max_scanned_objects: maxScannedObjects,
    tenants: tenantSummaries,
    totals,
  };
}
