export const DEPLOYMENT_TYPES = ["customer", "staff", "developer"] as const;
export type DeploymentType = (typeof DEPLOYMENT_TYPES)[number];

const warningCache = new Set<string>();
const DEV_FALLBACK_COOKIE_SECRET = "dev-insecure-cookie-secret-change-me";

function warnOnce(key: string, message: string): void {
  if (warningCache.has(key)) return;
  warningCache.add(key);
  console.warn(message);
}

function readTrimmedEnv(name: string): string | null {
  const raw = process.env[name];
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

function isValidDeploymentType(value: string | null): value is DeploymentType {
  return value === "customer" || value === "staff" || value === "developer";
}

function assertRequiredEnvForDeployment(
  deploymentType: DeploymentType,
  input: { cookieSecret: string | null; tenantId: string | null }
): void {
  if (!isProduction()) return;
  if (!input.cookieSecret || input.cookieSecret.length < 32) {
    throw new Error(
      "Missing COOKIE_SECRET. Set a 32+ character value for signed role cookies."
    );
  }
  if (
    (deploymentType === "customer" || deploymentType === "staff") &&
    !input.tenantId
  ) {
    throw new Error(
      "TENANT_ID is required for customer/staff deployments and must be set on the server."
    );
  }
}

export function getServerDeploymentType(): DeploymentType {
  const raw = readTrimmedEnv("DEPLOYMENT_TYPE");
  if (isValidDeploymentType(raw)) {
    assertRequiredEnvForDeployment(raw, {
      cookieSecret: readTrimmedEnv("COOKIE_SECRET"),
      tenantId: readTrimmedEnv("TENANT_ID"),
    });
    return raw;
  }
  if (isProduction()) {
    throw new Error(
      "Missing or invalid DEPLOYMENT_TYPE. Expected one of: customer, staff, developer."
    );
  }
  warnOnce(
    "missing-deployment-type",
    "[auth] DEPLOYMENT_TYPE is not set. Falling back to developer mode in non-production."
  );
  return "developer";
}

export function isDeveloperDeployment(): boolean {
  return getServerDeploymentType() === "developer";
}

export function isCustomerDeployment(): boolean {
  return getServerDeploymentType() === "customer";
}

export function isStaffDeployment(): boolean {
  return getServerDeploymentType() === "staff";
}

export function getRequiredTenantIdForDeployment(): string | null {
  const deploymentType = getServerDeploymentType();
  if (deploymentType === "developer") return null;
  const tenantId = readTrimmedEnv("TENANT_ID");
  if (tenantId) return tenantId;
  throw new Error(
    "TENANT_ID is required for customer/staff deployments and must be set on the server."
  );
}

export function getCookieSecret(): string {
  const secret = readTrimmedEnv("COOKIE_SECRET");
  if (secret && secret.length >= 32) return secret;
  if (isProduction()) {
    throw new Error(
      "Missing COOKIE_SECRET. Set a 32+ character value for signed role cookies."
    );
  }
  warnOnce(
    "missing-cookie-secret",
    "[auth] COOKIE_SECRET is missing or too short. Using development fallback secret."
  );
  return DEV_FALLBACK_COOKIE_SECRET;
}

export function isRoleSwitcherEnabledForServer(): boolean {
  if (getServerDeploymentType() === "developer") return true;
  if (!isProduction()) return true;
  return process.env.NEXT_PUBLIC_ENABLE_ROLE_SWITCHER === "1";
}

export function resolveAuthoritativeTenantId(input: {
  requestTenantId?: string | null;
  cookieTenantId?: string | null;
}): string | null {
  const deploymentType = getServerDeploymentType();
  if (deploymentType === "customer" || deploymentType === "staff") {
    return getRequiredTenantIdForDeployment();
  }

  if (input.requestTenantId && input.requestTenantId.trim()) {
    return input.requestTenantId.trim();
  }
  if (input.cookieTenantId && input.cookieTenantId.trim()) {
    return input.cookieTenantId.trim();
  }
  return null;
}
