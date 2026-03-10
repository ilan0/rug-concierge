import { NextResponse } from "next/server";

function readTrimmedEnv(name: string): string | null {
  const raw = process.env[name];
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export async function GET() {
  const storeName = readTrimmedEnv("STORE_NAME") ?? "Rug Concierge";
  const storeLogoUrl = readTrimmedEnv("STORE_LOGO_URL");
  const isPasscodeGated = Boolean(readTrimmedEnv("STORE_PASSCODE"));

  return NextResponse.json({
    storeName,
    storeLogoUrl,
    isPasscodeGated,
  });
}
