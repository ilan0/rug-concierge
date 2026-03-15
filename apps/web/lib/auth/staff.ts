import { cookies } from "next/headers";
import type { NextRequest } from "next/server";
import {
  buildDeviceAuthCookieValue,
  getCookieSecret,
  timingSafeCookieValueMatch,
} from "@/lib/auth/device-auth";

export const STAFF_COOKIE = "staff_unlocked";
const STAFF_COOKIE_LEGACY_VALUE = "1";
const STAFF_COOKIE_SCOPE_ID = "staff-unlock";

function getExpectedStaffCookieValue(): string {
  const cookieSecret = getCookieSecret();
  if (!cookieSecret) return STAFF_COOKIE_LEGACY_VALUE;
  return buildDeviceAuthCookieValue({
    tenantId: STAFF_COOKIE_SCOPE_ID,
    cookieSecret,
  });
}

export function getStaffUnlockCookieValue(): string {
  return getExpectedStaffCookieValue();
}

function matchesExpectedStaffCookieValue(value: string | undefined): boolean {
  if (!value) return false;
  const expected = getExpectedStaffCookieValue();
  if (expected === STAFF_COOKIE_LEGACY_VALUE) {
    return value === STAFF_COOKIE_LEGACY_VALUE;
  }
  return timingSafeCookieValueMatch({
    submittedCookieValue: value,
    expectedCookieValue: expected,
  });
}

/** Server component usage — reads cookie store */
export async function isStaffUnlocked(): Promise<boolean> {
  const jar = await cookies();
  return matchesExpectedStaffCookieValue(jar.get(STAFF_COOKIE)?.value);
}

/** Middleware/route handler usage — reads from request */
export function isStaffUnlockedFromRequest(req: NextRequest): boolean {
  return matchesExpectedStaffCookieValue(req.cookies.get(STAFF_COOKIE)?.value);
}

/** Cookie options used when setting */
export const STAFF_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "lax" as const,
  path: "/",
  secure: process.env.NODE_ENV === "production",
} as const;
