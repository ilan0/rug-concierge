import { cookies } from "next/headers";
import type { AppRole } from "@/lib/auth/roles";
import { verifySignedRoleCookieValue } from "@/lib/auth/role-cookie";
import { resolveAuthoritativeTenantForServer } from "@/lib/auth/tenant";
import { uiRoleCookieName, uiTenantCookieName } from "@/lib/ui/role-session";

export async function getServerUiRole(): Promise<AppRole | null> {
  const cookieStore = await cookies();
  const rawRoleCookie = cookieStore.get(uiRoleCookieName)?.value ?? null;
  const tenantId = resolveAuthoritativeTenantForServer({
    cookieTenantId: cookieStore.get(uiTenantCookieName)?.value ?? null,
  });
  return verifySignedRoleCookieValue({
    rawCookieValue: rawRoleCookie,
    tenantId,
  });
}

export async function getServerUiTenantId(): Promise<string | null> {
  const cookieStore = await cookies();
  return resolveAuthoritativeTenantForServer({
    cookieTenantId: cookieStore.get(uiTenantCookieName)?.value ?? null,
  });
}

export async function hasServerUiRoleCookie(): Promise<boolean> {
  const cookieStore = await cookies();
  return Boolean(cookieStore.get(uiRoleCookieName)?.value);
}
