import { NextResponse } from "next/server";
import { isPasscodeGated } from "@/lib/auth/deployment";

function readTrimmedEnv(name: string): string | null {
  const raw = process.env[name];
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export async function GET() {
  const storeName = readTrimmedEnv("STORE_NAME") ?? "Rug Concierge";
  const storeLogoUrl = readTrimmedEnv("STORE_LOGO_URL");

  return NextResponse.json({
    storeName,
    storeLogoUrl,
    isPasscodeGated: isPasscodeGated(),
  });
}
