import "server-only";
import { createClient } from "@supabase/supabase-js";
import { hasServiceRole } from "@/lib/env";

/**
 * Service-role client. Bypasses RLS — server-only, never expose, never log
 * the key. Returns null when SUPABASE_SERVICE_ROLE_KEY is not configured.
 */
export function createSupabaseAdminClient() {
  if (!hasServiceRole()) return null;
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}
