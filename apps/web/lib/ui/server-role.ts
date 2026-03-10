import { isPasscodeGated } from "@/lib/auth/deployment";
import type { AppRole } from "@/lib/auth/roles";
import { resolveAuthoritativeTenantForServer } from "@/lib/auth/tenant";

export async function getServerUiRole(): Promise<AppRole | null> {
  return isPasscodeGated() ? "store_staff" : "retail_customer";
}

export async function getServerUiTenantId(): Promise<string | null> {
  return resolveAuthoritativeTenantForServer({});
}

export async function hasServerUiRoleCookie(): Promise<boolean> {
  return false;
}
