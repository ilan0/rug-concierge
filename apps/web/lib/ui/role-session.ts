import type { UiRole } from "@/lib/types/chat-ui";
import { isUiRole } from "@/lib/ui/roles";

const ROLE_STORAGE_KEY = "rug_concierge_ui_role";

export function getUiRole(): UiRole | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(ROLE_STORAGE_KEY);
  if (!raw || !isUiRole(raw)) return null;
  return raw;
}

export function setUiRole(role: UiRole): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(ROLE_STORAGE_KEY, role);
}

export function clearUiRole(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(ROLE_STORAGE_KEY);
}

export const uiRoleCookieName = "rug_ui_role";

export async function syncRoleCookie(role: UiRole | null): Promise<void> {
  const response = await fetch("/api/ui-role", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ role }),
  });
  if (!response.ok) {
    throw new Error("Role cookie sync failed.");
  }
}
