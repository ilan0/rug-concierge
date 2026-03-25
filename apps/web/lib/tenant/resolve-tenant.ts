import { headers as readServerHeaders } from "next/headers";
import { supabaseAdmin } from "@/lib/supabase/admin";

const TENANT_CACHE_TTL_MS = 60_000;

type CachedTenant = {
  tenantId: string;
  expiresAtMs: number;
};

type RequestHeaderValues = {
  host: string | null;
  xForwardedHost: string | null;
};

type TenantLookupFailureCode =
  | "host_missing"
  | "host_invalid"
  | "subdomain_missing"
  | "tenant_not_found"
  | "tenant_query_failed";

export type TenantResolutionSuccess = {
  ok: true;
  tenantId: string;
  hostname: string;
  subdomain: string;
};

export type TenantResolutionFailure = {
  ok: false;
  status: 404 | 503;
  code: TenantLookupFailureCode;
  message: string;
  hostname: string | null;
  subdomain: string | null;
};

export type TenantResolutionResult =
  | TenantResolutionSuccess
  | TenantResolutionFailure;

const tenantCache = new Map<string, CachedTenant>();
const tenantLookupInFlight = new Map<string, Promise<TenantResolutionResult>>();

function readFirstHost(value: string | null): string | null {
  if (typeof value !== "string") return null;
  const first = value.split(",")[0]?.trim() ?? "";
  return first.length > 0 ? first : null;
}

function normalizeHostname(raw: string | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  let hostname = trimmed;
  if (/^https?:\/\//i.test(hostname)) {
    try {
      hostname = new URL(hostname).hostname;
    } catch {
      return null;
    }
  } else if (hostname.startsWith("[")) {
    const end = hostname.indexOf("]");
    if (end === -1) return null;
    hostname = hostname.slice(1, end);
  } else {
    const colonIndex = hostname.indexOf(":");
    if (colonIndex !== -1) {
      hostname = hostname.slice(0, colonIndex);
    }
  }

  const normalized = hostname.trim().toLowerCase().replace(/\.$/, "");
  if (!normalized) return null;
  return normalized;
}

function isIpAddress(hostname: string): boolean {
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname)) return true;
  return hostname.includes(":");
}

function isLocalHost(hostname: string): boolean {
  return hostname === "localhost" || isIpAddress(hostname);
}

export function parseSubdomainFromHostname(hostname: string): string | null {
  if (!hostname || isIpAddress(hostname) || hostname === "localhost") return null;

  const labels = hostname.split(".").filter((label) => label.length > 0);
  if (labels.length === 0) return null;

  if (hostname.endsWith(".localhost")) {
    if (labels.length < 2) return null;
    const localSubdomain = labels[0]?.trim().toLowerCase() ?? "";
    return /^[a-z0-9-]{1,63}$/.test(localSubdomain) ? localSubdomain : null;
  }

  if (labels.length < 3) {
    return null;
  }

  const subdomain = labels[0]?.trim().toLowerCase() ?? "";
  if (!/^[a-z0-9-]{1,63}$/.test(subdomain)) return null;
  return subdomain;
}

function resolveHostname(input: RequestHeaderValues): string | null {
  return (
    normalizeHostname(readFirstHost(input.xForwardedHost)) ??
    normalizeHostname(readFirstHost(input.host))
  );
}

async function lookupTenantBySubdomain(
  subdomain: string,
  hostname: string
): Promise<TenantResolutionResult> {
  const now = Date.now();
  const cached = tenantCache.get(subdomain);
  if (cached && cached.expiresAtMs > now) {
    return {
      ok: true,
      tenantId: cached.tenantId,
      hostname,
      subdomain,
    };
  }

  const pending = tenantLookupInFlight.get(subdomain);
  if (pending) return pending;

  const lookupPromise = (async (): Promise<TenantResolutionResult> => {
    const query = await supabaseAdmin
      .from("tenants")
      .select("id")
      .eq("id", subdomain)
      .maybeSingle();

    if (query.error) {
      return {
        ok: false,
        status: 503,
        code: "tenant_query_failed",
        message: "Unable to resolve store from hostname right now.",
        hostname,
        subdomain,
      };
    }

    if (!query.data?.id) {
      return {
        ok: false,
        status: 404,
        code: "tenant_not_found",
        message: "Store not found for this domain.",
        hostname,
        subdomain,
      };
    }

    const tenantId = String(query.data.id).trim();
    tenantCache.set(subdomain, {
      tenantId,
      expiresAtMs: Date.now() + TENANT_CACHE_TTL_MS,
    });

    return {
      ok: true,
      tenantId,
      hostname,
      subdomain,
    };
  })();

  tenantLookupInFlight.set(subdomain, lookupPromise);
  try {
    return await lookupPromise;
  } finally {
    tenantLookupInFlight.delete(subdomain);
  }
}

async function lookupLocalDefaultTenant(hostname: string): Promise<TenantResolutionResult> {
  const cacheKey = "__local_default_tenant__";
  const now = Date.now();
  const cached = tenantCache.get(cacheKey);
  if (cached && cached.expiresAtMs > now) {
    return {
      ok: true,
      tenantId: cached.tenantId,
      hostname,
      subdomain: cached.tenantId,
    };
  }

  const query = await supabaseAdmin
    .from("tenants")
    .select("id")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (query.error) {
    return {
      ok: false,
      status: 503,
      code: "tenant_query_failed",
      message: "Unable to resolve local tenant.",
      hostname,
      subdomain: null,
    };
  }

  const tenantId =
    query.data && typeof query.data.id === "string" ? query.data.id.trim() : "";
  if (!tenantId) {
    return {
      ok: false,
      status: 404,
      code: "tenant_not_found",
      message: "No tenants are configured.",
      hostname,
      subdomain: null,
    };
  }

  tenantCache.set(cacheKey, {
    tenantId,
    expiresAtMs: Date.now() + TENANT_CACHE_TTL_MS,
  });

  return {
    ok: true,
    tenantId,
    hostname,
    subdomain: tenantId,
  };
}

export async function resolveTenantFromHeaders(
  input: RequestHeaderValues
): Promise<TenantResolutionResult> {
  const hostname = resolveHostname(input);
  if (!hostname) {
    return {
      ok: false,
      status: 404,
      code: "host_missing",
      message: "Store domain is missing.",
      hostname: null,
      subdomain: null,
    };
  }

  const subdomain = parseSubdomainFromHostname(hostname);
  if (!subdomain) {
    if (isLocalHost(hostname)) {
      return lookupLocalDefaultTenant(hostname);
    }
    return {
      ok: false,
      status: 404,
      code: "subdomain_missing",
      message: "Store subdomain is missing or invalid.",
      hostname,
      subdomain: null,
    };
  }

  return lookupTenantBySubdomain(subdomain, hostname);
}

export async function resolveTenantFromRequest(
  req: Request
): Promise<TenantResolutionResult> {
  return resolveTenantFromHeaders({
    host: req.headers.get("host"),
    xForwardedHost: req.headers.get("x-forwarded-host"),
  });
}

export async function resolveTenantFromServerHeaders(): Promise<TenantResolutionResult> {
  const headerStore = await readServerHeaders();
  return resolveTenantFromHeaders({
    host: headerStore.get("host"),
    xForwardedHost: headerStore.get("x-forwarded-host"),
  });
}
