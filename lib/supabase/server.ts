import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { hasSupabaseEnv } from "@/lib/env";
import { SERVER_FETCH_TIMEOUT_MS, fetchWithTimeout } from "@/lib/supabase/timeouts";

/**
 * Server-side Supabase client bound to the request cookies (anon key only —
 * RLS applies). Returns null when the project env vars are not configured.
 *
 * Every request it makes gives up after SERVER_FETCH_TIMEOUT_MS (PROMPT-40):
 * a stalled Supabase must cost a page seconds, never Vercel's 300.
 */
export async function createSupabaseServerClient() {
  if (!hasSupabaseEnv()) return null;
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: { fetch: fetchWithTimeout({ timeoutMs: SERVER_FETCH_TIMEOUT_MS }) },
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Called from a Server Component — the proxy session refresh
            // handles cookie writes in that case.
          }
        },
      },
    },
  );
}
