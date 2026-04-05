import { NextResponse } from "next/server";
import {
  formatStoreNameFromSubdomain,
  readTenantBrandingFromSettings,
} from "@/lib/branding/tenant-branding";
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
  const derivedStoreName =
    formatStoreNameFromSubdomain(tenantResolution.subdomain) ??
    tenantResolution.subdomain;

  return NextResponse.json({
    storeName: branding.storeName ?? derivedStoreName,
    storeLogoUrl: branding.storeLogoUrl ?? null,
    isPasscodeGated,
  });
}
