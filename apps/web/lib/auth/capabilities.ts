import type { AppRole } from "@/lib/auth/roles";

export const APP_CAPABILITIES = [
  "chat.general",
  "chat.recommend",
  "inventory.read",
  "inventory.intake",
  "debug.trace.read",
  "debug.trace.capture",
] as const;

export type AppCapability = (typeof APP_CAPABILITIES)[number];

const ALL_CAPABILITIES = [...APP_CAPABILITIES] as readonly AppCapability[];

const ROLE_CAPABILITY_MAP: Record<AppRole, readonly AppCapability[]> = {
  retail_customer: ["chat.general", "chat.recommend"],
  store_staff: [
    "chat.general",
    "chat.recommend",
    "inventory.read",
    "inventory.intake",
    "debug.trace.read",
    "debug.trace.capture",
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
