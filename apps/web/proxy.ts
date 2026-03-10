import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  buildDeviceAuthCookieValue,
  getCookieSecret,
  timingSafeCookieValueMatch,
} from "@/lib/auth/device-auth";
import { getConfiguredTenantId, isPasscodeGated } from "@/lib/auth/deployment";

function isPublicApiPath(pathname: string): boolean {
  return (
    pathname === "/api/auth/passcode" ||
    pathname === "/api/config/public" ||
    pathname === "/api/manifest"
  );
}

function hasValidDeviceCookie(request: NextRequest): boolean {
  const tenantId = getConfiguredTenantId();
  const cookieSecret = getCookieSecret();
  if (!tenantId || !cookieSecret) return false;

  const submittedCookieValue =
    request.cookies.get("rug_device_auth")?.value ?? "";
  if (!submittedCookieValue) return false;

  const expectedCookieValue = buildDeviceAuthCookieValue({
    tenantId,
    cookieSecret,
  });

  return timingSafeCookieValueMatch({
    submittedCookieValue,
    expectedCookieValue,
  });
}

export function proxy(request: NextRequest) {
  if (!isPasscodeGated()) {
    const pathname = request.nextUrl.pathname;
    const isStaffRoute =
      pathname === "/inventory" ||
      pathname.startsWith("/inventory/") ||
      pathname === "/intake" ||
      pathname.startsWith("/intake/");

    if (isStaffRoute) {
      const redirectUrl = new URL("/concierge", request.url);
      return NextResponse.redirect(redirectUrl);
    }
    return NextResponse.next();
  }

  const { pathname } = request.nextUrl;
  const isApiPath = pathname.startsWith("/api/");

  if (pathname === "/passcode" || isPublicApiPath(pathname)) {
    return NextResponse.next();
  }

  if (hasValidDeviceCookie(request)) {
    return NextResponse.next();
  }

  if (isApiPath) {
    return NextResponse.json({ error: "device_not_authenticated" }, { status: 401 });
  }

  const redirectUrl = new URL("/passcode", request.url);
  return NextResponse.redirect(redirectUrl);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
