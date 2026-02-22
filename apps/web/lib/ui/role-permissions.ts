import type { UiRole } from "@/lib/types/chat-ui";

export type UiRouteCard = {
  href: "/concierge" | "/inventory" | "/appraisal";
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
    href: "/appraisal",
    title: "Appraisal Draft Studio",
    description:
      "Store staff workflow to generate, copy, and export structured appraisal drafts.",
  },
];

const ROLE_ALLOWED_ROUTES: Record<UiRole, UiRouteCard["href"][]> = {
  retail_customer: ["/concierge"],
  trade_client: ["/concierge"],
  store_staff: ["/concierge", "/inventory", "/appraisal"],
};

export function getAllowedRoutesForRole(role: UiRole): UiRouteCard[] {
  const allowed = new Set(ROLE_ALLOWED_ROUTES[role]);
  return ALL_ROUTE_CARDS.filter((card) => allowed.has(card.href));
}

export function roleCanAccessRoute(
  role: UiRole,
  route: UiRouteCard["href"]
): boolean {
  return ROLE_ALLOWED_ROUTES[role].includes(route);
}
