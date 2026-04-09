import { supabaseAdmin } from "@/lib/supabase/admin";

const MAX_ATTRACT_IMAGES = 3;

export async function getAttractModeImageUrls(input: {
  tenantId: string;
}): Promise<string[]> {
  const query = await supabaseAdmin
    .from("rugs")
    .select("primary_image_url")
    .eq("tenant_id", input.tenantId)
    .eq("status", "available")
    .eq("enrichment_status", "ready")
    .not("primary_image_url", "is", null)
    .order("updated_at", { ascending: false })
    .limit(24);

  if (query.error || !Array.isArray(query.data)) {
    return [];
  }

  const deduped = new Set<string>();
  for (const row of query.data) {
    const value = typeof row.primary_image_url === "string" ? row.primary_image_url.trim() : "";
    if (!value) continue;
    deduped.add(value);
    if (deduped.size >= MAX_ATTRACT_IMAGES) {
      break;
    }
  }

  return [...deduped];
}

