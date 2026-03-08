import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import type { AppRole } from "@/lib/auth/roles";
import {
  getRequiredTenantIdForDeployment,
  getServerDeploymentType,
} from "@/lib/auth/deployment";
import {
  createSignedRoleCookieValue,
  ROLE_COOKIE_MAX_AGE_SECONDS,
  verifySignedRoleCookieValue,
} from "@/lib/auth/role-cookie";
import { resolveAuthoritativeTenantForServer } from "@/lib/auth/tenant";
import { uiRoleCookieName, uiTenantCookieName } from "@/lib/ui/role-session";

type JoinTokenMatch = {
  role: AppRole;
  matched: boolean;
};

function roleDefaultPortal(role: AppRole): string {
  if (role === "trade_client") return "/trade";
  if (role === "store_staff") return "/inventory";
  if (role === "developer") return "/";
  return "/concierge";
}

function tokenHash(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

function safeTokenCompare(input: string, expected: string): boolean {
  const left = tokenHash(input);
  const right = tokenHash(expected);
  return timingSafeEqual(left, right);
}

function evaluateJoinToken(token: string): JoinTokenMatch[] {
  const staffToken = process.env.STAFF_ACCESS_TOKEN?.trim() ?? "";
  const tradeToken = process.env.TRADE_ACCESS_TOKEN?.trim() ?? "";
  const devToken = process.env.DEV_ACCESS_TOKEN?.trim() ?? "";

  return [
    { role: "store_staff", matched: safeTokenCompare(token, staffToken) },
    { role: "trade_client", matched: safeTokenCompare(token, tradeToken) },
    { role: "developer", matched: safeTokenCompare(token, devToken) },
  ];
}

function renderHtmlPage(input: {
  title: string;
  message: string;
  ctaHref?: string;
  ctaLabel?: string;
}): NextResponse {
  const cta =
    input.ctaHref && input.ctaLabel
      ? `<p style="margin-top:16px"><a href="${input.ctaHref}" style="color:#6d4b2f;text-decoration:underline;">${input.ctaLabel}</a></p>`
      : "";
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${input.title}</title>
</head>
<body style="margin:0;font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;background:#f6efe6;color:#2f231b;">
  <main style="max-width:640px;margin:12vh auto;padding:24px;">
    <section style="background:#fffaf4;border:1px solid #d6c3ac;border-radius:16px;padding:24px;">
      <h1 style="margin:0 0 12px;font-size:1.4rem;">${input.title}</h1>
      <p style="margin:0;line-height:1.6;">${input.message}</p>
      ${cta}
    </section>
  </main>
</body>
</html>`;

  return new NextResponse(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function setRoleAndTenantCookies(
  response: NextResponse,
  role: AppRole,
  tenantId: string
): void {
  response.cookies.set(uiRoleCookieName, createSignedRoleCookieValue(role, tenantId), {
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: ROLE_COOKIE_MAX_AGE_SECONDS,
    httpOnly: false,
  });
  response.cookies.set(uiTenantCookieName, tenantId, {
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: ROLE_COOKIE_MAX_AGE_SECONDS,
    httpOnly: false,
  });
}

async function getExistingVerifiedCookieRole(): Promise<AppRole | null> {
  const cookieStore = await cookies();
  const rawRole = cookieStore.get(uiRoleCookieName)?.value ?? null;
  const tenantId = resolveAuthoritativeTenantForServer({
    cookieTenantId: cookieStore.get(uiTenantCookieName)?.value ?? null,
  });
  return verifySignedRoleCookieValue({
    rawCookieValue: rawRole,
    tenantId,
  });
}

export async function GET(req: Request) {
  const deploymentType = getServerDeploymentType();
  const url = new URL(req.url);
  const token = url.searchParams.get("token")?.trim() ?? "";

  if (!token) {
    const existingRole = await getExistingVerifiedCookieRole();
    if (existingRole) {
      return NextResponse.redirect(new URL(roleDefaultPortal(existingRole), req.url));
    }

    if (deploymentType === "customer") {
      const tenantId =
        getRequiredTenantIdForDeployment() ??
        resolveAuthoritativeTenantForServer({}) ??
        null;
      if (!tenantId) {
        return renderHtmlPage({
          title: "Configuration Error",
          message: "Tenant configuration is missing for this deployment.",
        });
      }
      const response = NextResponse.redirect(new URL("/concierge", req.url));
      setRoleAndTenantCookies(response, "retail_customer", tenantId);
      return response;
    }

    return renderHtmlPage({
      title: "Use Your Access Link",
      message:
        "To access this portal, use your bookmarked access link. Contact your store manager if you no longer have it.",
      ctaHref: "/",
      ctaLabel: "Back to Access Gate",
    });
  }

  const comparisons = evaluateJoinToken(token);
  const matched = comparisons.find((item) => item.matched) ?? null;
  if (!matched) {
    return renderHtmlPage({
      title: "Invalid Or Expired Link",
      message: "This access link is invalid or expired. Contact your store manager.",
    });
  }

  const tenantId =
    getRequiredTenantIdForDeployment() ??
    resolveAuthoritativeTenantForServer({}) ??
    null;
  if (!tenantId) {
    return renderHtmlPage({
      title: "Configuration Error",
      message: "Tenant configuration is missing for this deployment.",
    });
  }

  const response = NextResponse.redirect(new URL(roleDefaultPortal(matched.role), req.url));
  setRoleAndTenantCookies(response, matched.role, tenantId);
  return response;
}
