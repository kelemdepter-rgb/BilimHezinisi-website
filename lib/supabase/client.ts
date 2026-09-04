import { createBrowserClient } from "@supabase/ssr";

/**
 * Browser Supabase client (anon key + the signed-in session).
 *
 * Book text and files are written straight from the browser to Supabase so
 * they never pass through a Vercel function — those cap request bodies at
 * 4.5 MB and time out quickly (CLAUDE.md). Safety does not depend on this
 * client: RLS decides what the session may write, enforced in Postgres.
 *
 * ONE instance for the whole tab, said out loud here rather than left to a
 * library default. @supabase/ssr's createBrowserClient already returns a
 * cached client in a browser — but only because `isSingleton` defaults from
 * its own `isBrowser()` check, which is not a promise this file should rest
 * on. Memoising here makes it unconditional, and matches
 * lib/supabase/public-client.ts, which has to memoise because plain
 * createClient does not.
 *
 * Sharing one is safe because auth-js re-reads the session from storage on
 * every call (`__loadSession`), and here storage is the auth cookie: signing
 * in or out anywhere is seen immediately, exactly as a freshly built client
 * would see it.
 *
 * The console's «Multiple GoTrueClient instances» warning was never about
 * this — measured 2026-09-04, it counted THIS client and the public one under
 * one default storage key. public-client.ts names its own key now; the two
 * clients stay separate, and must.
 */
let client: ReturnType<typeof createBrowserClient> | null = null;

export function createSupabaseBrowserClient() {
  if (client) return client;
  client = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
  return client;
}

/**
 * The signed-in reader's id, without asking the network who they are.
 *
 * `auth.getUser()` is a GET /auth/v1/user round trip whenever a session
 * exists, and the reader made one before each of the reading position, recent
 * reads and annotations — before any of them had written a row. Measured on
 * 2026-09-04, opening one book cost four of them: 380, 455, 222 and 303 ms.
 * `getSession()` answers from the session cookie instead, and goes to the
 * network only when the token has actually expired and has to be refreshed.
 * For a reader with no session at all both are free: auth-js returns without a
 * request either way, which is why a signed-out reader never paid this.
 *
 * THIS IS NOT A SECURITY CHECK AND MUST NEVER BECOME ONE. Every table these
 * ids are written to carries owner-only RLS — `user_id = (select auth.uid())`,
 * with the same expression in `with check` (migrations 0001 and 0007) — and
 * auth.uid() is taken from the JWT the request carries, never from this value.
 * A wrong id here cannot read or write anybody else's row; Postgres refuses
 * it. What this decides is only whether a request is worth making at all.
 */
export async function currentUserId(): Promise<string | null> {
  const supabase = createSupabaseBrowserClient();
  const { data } = await supabase.auth.getSession();
  return data.session?.user?.id ?? null;
}
