import type { UiRole } from "@/lib/types/chat-ui";
import {
  canRoleAccessRoute,
  type AppRoutePath,
} from "@/lib/auth/policy";

export type UiRouteCard = {
  href: AppRoutePath;
  title: string;
  description: string;
};

const ALL_ROUTE_CARDS: UiRouteCard[] = [
  {
    href: "/concierge",
    title: "Concierge Screen",
    description:
      "Main customer-facing flow. Sends chat turns through backend routing and returns answers/recommendations.",
  },
  {
    href: "/inventory",
    title: "Inventory Browser",
    description:
      "Read-only owner/staff screen for trust and transparency across loaded inventory.",
  },
  {
    href: "/intake",
    title: "Inventory Intake",
    description:
      "Fast mobile-first workflow to intake a rug with photo, label, and dimensions.",
  },
];

export function getAllowedRoutesForRole(role: UiRole): UiRouteCard[] {
  return ALL_ROUTE_CARDS.filter((card) => canRoleAccessRoute(role, card.href));
}

export function roleCanAccessRoute(
  role: UiRole,
  route: UiRouteCard["href"]
): boolean {
  return canRoleAccessRoute(role, route);
}
