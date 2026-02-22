import { NextResponse } from "next/server";
import { isUiRole } from "@/lib/ui/roles";
import { uiRoleCookieName } from "@/lib/ui/role-session";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { role?: unknown } | null;
  const role = body?.role;

  const response = NextResponse.json({ ok: true });

  if (role === null || role === undefined || role === "") {
    response.cookies.delete(uiRoleCookieName);
    return response;
  }

  if (!isUiRole(role)) {
    return NextResponse.json({ error: "Invalid role" }, { status: 400 });
  }

  response.cookies.set(uiRoleCookieName, role, {
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 30,
  });

  return response;
}
