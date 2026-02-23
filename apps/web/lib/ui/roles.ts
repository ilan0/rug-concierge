import { APP_ROLES, appRoleLabel, isAppRole } from "@/lib/auth/roles";
import type { UiRole } from "@/lib/types/chat-ui";

const includeDeveloperRole =
  process.env.NEXT_PUBLIC_ENABLE_DEVELOPER_ROLE === "1" ||
  process.env.NODE_ENV !== "production";

export const UI_ROLES: UiRole[] = includeDeveloperRole
  ? [...APP_ROLES]
  : APP_ROLES.filter((role) => role !== "developer");

export function isUiRole(value: unknown): value is UiRole {
  return isAppRole(value);
}

export function uiRoleLabel(role: UiRole): string {
  return appRoleLabel(role);
}
