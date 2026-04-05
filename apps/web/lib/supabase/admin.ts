import { createClient } from "@supabase/supabase-js";

function readTrimmedEnv(name: string): string | null {
  const raw = process.env[name];
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function requireSupabaseEnv(name: "SUPABASE_URL" | "SUPABASE_SECRET_KEY"): string {
  const value = readTrimmedEnv(name);
  if (!value) {
    throw new Error(
      `[config] Invalid apps/web runtime configuration:\n- Missing required environment variable: ${name}`
    );
  }
  return value;
}

const SUPABASE_URL = requireSupabaseEnv("SUPABASE_URL");
const SUPABASE_SECRET_KEY = requireSupabaseEnv("SUPABASE_SECRET_KEY");

export const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, {
  auth: { persistSession: false },
});
