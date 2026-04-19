import type { SupabaseClient } from "@supabase/supabase-js";

const RUG_IMAGES_BUCKET = "rug-images";

export type RugPrimaryImage = {
  primary_image_url: string | null;
  primary_image_caption: string | null;
};

type RugImageRow = {
  rug_id: string;
  path: string | null;
  original_path?: string | null;
};

function normalizeStoragePath(path: string | null | undefined): string | null {
  if (typeof path !== "string") return null;
  const normalized = path.trim().replace(/^\/+/, "");
  return normalized.length > 0 ? normalized : null;
}

export function rugImagePathToPublicUrl(
  supabase: SupabaseClient,
  path: string | null | undefined
): string | null {
  const normalizedPath = normalizeStoragePath(path);
  if (!normalizedPath) return null;

  const { data } = supabase.storage
    .from(RUG_IMAGES_BUCKET)
    .getPublicUrl(normalizedPath);
  return typeof data.publicUrl === "string" && data.publicUrl.length > 0
    ? data.publicUrl
    : null;
}

export async function fetchPrimaryRugImagesForRugs(input: {
  supabase: SupabaseClient;
  tenantId: string;
  rugIds: string[];
}): Promise<Map<string, RugPrimaryImage>> {
  const map = new Map<string, RugPrimaryImage>();
  if (input.rugIds.length === 0) return map;

  const uniqueRugIds = [...new Set(input.rugIds)].filter(
    (id) => typeof id === "string" && id.trim().length > 0
  );
  if (uniqueRugIds.length === 0) return map;

  const { data, error } = await input.supabase
    .from("rug_images")
    .select("rug_id, path")
    .eq("tenant_id", input.tenantId)
    .in("rug_id", uniqueRugIds);

  if (error || !Array.isArray(data)) {
    return map;
  }

  const selectedByRug = new Map<string, RugImageRow>();
  for (const row of data) {
    if (!row || typeof row !== "object") continue;
    const candidate = row as Record<string, unknown>;
    if (typeof candidate.rug_id !== "string") continue;

    const imageRow: RugImageRow = {
      rug_id: candidate.rug_id,
      path: typeof candidate.path === "string" ? candidate.path : null,
    };
    if (!normalizeStoragePath(imageRow.path)) continue;

    // MVP assumption: unique rug_id in rug_images, so first valid row wins.
    if (selectedByRug.has(imageRow.rug_id)) continue;
    selectedByRug.set(imageRow.rug_id, imageRow);
  }

  for (const [rugId, row] of selectedByRug.entries()) {
    map.set(rugId, {
      primary_image_url: rugImagePathToPublicUrl(input.supabase, row.path),
      // Caption column is optional in current MVP schema usage.
      primary_image_caption: null,
    });
  }

  return map;
}

function isLikelyMissingColumnError(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("does not exist") ||
    normalized.includes("schema cache") ||
    normalized.includes("could not find the")
  );
}

export async function fetchSourceRugImageUrlsForRugs(input: {
  supabase: SupabaseClient;
  tenantId: string;
  rugIds: string[];
}): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (input.rugIds.length === 0) return map;

  const uniqueRugIds = [...new Set(input.rugIds)].filter(
    (id) => typeof id === "string" && id.trim().length > 0
  );
  if (uniqueRugIds.length === 0) return map;

  const runQuery = (columns: string) =>
    input.supabase
      .from("rug_images")
      .select(columns)
      .eq("tenant_id", input.tenantId)
      .in("rug_id", uniqueRugIds);

  let result = await runQuery("rug_id, path, original_path");
  if (result.error && isLikelyMissingColumnError(result.error.message ?? "")) {
    result = await runQuery("rug_id, path");
  }

  if (result.error || !Array.isArray(result.data)) {
    return map;
  }

  for (const row of result.data) {
    if (!row || typeof row !== "object") continue;
    const candidate = row as Record<string, unknown>;
    if (typeof candidate.rug_id !== "string" || map.has(candidate.rug_id)) {
      continue;
    }

    const originalPath =
      typeof candidate.original_path === "string" ? candidate.original_path : null;
    const displayPath = typeof candidate.path === "string" ? candidate.path : null;
    const sourcePath = normalizeStoragePath(originalPath) ?? normalizeStoragePath(displayPath);
    if (!sourcePath) continue;

    const publicUrl = rugImagePathToPublicUrl(input.supabase, sourcePath);
    if (!publicUrl) continue;
    map.set(candidate.rug_id, publicUrl);
  }

  return map;
}
