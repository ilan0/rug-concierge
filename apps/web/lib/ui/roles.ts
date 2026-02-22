import type { UiRole } from "@/lib/types/chat-ui";

export const UI_ROLES: UiRole[] = [
  "retail_customer",
  "trade_client",
  "store_staff",
];

export function isUiRole(value: unknown): value is UiRole {
  return typeof value === "string" && UI_ROLES.includes(value as UiRole);
}

export function uiRoleLabel(role: UiRole): string {
  if (role === "retail_customer") return "Retail Customer";
  if (role === "trade_client") return "Trade Client";
  return "Store Staff";
}
