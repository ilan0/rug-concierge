export const APP_ROLES = [
  "retail_customer",
  "store_staff",
  "developer",
] as const;

export type AppRole = (typeof APP_ROLES)[number];

export function isAppRole(value: unknown): value is AppRole {
  return (
    typeof value === "string" &&
    APP_ROLES.some((candidate) => candidate === value)
  );
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
  if (role === "store_staff") return "Store Staff";
  return "Developer";
}
