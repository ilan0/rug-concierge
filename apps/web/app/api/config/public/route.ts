import { NextResponse } from "next/server";
import { readTenantBrandingFromSettings } from "@/lib/branding/tenant-branding";
import { DEFAULT_STORE_NAME } from "@/lib/config";
import {
  getTenantSettingsById,
  readTenantPasscodeGatedFromSettings,
} from "@/lib/tenant-settings";
import { resolveTenantFromRequest } from "@/lib/tenant/resolve-tenant";

export async function GET(req: Request) {
  const tenantResolution = await resolveTenantFromRequest(req);
  if (!tenantResolution.ok) {
    return NextResponse.json(
      { error: tenantResolution.message },
      { status: tenantResolution.status }
    );
  }

  const settingsResult = await getTenantSettingsById(tenantResolution.tenantId);

  if (!settingsResult.ok) {
    return NextResponse.json({ error: settingsResult.message }, { status: 503 });
  }

  const branding = readTenantBrandingFromSettings(settingsResult.settings);
  const isPasscodeGated = readTenantPasscodeGatedFromSettings(
    settingsResult.settings
  );

  return NextResponse.json({
    storeName: branding.storeName ?? DEFAULT_STORE_NAME,
    storeLogoUrl: branding.storeLogoUrl ?? null,
    isPasscodeGated,
  });
}
