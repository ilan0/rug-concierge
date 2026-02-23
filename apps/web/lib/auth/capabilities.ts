import type { AppRole } from "@/lib/auth/roles";

export const APP_CAPABILITIES = [
  "chat.general",
  "chat.recommend",
  "chat.trade_support",
  "inventory.read",
  "appraisal.generate",
  "review.controls",
  "debug.trace.read",
  "debug.trace.capture",
] as const;

export type AppCapability = (typeof APP_CAPABILITIES)[number];

const ALL_CAPABILITIES = [...APP_CAPABILITIES] as readonly AppCapability[];

const ROLE_CAPABILITY_MAP: Record<AppRole, readonly AppCapability[]> = {
  retail_customer: ["chat.general", "chat.recommend"],
  trade_client: ["chat.general", "chat.recommend", "chat.trade_support"],
  store_staff: [
    "chat.general",
    "chat.recommend",
    "chat.trade_support",
    "inventory.read",
    "appraisal.generate",
    "review.controls",
  ],
  developer: ALL_CAPABILITIES,
};

export function getRoleCapabilities(role: AppRole): readonly AppCapability[] {
  return ROLE_CAPABILITY_MAP[role];
}

export function roleHasCapability(
  role: AppRole,
  capability: AppCapability
): boolean {
  return ROLE_CAPABILITY_MAP[role].includes(capability);
}
