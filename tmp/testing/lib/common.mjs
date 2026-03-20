import fs from "node:fs/promises";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

export const DEFAULT_LOCAL_BASE_URL = "http://127.0.0.1:4201";
export const DEFAULT_PRODUCTION_BASE_URL = "https://rug-concierge.vercel.app";

export function nowIso() {
  return new Date().toISOString();
}

export function nowTag() {
  return nowIso().replaceAll(":", "-").replaceAll(".", "-");
}

export function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

export async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

export async function loadEnvLocal() {
  const envPath = path.resolve("apps/web/.env.local");
  const raw = await fs.readFile(envPath, "utf8");
  const out = {};

  for (const rawLine of raw.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const index = line.indexOf("=");
    if (index <= 0) continue;

    const key = line.slice(0, index).trim();
    let value = line.slice(index + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }

  return out;
}

export function resolveBaseUrl(input) {
  if (typeof input === "string" && input.trim()) return input.trim();
  return DEFAULT_LOCAL_BASE_URL;
}

export function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createSupabaseAdminFromEnv(env) {
  const supabaseUrl = String(env.SUPABASE_URL ?? "").trim();
  const supabaseSecret = String(
    env.SUPABASE_SECRET_KEY ?? env.SUPABASE_SERVICE_ROLE_KEY ?? ""
  ).trim();
  assert(supabaseUrl, "SUPABASE_URL missing in apps/web/.env.local");
  assert(
    supabaseSecret,
    "SUPABASE_SECRET_KEY (or SUPABASE_SERVICE_ROLE_KEY) missing in apps/web/.env.local"
  );

  return createClient(supabaseUrl, supabaseSecret, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export async function writeReport(reportFilePath, payload) {
  await ensureDir(path.dirname(reportFilePath));
  await fs.writeFile(reportFilePath, JSON.stringify(payload, null, 2), "utf8");
}

function parseRetryAfterSeconds(response, payload) {
  const retryHeader = response.headers.get("retry-after");
  const retryFromHeader = Number.parseInt(retryHeader ?? "", 10);
  if (Number.isFinite(retryFromHeader) && retryFromHeader > 0) {
    return retryFromHeader;
  }

  const retryFromBody = Number.parseInt(
    String(payload?.retry_after_seconds ?? ""),
    10
  );
  if (Number.isFinite(retryFromBody) && retryFromBody > 0) {
    return retryFromBody;
  }
  return 5;
}

export async function unlockStaffSession(input) {
  const maxAttempts = Math.max(
    1,
    Number.parseInt(String(input.maxAttempts ?? "4"), 10)
  );
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const headers = {
      "content-type": "application/json",
    };
    if (input.forwardedFor) {
      headers["x-forwarded-for"] = input.forwardedFor;
    }
    const response = await fetch(`${input.baseUrl}/api/auth/passcode`, {
      method: "POST",
      headers,
      body: JSON.stringify({ passcode: input.passcode }),
    });
    const payload = await response.json().catch(() => null);

    if (response.ok) {
      const setCookie = response.headers.get("set-cookie");
      assert(setCookie, "Passcode unlock did not return set-cookie header");
      return setCookie.split(";")[0];
    }

    if (response.status === 429 && attempt < maxAttempts) {
      const retryAfterSeconds = parseRetryAfterSeconds(response, payload);
      await wait(Math.min(180, retryAfterSeconds) * 1000);
      continue;
    }

    throw new Error(`Passcode unlock failed (${response.status}) at ${input.baseUrl}`);
  }

  throw new Error(`Passcode unlock failed after ${maxAttempts} attempts at ${input.baseUrl}`);
}

export async function triggerWorker(input) {
  const response = await fetch(`${input.baseUrl}/api/inventory/enrichment/worker`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${input.cronSecret}`,
    },
  });

  return {
    status: response.status,
    ok: response.ok,
    json: await response.json().catch(() => null),
  };
}

export function parseArgs(argv) {
  const out = {};
  for (const arg of argv) {
    if (!arg.startsWith("--")) continue;
    const index = arg.indexOf("=");
    if (index > 2) {
      out[arg.slice(2, index)] = arg.slice(index + 1);
    } else {
      out[arg.slice(2)] = "1";
    }
  }
  return out;
}

export function toSlug(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}
