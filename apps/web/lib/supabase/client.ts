import { createClient } from "@supabase/supabase-js";

// PSEUDOCODE
// Read public env vars
// Create Supabase browser client (publishable key)
// Use for client-side queries if needed

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabasePublishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

if (!supabaseUrl || !supabasePublishableKey) {
  throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
}

export const supabaseClient = createClient(supabaseUrl, supabasePublishableKey);
