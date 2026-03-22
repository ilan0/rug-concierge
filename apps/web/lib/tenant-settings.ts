import { getConfiguredTenantId } from "@/lib/auth/tenant";
import { supabaseAdmin } from "@/lib/supabase/admin";

const TENANT_SETTINGS_CACHE_TTL_MS = 60_000;

type TenantSettingsLookupFailureCode =
  | "tenant_not_configured"
  | "tenant_not_found"
  | "query_failed";

type TenantSettingsLookupSuccess = {
  ok: true;
  tenantId: string;
  settings: unknown;
};

type TenantSettingsLookupFailure = {
  ok: false;
  code: TenantSettingsLookupFailureCode;
  tenantId: string | null;
  message: string;
};

export type TenantSettingsLookupResult =
  | TenantSettingsLookupSuccess
  | TenantSettingsLookupFailure;

type CachedTenantSettings = {
  expiresAtMs: number;
  result: TenantSettingsLookupResult;
};

type TenantPublicSettingsShape = {
  passcode_enabled?: unknown;
  is_passcode_gated?: unknown;
  auth?: {
    passcode_enabled?: unknown;
    is_passcode_gated?: unknown;
  };
};

const tenantSettingsCache = new Map<string, CachedTenantSettings>();
const tenantSettingsInFlight = new Map<string, Promise<TenantSettingsLookupResult>>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readBooleanLike(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === "true" || normalized === "1") return true;
  if (normalized === "false" || normalized === "0") return false;
  return null;
}

export function readTenantPasscodeGatedFromSettings(
  settings: unknown
): boolean {
  if (!isRecord(settings)) {
    // Fail-safe default: keep staff lock enabled unless explicitly disabled.
    return true;
  }

  const typedSettings = settings as TenantPublicSettingsShape;
  const authSettings = isRecord(typedSettings.auth)
    ? typedSettings.auth
    : undefined;

  const candidates: unknown[] = [
    authSettings?.passcode_enabled,
    authSettings?.is_passcode_gated,
    typedSettings.passcode_enabled,
    typedSettings.is_passcode_gated,
  ];
  for (const candidate of candidates) {
    const parsed = readBooleanLike(candidate);
    if (parsed !== null) return parsed;
  }

  return true;
}

export async function getTenantSettingsById(
  tenantId: string
): Promise<TenantSettingsLookupResult> {
  const now = Date.now();
  const cached = tenantSettingsCache.get(tenantId);
  if (cached && cached.expiresAtMs > now) {
    return cached.result;
  }

  const pending = tenantSettingsInFlight.get(tenantId);
  if (pending) {
    return pending;
  }

  const loadPromise = (async (): Promise<TenantSettingsLookupResult> => {
    const query = await supabaseAdmin
      .from("tenants")
      .select("settings")
      .eq("id", tenantId)
      .maybeSingle();

    if (query.error) {
      return {
        ok: false,
        code: "query_failed",
        tenantId,
        message: `Unable to load settings for tenant "${tenantId}".`,
      };
    }

    if (!query.data) {
      const result: TenantSettingsLookupFailure = {
        ok: false,
        code: "tenant_not_found",
        tenantId,
        message: `Configured tenant "${tenantId}" was not found.`,
      };
      tenantSettingsCache.set(tenantId, {
        expiresAtMs: Date.now() + TENANT_SETTINGS_CACHE_TTL_MS,
        result,
      });
      return result;
    }

    const result: TenantSettingsLookupSuccess = {
      ok: true,
      tenantId,
      settings: query.data.settings,
    };
    tenantSettingsCache.set(tenantId, {
      expiresAtMs: Date.now() + TENANT_SETTINGS_CACHE_TTL_MS,
      result,
    });
    return result;
  })();

  tenantSettingsInFlight.set(tenantId, loadPromise);

  try {
    return await loadPromise;
  } finally {
    tenantSettingsInFlight.delete(tenantId);
  }
}

export async function getConfiguredTenantSettings(): Promise<TenantSettingsLookupResult> {
  const tenantId = getConfiguredTenantId();
  if (!tenantId) {
    return {
      ok: false,
      code: "tenant_not_configured",
      tenantId: null,
      message: "TENANT_ID is not configured.",
    };
  }

  return getTenantSettingsById(tenantId);
}
