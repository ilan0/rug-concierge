import { cookies } from "next/headers";
import type { AppRole } from "@/lib/auth/roles";
import { isAppRole } from "@/lib/auth/roles";
import { uiRoleCookieName } from "@/lib/ui/role-session";

export async function getServerUiRole(): Promise<AppRole | null> {
  const cookieStore = await cookies();
  const raw = cookieStore.get(uiRoleCookieName)?.value;
  if (!raw || !isAppRole(raw)) return null;
  return raw;
}
