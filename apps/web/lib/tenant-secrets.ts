import { getConfiguredTenantId } from "@/lib/auth/tenant";
import { supabaseAdmin } from "@/lib/supabase/admin";

const TENANT_SECRETS_CACHE_TTL_MS = 60_000;

type TenantSecretsLookupFailureCode =
  | "tenant_not_configured"
  | "tenant_not_found"
  | "query_failed";

type TenantSecretsLookupSuccess = {
  ok: true;
  tenantId: string;
  secrets: unknown;
};

type TenantSecretsLookupFailure = {
  ok: false;
  code: TenantSecretsLookupFailureCode;
  tenantId: string | null;
  message: string;
};

export type TenantSecretsLookupResult =
  | TenantSecretsLookupSuccess
  | TenantSecretsLookupFailure;

type CachedTenantSecrets = {
  expiresAtMs: number;
  result: TenantSecretsLookupResult;
};

type TenantSecretsShape = {
  store_passcode?: unknown;
  cookie_secret?: unknown;
  cron_secret?: unknown;
  auth?: {
    store_passcode?: unknown;
    cookie_secret?: unknown;
    cron_secret?: unknown;
  };
};

export type TenantRuntimeSecrets = {
  storePasscode: string | null;
  cookieSecret: string | null;
  cronSecret: string | null;
};

const tenantSecretsCache = new Map<string, CachedTenantSecrets>();
const tenantSecretsInFlight = new Map<string, Promise<TenantSecretsLookupResult>>();

function readTrimmedString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function readTenantRuntimeSecrets(
  secrets: unknown
): TenantRuntimeSecrets {
  if (!isRecord(secrets)) {
    return {
      storePasscode: null,
      cookieSecret: null,
      cronSecret: null,
    };
  }

  const typedSecrets = secrets as TenantSecretsShape;
  const authSecrets = isRecord(typedSecrets.auth)
    ? typedSecrets.auth
    : undefined;

  return {
    storePasscode: readTrimmedString(
      authSecrets?.store_passcode ?? typedSecrets.store_passcode
    ),
    cookieSecret: readTrimmedString(
      authSecrets?.cookie_secret ?? typedSecrets.cookie_secret
    ),
    cronSecret: readTrimmedString(
      authSecrets?.cron_secret ?? typedSecrets.cron_secret
    ),
  };
}

export async function getTenantSecretsById(
  tenantId: string
): Promise<TenantSecretsLookupResult> {
  const now = Date.now();
  const cached = tenantSecretsCache.get(tenantId);
  if (cached && cached.expiresAtMs > now) {
    return cached.result;
  }

  const pending = tenantSecretsInFlight.get(tenantId);
  if (pending) {
    return pending;
  }

  const loadPromise = (async (): Promise<TenantSecretsLookupResult> => {
    const query = await supabaseAdmin
      .from("tenants")
      .select("secrets")
      .eq("id", tenantId)
      .maybeSingle();

    if (query.error) {
      return {
        ok: false,
        code: "query_failed",
        tenantId,
        message: `Unable to load secrets for tenant "${tenantId}".`,
      };
    }

    if (!query.data) {
      const result: TenantSecretsLookupFailure = {
        ok: false,
        code: "tenant_not_found",
        tenantId,
        message: `Configured tenant "${tenantId}" was not found.`,
      };
      tenantSecretsCache.set(tenantId, {
        expiresAtMs: Date.now() + TENANT_SECRETS_CACHE_TTL_MS,
        result,
      });
      return result;
    }

    const result: TenantSecretsLookupSuccess = {
      ok: true,
      tenantId,
      secrets: query.data.secrets,
    };
    tenantSecretsCache.set(tenantId, {
      expiresAtMs: Date.now() + TENANT_SECRETS_CACHE_TTL_MS,
      result,
    });
    return result;
  })();

  tenantSecretsInFlight.set(tenantId, loadPromise);

  try {
    return await loadPromise;
  } finally {
    tenantSecretsInFlight.delete(tenantId);
  }
}

export async function getConfiguredTenantRuntimeSecrets(): Promise<
  | { ok: true; tenantId: string; secrets: TenantRuntimeSecrets }
  | TenantSecretsLookupFailure
> {
  const tenantId = getConfiguredTenantId();
  if (!tenantId) {
    return {
      ok: false,
      code: "tenant_not_configured",
      tenantId: null,
      message: "TENANT_ID is not configured.",
    };
  }

  const secretsResult = await getTenantSecretsById(tenantId);
  if (!secretsResult.ok) {
    return secretsResult;
  }

  return {
    ok: true,
    tenantId: secretsResult.tenantId,
    secrets: readTenantRuntimeSecrets(secretsResult.secrets),
  };
}
