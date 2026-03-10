function readTrimmedEnv(name: string): string | null {
  const raw = process.env[name];
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function isPasscodeGated(): boolean {
  return Boolean(readTrimmedEnv("STORE_PASSCODE"));
}

export function getConfiguredTenantId(): string | null {
  return readTrimmedEnv("TENANT_ID");
}

export function getRequiredTenantIdForDeployment(): string {
  const tenantId = getConfiguredTenantId();
  if (tenantId) return tenantId;
  throw new Error("TENANT_ID is required and must be set on the server.");
}

export function resolveAuthoritativeTenantId(input: {
  requestTenantId?: string | null;
  cookieTenantId?: string | null;
}): string | null {
  const configuredTenant = getConfiguredTenantId();
  if (configuredTenant) return configuredTenant;

  if (input.requestTenantId && input.requestTenantId.trim()) {
    return input.requestTenantId.trim();
  }
  if (input.cookieTenantId && input.cookieTenantId.trim()) {
    return input.cookieTenantId.trim();
  }

  return null;
}

export function isRoleSwitcherEnabledForServer(): boolean {
  return !isPasscodeGated() || process.env.NODE_ENV !== "production";
}
