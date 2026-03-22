import { cookies } from "next/headers";
import type { NextRequest } from "next/server";
import {
  buildDeviceAuthCookieValue,
  timingSafeCookieValueMatch,
} from "@/lib/auth/device-auth";
import { IS_PRODUCTION } from "@/lib/config";
import { getConfiguredTenantRuntimeSecrets } from "@/lib/tenant-secrets";

export const STAFF_COOKIE = "staff_unlocked";

export type StaffUnlockCheckResult =
  | { ok: true; unlocked: boolean }
  | { ok: false; message: string };

export function buildStaffUnlockCookieValue(input: {
  tenantId: string;
  cookieSecret: string;
}): string {
  return buildDeviceAuthCookieValue({
    tenantId: input.tenantId,
    cookieSecret: input.cookieSecret,
  });
}

async function getExpectedStaffCookieValue(): Promise<
  { ok: true; value: string } | { ok: false; message: string }
> {
  const secretsResult = await getConfiguredTenantRuntimeSecrets();
  if (!secretsResult.ok) {
    return { ok: false, message: secretsResult.message };
  }

  const cookieSecret = secretsResult.secrets.cookieSecret;
  if (!cookieSecret) {
    return {
      ok: false,
      message: `Cookie secret is not configured for tenant "${secretsResult.tenantId}".`,
    };
  }

  return {
    ok: true,
    value: buildStaffUnlockCookieValue({
      tenantId: secretsResult.tenantId,
      cookieSecret,
    }),
  };
}

async function checkStaffUnlockCookieValue(
  value: string | undefined
): Promise<StaffUnlockCheckResult> {
  if (!value) return { ok: true, unlocked: false };

  const expected = await getExpectedStaffCookieValue();
  if (!expected.ok) {
    return expected;
  }

  return {
    ok: true,
    unlocked: timingSafeCookieValueMatch({
      submittedCookieValue: value,
      expectedCookieValue: expected.value,
    }),
  };
}

/** Server component usage — reads cookie store */
export async function isStaffUnlocked(): Promise<boolean> {
  const jar = await cookies();
  const result = await checkStaffUnlockCookieValue(jar.get(STAFF_COOKIE)?.value);
  return result.ok ? result.unlocked : false;
}

/** Middleware/route handler usage — reads from request */
export async function getStaffUnlockStateFromRequest(
  req: NextRequest
): Promise<StaffUnlockCheckResult> {
  return checkStaffUnlockCookieValue(req.cookies.get(STAFF_COOKIE)?.value);
}

/** Middleware/route handler usage — reads from request */
export async function isStaffUnlockedFromRequest(
  req: NextRequest
): Promise<boolean> {
  const result = await getStaffUnlockStateFromRequest(req);
  return result.ok ? result.unlocked : false;
}

/** Cookie options used when setting */
export const STAFF_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "lax" as const,
  path: "/",
  secure: IS_PRODUCTION,
} as const;
