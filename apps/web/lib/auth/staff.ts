import { cookies } from "next/headers";
import type { NextRequest } from "next/server";

export const STAFF_COOKIE = "staff_unlocked";

/** Server component usage — reads cookie store */
export async function isStaffUnlocked(): Promise<boolean> {
  const jar = await cookies();
  return jar.get(STAFF_COOKIE)?.value === "1";
}

/** Middleware/route handler usage — reads from request */
export function isStaffUnlockedFromRequest(req: NextRequest): boolean {
  return req.cookies.get(STAFF_COOKIE)?.value === "1";
}

/** Cookie options used when setting */
export const STAFF_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "lax" as const,
  path: "/",
  secure: process.env.NODE_ENV === "production",
} as const;
