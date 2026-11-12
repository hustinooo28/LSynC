import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// From Supabase: Project Settings > API (copy .env.example to .env).
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

let client: SupabaseClient | null = null;

/** Lazily created client, so importing services never crashes an unconfigured app. */
export function getSupabase(): SupabaseClient {
  if (!supabaseUrl || !supabaseKey) {
    throw new Error(
      "Supabase is not configured. Copy .env.example to .env and add your Supabase project URL " +
        "and publishable key. See SUPABASE_INTEGRATION.md for details.",
    );
  }
  client ??= createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });
  return client;
}
