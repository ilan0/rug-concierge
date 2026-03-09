import { SUPABASE_SECRET_KEY, SUPABASE_URL, TENANT_ID } from "../config";

function requireCleanupConfig(): { url: string; key: string } {
  const url = SUPABASE_URL?.trim();
  const key = SUPABASE_SECRET_KEY?.trim();
  if (!url || !key) {
    throw new Error(
      "SUPABASE_URL and SUPABASE_SECRET_KEY are required in tests/e2e/config.ts for intake cleanup."
    );
  }
  return { url, key };
}

async function supabaseDelete(path: string): Promise<void> {
  const { url, key } = requireCleanupConfig();
  const response = await fetch(`${url}${path}`, {
    method: "DELETE",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      Prefer: "return=minimal",
    },
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Supabase delete failed (${response.status}): ${body}`);
  }
}

export async function cleanupIntakeRug(rugId: string): Promise<void> {
  const encodedTenant = encodeURIComponent(TENANT_ID);
  const encodedRug = encodeURIComponent(rugId);

  await supabaseDelete(
    `/rest/v1/rug_images?tenant_id=eq.${encodedTenant}&rug_id=eq.${encodedRug}`
  );
  await supabaseDelete(
    `/rest/v1/rugs?tenant_id=eq.${encodedTenant}&id=eq.${encodedRug}`
  );
}
