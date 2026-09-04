import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * A browser Supabase client that carries the public anon key and nothing else.
 *
 * Published book text is the same for everybody, so reading it does not need
 * — and should not carry — the reader's own token. Two things follow from
 * that, and both are the point of this file:
 *
 *   1. The response is identical for every visitor, which is what makes it
 *      safe for the service worker to store and replay. A response fetched
 *      with a signed-in token could contain rows RLS hides from others (an
 *      editor previewing a draft), so public/sw.js refuses to cache anything
 *      whose Authorization header is not simply the anon key. This client is
 *      how a request qualifies.
 *   2. Less of the reader's identity travels with an ordinary page turn.
 *
 * Drafts still go through the session client — staff previewing unpublished
 * work genuinely do need their token, and that work must never be cached.
 *
 * `persistSession: false` matters: without it this client would adopt the
 * session out of storage and defeat the whole arrangement.
 *
 * `storageKey` matters for a smaller reason, and changes nothing about the
 * above. Every Supabase client builds a GoTrueClient, and auth-js counts them
 * per storage key — so this one and the session client in
 * lib/supabase/client.ts, being two clients under one default key, made it
 * warn «Multiple GoTrueClient instances detected in the same browser context»
 * on every page that used both. Here that warning is a false alarm: it is
 * about two clients writing one session, and this client has none to write.
 * Naming its own key says so, and the console stays clean for warnings that
 * mean something. It does NOT make the two clients one — that would break
 * everything the note above is about.
 */
let client: SupabaseClient | null = null;

export function createSupabasePublicClient(): SupabaseClient {
  if (client) return client;
  client = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
        storageKey: "bh-public-no-session",
      },
    },
  );
  return client;
}
