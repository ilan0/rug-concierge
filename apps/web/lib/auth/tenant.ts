import { getConfiguredTenantId } from "@/lib/auth/deployment";

export function normalizeTenantId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

export function hasTenantId(tenantId: string | null): tenantId is string {
  return typeof tenantId === "string" && tenantId.trim().length > 0;
}

export function requireTenantId(
  tenantId: string | null,
  flowLabel: "recommendation" | "inventory-backed flow"
): string | null {
  if (hasTenantId(tenantId)) return null;
  if (flowLabel === "recommendation") {
    return "tenant_id is required for recommendation requests.";
  }
  return "tenant_id is required for this inventory-backed request.";
}

export function resolveAuthoritativeTenantForServer(input: {
  requestTenantId?: unknown;
  cookieTenantId?: unknown;
}): string | null {
  const configuredTenant = getConfiguredTenantId();
  if (configuredTenant) return configuredTenant;
  return normalizeTenantId(input.requestTenantId) ?? normalizeTenantId(input.cookieTenantId) ?? null;
}

export function tenantMatchesDeploymentTenant(tenantId: string | null): boolean {
  const deploymentTenantId = getConfiguredTenantId();
  if (!deploymentTenantId) return true;
  return tenantId === deploymentTenantId;
}
