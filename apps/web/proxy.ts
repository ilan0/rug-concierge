import { NextRequest, NextResponse } from "next/server";
import { isStaffUnlockedFromRequest } from "@/lib/auth/staff";

const STAFF_ROUTES = ["/inventory", "/intake"] as const;
const CONCIERGE_ROUTE = "/concierge";

function isStaffRoute(pathname: string): boolean {
  return STAFF_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`)
  );
}

function isConciergeRoute(pathname: string): boolean {
  return pathname === CONCIERGE_ROUTE || pathname.startsWith(`${CONCIERGE_ROUTE}/`);
}

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const staffUnlocked = isStaffUnlockedFromRequest(req);

  if (isStaffRoute(pathname) && !staffUnlocked) {
    const url = req.nextUrl.clone();
    url.pathname = CONCIERGE_ROUTE;
    return NextResponse.redirect(url);
  }

  if (isConciergeRoute(pathname) && staffUnlocked) {
    const url = req.nextUrl.clone();
    url.pathname = "/inventory";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/concierge/:path*", "/inventory/:path*", "/intake/:path*"],
};
