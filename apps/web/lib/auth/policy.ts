import {
  roleHasCapability,
  type AppCapability,
} from "@/lib/auth/capabilities";
import type { AppRole } from "@/lib/auth/roles";

export type AppRoutePath =
  | "/concierge"
  | "/inventory"
  | "/intake";

const ROUTE_CAPABILITY_REQUIREMENT: Record<AppRoutePath, AppCapability> = {
  "/concierge": "chat.general",
  "/inventory": "inventory.read",
  "/intake": "inventory.intake",
};

export function canRoleAccessRoute(role: AppRole, route: AppRoutePath): boolean {
  return roleHasCapability(role, ROUTE_CAPABILITY_REQUIREMENT[route]);
}

export function canRoleReadDebugTrace(role: AppRole): boolean {
  return roleHasCapability(role, "debug.trace.read");
}

export function canRoleCaptureDebugTrace(role: AppRole): boolean {
  return roleHasCapability(role, "debug.trace.capture");
}
