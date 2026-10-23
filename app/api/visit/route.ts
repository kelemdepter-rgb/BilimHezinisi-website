import { VISIT_BEACON_RULE, callerKey, isRateLimited } from "@/lib/rate-limit";
import { countedDeviceCountry } from "@/lib/visits/count";
import { recordDevice } from "@/lib/visits/record";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** One batched RPC at most, bounded by its own 10 s timeout (lib/supabase/timeouts.ts). */
export const maxDuration = 30;

/**
 * «This device came today» (components/visit-beacon.tsx, lib/visits/beacon.ts).
 *
 * Adds one to the country's daily device count and keeps nothing else: no
 * address, cookie, agent or body is stored or logged. The address is used
 * only in memory, by the per-instance burst brake, and is gone with the
 * instance. Always answers 204 with no body — a refused or uncounted signal
 * looks exactly like a counted one, so there is nothing to learn by probing.
 */
export async function POST(request: Request) {
  const country = countedDeviceCountry({
    method: request.method,
    headers: request.headers,
    environment: process.env.VERCEL_ENV,
  });
  if (country && !isRateLimited(`visit:${await callerKey()}`, VISIT_BEACON_RULE)) {
    const sent = recordDevice(country);
    if (sent) await sent;
  }
  return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
}
