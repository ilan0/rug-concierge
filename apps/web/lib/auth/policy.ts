import {
  roleHasCapability,
  type AppCapability,
} from "@/lib/auth/capabilities";
import type { AppRole } from "@/lib/auth/roles";

export type AppRoutePath = "/concierge" | "/trade" | "/inventory" | "/appraisal";

const ROUTE_CAPABILITY_REQUIREMENT: Record<AppRoutePath, AppCapability> = {
  "/concierge": "chat.general",
  "/trade": "chat.trade_support",
  "/inventory": "inventory.read",
  "/appraisal": "appraisal.generate",
};

export function canRoleAccessRoute(role: AppRole, route: AppRoutePath): boolean {
  return roleHasCapability(role, ROUTE_CAPABILITY_REQUIREMENT[route]);
}

export function canRoleUseReviewControls(role: AppRole): boolean {
  return roleHasCapability(role, "review.controls");
}

export function canRoleReadDebugTrace(role: AppRole): boolean {
  return roleHasCapability(role, "debug.trace.read");
}

export function canRoleCaptureDebugTrace(role: AppRole): boolean {
  return roleHasCapability(role, "debug.trace.capture");
}

export function canRoleGenerateAppraisal(role: AppRole): boolean {
  return roleHasCapability(role, "appraisal.generate");
}
