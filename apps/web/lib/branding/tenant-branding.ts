import { getTenantSettingsById } from "@/lib/tenant-settings";
import { resolveTenantFromServerHeaders } from "@/lib/tenant/resolve-tenant";

type BrandingSource = "tenant" | "derived_subdomain" | "fallback_default";

type TenantBrandingSettings = {
  store_name?: unknown;
  logo_mark_url?: unknown;
};

type TenantSettingsShape = {
  branding?: TenantBrandingSettings;
};

export type ResolvedBranding = {
  tenantId: string | null;
  storeName: string;
  storeLogoUrl: string | null;
  source: BrandingSource;
};

export const DEFAULT_STORE_NAME = "Rug Gallery Concierge";

type TenantBrandingValue = {
  storeName: string | null;
  storeLogoUrl: string | null;
};

function readTrimmedString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isSafePublicImageUrl(value: string | null): string | null {
  if (!value) return null;
  if (value.startsWith("/")) return value;
  try {
    const parsed = new URL(value);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return value;
    }
    return null;
  } catch {
    return null;
  }
}

export function formatStoreNameFromSubdomain(
  subdomain: string | null
): string | null {
  if (!subdomain) return null;
  const normalized = subdomain
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "")
    .replace(/^-+|-+$/g, "");
  if (!normalized) return null;
  return normalized
    .split("-")
    .filter((token) => token.length > 0)
    .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
    .join(" ");
}

export function readTenantBrandingFromSettings(settings: unknown): TenantBrandingValue {
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
    return { storeName: null, storeLogoUrl: null };
  }

  const typed = settings as TenantSettingsShape;
  const branding = typed.branding;
  if (!branding || typeof branding !== "object" || Array.isArray(branding)) {
    return { storeName: null, storeLogoUrl: null };
  }

  return {
    storeName: readTrimmedString(branding.store_name),
    storeLogoUrl: isSafePublicImageUrl(readTrimmedString(branding.logo_mark_url)),
  };
}

async function fetchTenantBranding(tenantId: string): Promise<TenantBrandingValue> {
  const settingsResult = await getTenantSettingsById(tenantId);
  if (!settingsResult.ok) {
    return { storeName: null, storeLogoUrl: null };
  }
  return readTenantBrandingFromSettings(settingsResult.settings);
}

export async function getResolvedBranding(input?: {
  tenantId?: string | null;
}): Promise<ResolvedBranding> {
  const explicitTenantId =
    typeof input?.tenantId === "string" && input.tenantId.trim().length > 0
      ? input.tenantId.trim()
      : null;
  const resolvedTenant =
    explicitTenantId !== null ? null : await resolveTenantFromServerHeaders();
  const tenantId = explicitTenantId ?? (resolvedTenant?.ok ? resolvedTenant.tenantId : null);

  let tenantBranding: TenantBrandingValue = {
    storeName: null,
    storeLogoUrl: null,
  };

  if (tenantId) {
    tenantBranding = await fetchTenantBranding(tenantId);
  }

  const derivedStoreNameFromSubdomain =
    resolvedTenant?.ok && tenantId && resolvedTenant.tenantId === tenantId
      ? formatStoreNameFromSubdomain(resolvedTenant.subdomain)
      : null;

  const storeName =
    tenantBranding.storeName ??
    derivedStoreNameFromSubdomain ??
    DEFAULT_STORE_NAME;
  const storeLogoUrl = tenantBranding.storeLogoUrl ?? null;

  const source: BrandingSource = tenantBranding.storeName || tenantBranding.storeLogoUrl
    ? "tenant"
    : derivedStoreNameFromSubdomain
      ? "derived_subdomain"
      : "fallback_default";

  return {
    tenantId,
    storeName,
    storeLogoUrl,
    source,
  };
}
