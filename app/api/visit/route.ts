import { VISIT_DEVICE_RULE, VISIT_OPENING_RULE, callerKey, isRateLimited } from "@/lib/rate-limit";
import { countedSignalCountry, isFirstOfDay } from "@/lib/visits/count";
import { recordDevice, recordVisit } from "@/lib/visits/record";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** At most two batched RPCs, each bounded by its own 10 s timeout (lib/supabase/timeouts.ts). */
export const maxDuration = 30;

/**
 * One page load of the library (components/visit-beacon.tsx,
 * lib/visits/beacon.ts): one more page opening for the country, and — when
 * the signal says it is the browser's first page of the UTC day (`?d=1`) —
 * one more device.
 *
 * Keeps nothing else: no address, cookie, agent or body is stored or logged.
 * The address is used only in memory, by the per-instance burst brakes, and
 * is gone with the instance. Always answers 204 with no body — a refused or
 * uncounted signal looks exactly like a counted one, so there is nothing to
 * learn by probing.
 */
export async function POST(request: Request) {
  const country = countedSignalCountry({
    method: request.method,
    headers: request.headers,
    environment: process.env.VERCEL_ENV,
    url: request.url,
  });
  if (country) {
    const key = await callerKey();
    if (!isRateLimited(`visit:${key}`, VISIT_OPENING_RULE)) {
      const sends = [recordVisit(country)];
      if (isFirstOfDay(request.url) && !isRateLimited(`visit-device:${key}`, VISIT_DEVICE_RULE)) {
        sends.push(recordDevice(country));
      }
      await Promise.all(sends);
    }
  }
  return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
}
