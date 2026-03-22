import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  STAFF_COOKIE,
  STAFF_COOKIE_OPTIONS,
  buildStaffUnlockCookieValue,
} from "@/lib/auth/staff";
import { timingSafePasscodeMatch } from "@/lib/auth/device-auth";
import { getConfiguredTenantRuntimeSecrets } from "@/lib/tenant-secrets";
import {
  checkRateLimit,
  passcodeRateLimit,
} from "@/lib/rate-limit";
import { parseJsonBodyWithSchema } from "@/lib/http/route-validation";

const PASSCODE_BODY_SCHEMA = z
  .object({
    passcode: z.string().trim().min(1).max(128),
  })
  .strict();

function serviceUnavailable(message: string) {
  return NextResponse.json({ error: message }, { status: 503 });
}

export async function POST(req: NextRequest) {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    "unknown";
  const passcodeRateLimitResult = await checkRateLimit(
    passcodeRateLimit,
    `passcode:${ip}`
  );
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

  const secretsResult = await getConfiguredTenantRuntimeSecrets();
  if (!secretsResult.ok) {
    return serviceUnavailable(secretsResult.message);
  }

  const { tenantId, secrets } = secretsResult;
  if (!secrets.storePasscode) {
    return serviceUnavailable(
      `Store passcode is not configured for tenant "${tenantId}".`
    );
  }

  if (!secrets.cookieSecret) {
    return serviceUnavailable(
      `Cookie secret is not configured for tenant "${tenantId}".`
    );
  }

  if (
    !timingSafePasscodeMatch({
      submitted: passcode,
      expected: secrets.storePasscode,
    })
  ) {
    return NextResponse.json({ error: "Invalid passcode" }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(
    STAFF_COOKIE,
    buildStaffUnlockCookieValue({
      tenantId,
      cookieSecret: secrets.cookieSecret,
    }),
    STAFF_COOKIE_OPTIONS
  );
  return res;
}
