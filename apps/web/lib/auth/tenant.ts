export function normalizeTenantId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

export function hasTenantId(tenantId: string | null): tenantId is string {
  return typeof tenantId === "string" && tenantId.trim().length > 0;
}
