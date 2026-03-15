import { NextResponse } from "next/server";
import { getResolvedBranding } from "@/lib/branding/tenant-branding";

function readTrimmedEnv(name: string): string | null {
  const raw = process.env[name];
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export async function GET() {
  const branding = await getResolvedBranding();
  const isPasscodeGated = Boolean(readTrimmedEnv("STORE_PASSCODE"));

  return NextResponse.json({
    storeName: branding.storeName,
    storeLogoUrl: branding.storeLogoUrl,
    isPasscodeGated,
  });
}
