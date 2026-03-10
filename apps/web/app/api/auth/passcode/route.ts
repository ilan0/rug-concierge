import { NextResponse } from "next/server";
import {
  buildDeviceAuthCookieValue,
  getCookieSecret,
  getStorePasscode,
  timingSafePasscodeMatch,
} from "@/lib/auth/device-auth";
import { getConfiguredTenantId } from "@/lib/auth/deployment";

type AttemptState = {
  attempts: number;
  lockedUntilMs: number;
};

const ATTEMPT_LIMIT = 5;
const LOCK_WINDOW_MS = 15 * 60 * 1000;
const DEVICE_COOKIE_NAME = "rug_device_auth";
const DEVICE_COOKIE_MAX_AGE_SECONDS = 34_560_000; // 400 days

const attemptsByIp = new Map<string, AttemptState>();

function getClientIp(req: Request): string {
  const forwardedFor = req.headers.get("x-forwarded-for");
  if (forwardedFor) {
    const [first] = forwardedFor.split(",");
    if (first && first.trim()) return first.trim();
  }
  return "unknown";
}

async function readSubmittedPasscode(req: Request): Promise<string | null> {
  const contentType = req.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) return null;
    return typeof body.passcode === "string" ? body.passcode.trim() : null;
  }

  const form = await req.formData().catch(() => null);
  if (!form) return null;
  const value = form.get("passcode");
  return typeof value === "string" ? value.trim() : null;
}

export async function POST(req: Request) {
  const configuredPasscode = getStorePasscode();
  if (!configuredPasscode) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const tenantId = getConfiguredTenantId();
  const cookieSecret = getCookieSecret();
  if (!tenantId || !cookieSecret) {
    return NextResponse.json(
      { error: "server_misconfigured" },
      { status: 500 }
    );
  }

  const ip = getClientIp(req);
  const now = Date.now();
  const existing = attemptsByIp.get(ip) ?? { attempts: 0, lockedUntilMs: 0 };

  if (existing.lockedUntilMs > now) {
    return NextResponse.json(
      {
        error: "too_many_attempts",
        lockedUntilMs: existing.lockedUntilMs,
      },
      { status: 429 }
    );
  }

  const submittedPasscode = await readSubmittedPasscode(req);
  if (!submittedPasscode) {
    return NextResponse.json(
      { error: "passcode_required" },
      { status: 400 }
    );
  }

  const isMatch = timingSafePasscodeMatch({
    submitted: submittedPasscode,
    expected: configuredPasscode,
  });

  if (!isMatch) {
    const attempts = existing.attempts + 1;
    const lockedUntilMs =
      attempts >= ATTEMPT_LIMIT ? now + LOCK_WINDOW_MS : 0;

    attemptsByIp.set(ip, { attempts, lockedUntilMs });

    return NextResponse.json(
      {
        error: "invalid_passcode",
        attemptsRemaining: Math.max(0, ATTEMPT_LIMIT - attempts),
      },
      { status: 401 }
    );
  }

  attemptsByIp.delete(ip);

  const cookieValue = buildDeviceAuthCookieValue({
    tenantId,
    cookieSecret,
  });

  const response = NextResponse.json({ success: true });
  response.cookies.set({
    name: DEVICE_COOKIE_NAME,
    value: cookieValue,
    httpOnly: true,
    secure: true,
    sameSite: "strict",
    maxAge: DEVICE_COOKIE_MAX_AGE_SECONDS,
    path: "/",
  });

  return response;
}
