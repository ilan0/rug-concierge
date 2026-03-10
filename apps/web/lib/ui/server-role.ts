import { resolveAuthoritativeTenantForServer } from "@/lib/auth/tenant";

export async function getServerUiTenantId(): Promise<string | null> {
  return resolveAuthoritativeTenantForServer({});
}
