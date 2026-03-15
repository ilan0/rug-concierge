import { getConfiguredTenantId } from "@/lib/auth/tenant";

const DEFAULT_STORE_NAME = "Rug Concierge";
const BRANDING_CACHE_TTL_MS = 60_000;

type BrandingSource = "tenant" | "env" | "default";

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

type TenantBrandingValue = {
  storeName: string | null;
  storeLogoUrl: string | null;
};

type CachedTenantBranding = {
  expiresAtMs: number;
  value: TenantBrandingValue;
};

const tenantBrandingCache = new Map<string, CachedTenantBranding>();

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

function readEnvFallbackBranding(): TenantBrandingValue {
  return {
    storeName: readTrimmedString(process.env.STORE_NAME),
    storeLogoUrl: isSafePublicImageUrl(readTrimmedString(process.env.STORE_LOGO_URL)),
  };
}

async function fetchTenantBranding(tenantId: string): Promise<TenantBrandingValue> {
  const now = Date.now();
  const cached = tenantBrandingCache.get(tenantId);
  if (cached && cached.expiresAtMs > now) {
    return cached.value;
  }

  const { supabaseAdmin } = await import("@/lib/supabase/admin");

  const query = await supabaseAdmin
    .from("tenants")
    .select("settings")
    .eq("id", tenantId)
    .maybeSingle();

  if (query.error || !query.data) {
    const emptyValue = { storeName: null, storeLogoUrl: null };
    tenantBrandingCache.set(tenantId, {
      expiresAtMs: now + BRANDING_CACHE_TTL_MS,
      value: emptyValue,
    });
    return emptyValue;
  }

  const value = readTenantBrandingFromSettings(query.data.settings);
  tenantBrandingCache.set(tenantId, {
    expiresAtMs: now + BRANDING_CACHE_TTL_MS,
    value,
  });
  return value;
}

export async function getResolvedBranding(): Promise<ResolvedBranding> {
  const tenantId = getConfiguredTenantId();
  const envFallback = readEnvFallbackBranding();

  let tenantBranding: TenantBrandingValue = {
    storeName: null,
    storeLogoUrl: null,
  };

  if (tenantId) {
    tenantBranding = await fetchTenantBranding(tenantId);
  }

  const storeName =
    tenantBranding.storeName ?? envFallback.storeName ?? DEFAULT_STORE_NAME;
  const storeLogoUrl =
    tenantBranding.storeLogoUrl ?? envFallback.storeLogoUrl ?? null;

  const source: BrandingSource =
    tenantBranding.storeName || tenantBranding.storeLogoUrl
      ? "tenant"
      : envFallback.storeName || envFallback.storeLogoUrl
        ? "env"
        : "default";

  return {
    tenantId,
    storeName,
    storeLogoUrl,
    source,
  };
}
