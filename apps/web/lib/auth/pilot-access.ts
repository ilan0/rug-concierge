import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";

export const pilotAccessCookieName = "rug_pilot_access";
const VERIFIED_VALUE = "1";

function configuredPasscode(): string | null {
  const raw = process.env.PILOT_ACCESS_PASSCODE;
  if (!raw) return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function isPilotAccessEnabled(): boolean {
  return Boolean(configuredPasscode());
}

function safeCompare(value: string, expected: string): boolean {
  const valueBuffer = Buffer.from(value);
  const expectedBuffer = Buffer.from(expected);
  if (valueBuffer.length !== expectedBuffer.length) return false;
  return timingSafeEqual(valueBuffer, expectedBuffer);
}

export function isPilotPasscodeValid(input: string): boolean {
  const expected = configuredPasscode();
  if (!expected) return true;
  return safeCompare(input.trim(), expected);
}

export async function getPilotAccessState(): Promise<{
  required: boolean;
  verified: boolean;
}> {
  if (!isPilotAccessEnabled()) {
    return { required: false, verified: true };
  }
  const cookieStore = await cookies();
  const verified = cookieStore.get(pilotAccessCookieName)?.value === VERIFIED_VALUE;
  return { required: true, verified };
}

export async function requirePilotAccessApi(): Promise<NextResponse | null> {
  const state = await getPilotAccessState();
  if (!state.required || state.verified) return null;
  return NextResponse.json(
    {
      error: "Pilot access required. Enter access code on Home before continuing.",
      code: "UNAUTHORIZED",
    },
    { status: 401 }
  );
}

export function applyPilotAccessCookie(
  response: NextResponse,
  verified: boolean
): void {
  if (!verified) {
    response.cookies.delete(pilotAccessCookieName);
    return;
  }
  response.cookies.set(pilotAccessCookieName, VERIFIED_VALUE, {
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 30,
  });
}
