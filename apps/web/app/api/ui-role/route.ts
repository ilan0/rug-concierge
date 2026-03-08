import { NextResponse } from "next/server";
import { isUiRole } from "@/lib/ui/roles";
import { uiRoleCookieName, uiTenantCookieName } from "@/lib/ui/role-session";
import { requirePilotAccessApi } from "@/lib/auth/pilot-access";
import { createSignedRoleCookieValue, ROLE_COOKIE_MAX_AGE_SECONDS } from "@/lib/auth/role-cookie";
import { isDeveloperDeployment, isRoleSwitcherEnabledForServer } from "@/lib/auth/deployment";
import { resolveAuthoritativeTenantForServer } from "@/lib/auth/tenant";

export async function POST(req: Request) {
  const blocked = await requirePilotAccessApi();
  if (blocked) return blocked;

  if (!isRoleSwitcherEnabledForServer()) {
    return NextResponse.json(
      { error: "Role switching is disabled for this deployment." },
      { status: 403 }
    );
  }

  const body = (await req.json().catch(() => null)) as
    | { role?: unknown; tenant_id?: unknown }
    | null;
  const role = body?.role;
  const tenantId = resolveAuthoritativeTenantForServer({
    requestTenantId: body?.tenant_id,
  });

  if (!tenantId) {
    return NextResponse.json(
      {
        error:
          "tenant_id is required when setting a role cookie in developer deployment.",
      },
      { status: 400 }
    );
  }

  const response = NextResponse.json({ ok: true });

  if (role === null || role === undefined || role === "") {
    response.cookies.delete(uiRoleCookieName);
  } else {
    if (!isUiRole(role)) {
      return NextResponse.json({ error: "Invalid role" }, { status: 400 });
    }
    if (!isDeveloperDeployment() && role !== "retail_customer") {
      return NextResponse.json(
        { error: "Non-retail role changes are disabled on this deployment." },
        { status: 403 }
      );
    }

    response.cookies.set(uiRoleCookieName, createSignedRoleCookieValue(role, tenantId), {
      path: "/",
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: ROLE_COOKIE_MAX_AGE_SECONDS,
      httpOnly: false,
    });
  }

  response.cookies.set(uiTenantCookieName, tenantId, {
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: ROLE_COOKIE_MAX_AGE_SECONDS,
    httpOnly: false,
  });

  return response;
}
