import { cookies } from "next/headers";
import type { UiRole } from "@/lib/types/chat-ui";
import { isUiRole } from "@/lib/ui/roles";
import { uiRoleCookieName } from "@/lib/ui/role-session";

export async function getServerUiRole(): Promise<UiRole | null> {
  const cookieStore = await cookies();
  const raw = cookieStore.get(uiRoleCookieName)?.value;
  if (!raw || !isUiRole(raw)) return null;
  return raw;
}
