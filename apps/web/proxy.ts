import { NextRequest, NextResponse } from "next/server";
import { isAppRole, type AppRole } from "@/lib/auth/roles";

const ROLE_COOKIE_NAME = "rug_ui_role";

function getDeploymentType(): "customer" | "staff" | "developer" {
  const value = process.env.DEPLOYMENT_TYPE?.trim();
  if (value === "customer" || value === "staff" || value === "developer") {
    return value;
  }
  return "developer";
}

function extractRoleFromCookie(rawValue: string | null | undefined): AppRole | null {
  if (typeof rawValue !== "string") return null;
  const rolePart = rawValue.split(".")[0]?.trim();
  if (!rolePart || !isAppRole(rolePart)) return null;
  return rolePart;
}

function resolveWorkspacePath(pathname: string):
  | "/concierge"
  | "/trade"
  | "/inventory"
  | "/intake"
  | "/appraisal"
  | null {
  if (pathname === "/concierge" || pathname.startsWith("/concierge/")) {
    return "/concierge";
  }
  if (pathname === "/trade" || pathname.startsWith("/trade/")) {
    return "/trade";
  }
  if (pathname === "/inventory" || pathname.startsWith("/inventory/")) {
    return "/inventory";
  }
  if (pathname === "/intake" || pathname.startsWith("/intake/")) {
    return "/intake";
  }
  if (pathname === "/appraisal" || pathname.startsWith("/appraisal/")) {
    return "/appraisal";
  }
  return null;
}

function redirectTo(request: NextRequest, path: string): NextResponse {
  const nextUrl = new URL(path, request.url);
  return NextResponse.redirect(nextUrl);
}

function withCanonicalTenantCookie(
  request: NextRequest,
  response: NextResponse
): NextResponse {
  const deploymentType = getDeploymentType();
  if (deploymentType === "developer") return response;

  const tenantId = process.env.TENANT_ID?.trim();
  if (!tenantId) return response;
  if (request.cookies.get("rug_ui_tenant_id")?.value === tenantId) return response;

  response.cookies.set("rug_ui_tenant_id", tenantId, {
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 30,
    httpOnly: false,
  });
  return response;
}

export function proxy(request: NextRequest) {
  const deploymentType = getDeploymentType();
  const pathname = request.nextUrl.pathname;
  const role = extractRoleFromCookie(request.cookies.get(ROLE_COOKIE_NAME)?.value);

  if (deploymentType === "developer") {
    return NextResponse.next();
  }

  if (pathname === "/join") {
    return withCanonicalTenantCookie(request, NextResponse.next());
  }

  if (deploymentType === "customer") {
    if (pathname === "/") {
      if (role === "trade_client") {
        return withCanonicalTenantCookie(request, redirectTo(request, "/trade"));
      }
      return withCanonicalTenantCookie(
        request,
        redirectTo(request, "/concierge")
      );
    }

    const route = resolveWorkspacePath(pathname);
    if (route === "/trade") {
      if (role === "trade_client") {
        return withCanonicalTenantCookie(request, NextResponse.next());
      }
      return withCanonicalTenantCookie(request, redirectTo(request, "/concierge"));
    }
    if (
      route === "/inventory" ||
      route === "/intake" ||
      route === "/appraisal"
    ) {
      return withCanonicalTenantCookie(
        request,
        redirectTo(request, "/concierge")
      );
    }
    return withCanonicalTenantCookie(request, NextResponse.next());
  }

  // Staff deployment

  if (pathname === "/") {
    if (role === "store_staff") {
      return withCanonicalTenantCookie(request, redirectTo(request, "/inventory"));
    }
    if (role === "developer") {
      return withCanonicalTenantCookie(request, NextResponse.next());
    }
    return withCanonicalTenantCookie(request, redirectTo(request, "/join"));
  }

  const route = resolveWorkspacePath(pathname);
  if (!route) {
    return withCanonicalTenantCookie(request, NextResponse.next());
  }

  if (route === "/trade" || route === "/concierge") {
    return withCanonicalTenantCookie(request, redirectTo(request, "/inventory"));
  }

  if (route === "/inventory" || route === "/intake" || route === "/appraisal") {
    if (role === "store_staff" || role === "developer") {
      return withCanonicalTenantCookie(request, NextResponse.next());
    }
    return withCanonicalTenantCookie(request, redirectTo(request, "/join"));
  }

  return withCanonicalTenantCookie(request, NextResponse.next());
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
