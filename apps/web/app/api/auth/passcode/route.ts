import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  STAFF_COOKIE,
  STAFF_COOKIE_OPTIONS,
  getStaffUnlockCookieValue,
} from "@/lib/auth/staff";
import { timingSafePasscodeMatch } from "@/lib/auth/device-auth";
import {
  checkLocalRateLimit,
  checkRateLimit,
  passcodeRateLimit,
} from "@/lib/rate-limit";
import { parseJsonBodyWithSchema } from "@/lib/http/route-validation";

const PASSCODE_BODY_SCHEMA = z
  .object({
    passcode: z.string().trim().min(1).max(128),
  })
  .strict();

export async function POST(req: NextRequest) {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    "unknown";
  const passcodeRateLimitResult = passcodeRateLimit
    ? await checkRateLimit(passcodeRateLimit, `passcode:${ip}`)
    : checkLocalRateLimit({
        key: `passcode:${ip}`,
        maxRequests: 5,
        windowMs: 5 * 60 * 1000,
      });
  if (!passcodeRateLimitResult.allowed) {
    const retryAfterSeconds = passcodeRateLimitResult.resetAtMs
      ? Math.max(
          1,
          Math.ceil((passcodeRateLimitResult.resetAtMs - Date.now()) / 1000)
        )
      : 5 * 60;
    return NextResponse.json(
      {
        error: "Too many attempts",
        retry_after_seconds: retryAfterSeconds,
      },
      {
        status: 429,
        headers: {
          "Retry-After": String(retryAfterSeconds),
        },
      }
    );
  }

  const parsedBody = await parseJsonBodyWithSchema(
    req,
    PASSCODE_BODY_SCHEMA,
    "Invalid passcode payload."
  );
  if (!parsedBody.ok) return parsedBody.response;
  const { passcode } = parsedBody.value;

  const expected = process.env.STORE_PASSCODE?.trim();
  if (!expected) {
    return NextResponse.json(
      { error: "Passcode not configured" },
      { status: 503 }
    );
  }

  if (
    !timingSafePasscodeMatch({ submitted: passcode, expected })
  ) {
    return NextResponse.json({ error: "Invalid passcode" }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(STAFF_COOKIE, getStaffUnlockCookieValue(), STAFF_COOKIE_OPTIONS);
  return res;
}
