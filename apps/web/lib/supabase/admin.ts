import { createClient } from "@supabase/supabase-js";
import { SUPABASE_SECRET_KEY, SUPABASE_URL } from "@/lib/config";

// Flow overview
// Read server env vars
// Create Supabase admin client (secret key)
// Use for server-side queries

export const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, {
  auth: { persistSession: false },
});
