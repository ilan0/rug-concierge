import type { UiRole } from "@/lib/types/chat-ui";
import { isUiRole } from "@/lib/ui/roles";

const ROLE_STORAGE_KEY = "rug_concierge_ui_role";
const TENANT_STORAGE_KEY = "rug_concierge_tenant_id";

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

function normalizeTenantId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function getUiTenantId(): string | null {
  if (typeof window === "undefined") return null;
  return normalizeTenantId(window.localStorage.getItem(TENANT_STORAGE_KEY));
}

export function setUiTenantId(tenantId: string): void {
  if (typeof window === "undefined") return;
  const normalized = normalizeTenantId(tenantId);
  if (!normalized) return;
  window.localStorage.setItem(TENANT_STORAGE_KEY, normalized);
}

export function clearUiTenantId(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(TENANT_STORAGE_KEY);
}

export async function syncUiSession(_input: {
  role: UiRole | null;
  tenant_id?: string | null;
}): Promise<void> {
  return;
}

export async function syncRoleCookie(_role: UiRole | null): Promise<void> {
  return;
}
