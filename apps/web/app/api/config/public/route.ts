import { NextResponse } from "next/server";
import { getResolvedBranding } from "@/lib/branding/tenant-branding";
import {
  getConfiguredTenantSettings,
  readTenantPasscodeGatedFromSettings,
} from "@/lib/tenant-settings";

export async function GET() {
  const [branding, settingsResult] = await Promise.all([
    getResolvedBranding(),
    getConfiguredTenantSettings(),
  ]);

  if (!settingsResult.ok) {
    return NextResponse.json({ error: settingsResult.message }, { status: 503 });
  }

  const isPasscodeGated = readTenantPasscodeGatedFromSettings(
    settingsResult.settings
  );

  return NextResponse.json({
    storeName: branding.storeName,
    storeLogoUrl: branding.storeLogoUrl,
    isPasscodeGated,
  });
}
