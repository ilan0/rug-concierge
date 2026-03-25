import { resolveTenantFromServerHeaders } from "@/lib/tenant/resolve-tenant";

export async function getServerUiTenantId(): Promise<string | null> {
  const resolved = await resolveTenantFromServerHeaders();
  return resolved.ok ? resolved.tenantId : null;
}
