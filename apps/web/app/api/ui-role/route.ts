import { NextResponse } from "next/server";
import { isUiRole } from "@/lib/ui/roles";
import { uiRoleCookieName, uiTenantCookieName } from "@/lib/ui/role-session";
import { requirePilotAccessApi } from "@/lib/auth/pilot-access";

function normalizeTenantId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export async function POST(req: Request) {
  const blocked = await requirePilotAccessApi();
  if (blocked) return blocked;

  const body = (await req.json().catch(() => null)) as
    | { role?: unknown; tenant_id?: unknown }
    | null;
  const role = body?.role;
  const tenantId = normalizeTenantId(body?.tenant_id);

  const response = NextResponse.json({ ok: true });

  if (role === null || role === undefined || role === "") {
    response.cookies.delete(uiRoleCookieName);
  } else {
    if (!isUiRole(role)) {
      return NextResponse.json({ error: "Invalid role" }, { status: 400 });
    }

    response.cookies.set(uiRoleCookieName, role, {
      path: "/",
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 60 * 60 * 24 * 30,
    });
  }

  if (tenantId) {
    response.cookies.set(uiTenantCookieName, tenantId, {
      path: "/",
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 60 * 60 * 24 * 30,
    });
  } else {
    response.cookies.delete(uiTenantCookieName);
  }

  return response;
}
