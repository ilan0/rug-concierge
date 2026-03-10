import { NextRequest, NextResponse } from "next/server";
import { STAFF_COOKIE, STAFF_COOKIE_OPTIONS } from "@/lib/auth/staff";
import { checkRateLimit, passcodeRateLimit } from "@/lib/rate-limit";

export async function POST(req: NextRequest) {
  if (passcodeRateLimit) {
    const ip =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      req.headers.get("x-real-ip") ??
      "unknown";
    const { allowed } = await checkRateLimit(passcodeRateLimit, `passcode:${ip}`);
    if (!allowed) {
      return NextResponse.json({ error: "Too many attempts" }, { status: 429 });
    }
  }

  const { passcode } = await req.json().catch(() => ({ passcode: null })) as {
    passcode: string | null;
  };

  const expected = process.env.STORE_PASSCODE?.trim();
  if (!expected) {
    return NextResponse.json(
      { error: "Passcode not configured" },
      { status: 503 }
    );
  }

  if (!passcode || passcode !== expected) {
    return NextResponse.json({ error: "Invalid passcode" }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(STAFF_COOKIE, "1", STAFF_COOKIE_OPTIONS);
  return res;
}
