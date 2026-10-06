import "server-only";
import { createClient } from "@supabase/supabase-js";
import { hasServiceRole } from "@/lib/env";
import { SERVER_FETCH_TIMEOUT_MS, fetchWithTimeout } from "@/lib/supabase/timeouts";

/**
 * Service-role client. Bypasses RLS — server-only, never expose, never log
 * the key. Returns null when SUPABASE_SERVICE_ROLE_KEY is not configured.
 *
 * Gives up after SERVER_FETCH_TIMEOUT_MS like every server client (PROMPT-40).
 * The sign-in and registration actions reach the attempt counter through it
 * and already fail open when it cannot answer; with the timeout, "cannot
 * answer" now arrives in seconds.
 */
export function createSupabaseAdminClient() {
  if (!hasServiceRole()) return null;
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { fetch: fetchWithTimeout({ timeoutMs: SERVER_FETCH_TIMEOUT_MS }) },
    },
  );
}
