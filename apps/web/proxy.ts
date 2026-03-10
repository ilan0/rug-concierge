import { NextRequest, NextResponse } from "next/server";
import { isStaffUnlockedFromRequest } from "@/lib/auth/staff";

const STAFF_ROUTES = ["/inventory", "/intake"] as const;

function isStaffRoute(pathname: string): boolean {
  return STAFF_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`)
  );
}

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (isStaffRoute(pathname) && !isStaffUnlockedFromRequest(req)) {
    const url = req.nextUrl.clone();
    url.pathname = "/concierge";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/inventory/:path*", "/intake/:path*"],
};
