import { hasServiceRole } from "@/lib/env";
import { SERVER_FETCH_TIMEOUT_MS, fetchWithTimeout } from "@/lib/supabase/timeouts";
import { createVisitBatcher, type VisitBatch } from "./count";

/**
 * Sends the tally of page openings to the database — proxy.ts's half of
 * «which countries is the library opened from» (migration 0033).
 *
 * Deliberately NOT lib/supabase/admin.ts: that module is `server-only`, a
 * guard the proxy bundle is not known to honour, and this file needs the
 * service-role key for exactly one RPC. It reads the key from the same
 * environment, is imported by nothing but proxy.ts, goes through the same
 * `fetchWithTimeout` as every Supabase client (PROMPT-40), and never logs a
 * header, a key or a body.
 *
 * It runs inside `event.waitUntil`, after the response has gone: the reader
 * never waits for it, and a failure here changes nothing they see. Without
 * the 0033 migration the call is refused; that is logged once per server
 * instance, by status only, and the counts are simply not kept.
 */

const timedFetch = fetchWithTimeout({ timeoutMs: SERVER_FETCH_TIMEOUT_MS });

let reported = false;

async function sendBatch(batch: VisitBatch): Promise<void> {
  if (!hasServiceRole()) return;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const countries = Object.keys(batch);
  if (countries.length === 0) return;

  const response = await timedFetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/rpc/country_visits_add`, {
    method: "POST",
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ p_countries: countries, p_counts: countries.map((country) => batch[country]) }),
    cache: "no-store",
  });
  await response.arrayBuffer().catch(() => undefined);
  if (!response.ok && !reported) {
    reported = true;
    console.error(`[bh] visits.record — the tally was refused (HTTP ${response.status}); is migration 0033 applied?`);
  }
}

const batcher = createVisitBatcher({ send: sendBatch });

/** Count one page opening from `country`. Returns the send to hand to `waitUntil`, if any. */
export function recordVisit(country: string): Promise<void> | null {
  return batcher.add(country);
}
