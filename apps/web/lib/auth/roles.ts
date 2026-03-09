import type { DeploymentType } from "@/lib/auth/deployment";

export const APP_ROLES = [
  "retail_customer",
  "trade_client",
  "store_staff",
  "developer",
] as const;

export type AppRole = (typeof APP_ROLES)[number];

export function isAppRole(value: unknown): value is AppRole {
  return typeof value === "string" && APP_ROLES.includes(value as AppRole);
}

export function normalizeAppRole(
  value: unknown,
  fallback: AppRole = "retail_customer"
): AppRole {
  if (!isAppRole(value)) return fallback;
  return value;
}

export function appRoleLabel(role: AppRole): string {
  if (role === "retail_customer") return "Retail Customer";
  if (role === "trade_client") return "Trade Client";
  if (role === "store_staff") return "Store Staff";
  return "Developer";
}

export function capRoleForDeployment(
  role: AppRole | null,
  deploymentType: DeploymentType
): AppRole | null {
  if (deploymentType !== "customer") return role;
  return role === "retail_customer" || role === "trade_client" ? role : null;
}
