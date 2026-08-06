import { createBrowserClient } from "@supabase/ssr";

/**
 * Browser Supabase client (anon key + the signed-in session).
 *
 * Book text and files are written straight from the browser to Supabase so
 * they never pass through a Vercel function — those cap request bodies at
 * 4.5 MB and time out quickly (CLAUDE.md). Safety does not depend on this
 * client: RLS decides what the session may write, enforced in Postgres.
 */
export function createSupabaseBrowserClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
