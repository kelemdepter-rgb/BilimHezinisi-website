import "server-only";
import { reportServerError } from "@/lib/server-log";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createVisitBatcher, type VisitBatch } from "./count";

/**
 * Sends the tally to the database — app/api/visit's half of «which countries
 * is the library opened from» (migrations 0033 and 0034). Service role: the
 * table and its functions are closed to every other role.
 *
 * Batched per server instance (lib/visits/count.ts), so a busy minute is a
 * few calls. A failure changes nothing a reader sees: the count is simply not
 * kept. Without the migrations the call is refused; that is logged once per
 * instance, by its error code only — never a header, a key or a body.
 */

let reported = false;

async function sendBatch(rpc: "country_visits_add" | "country_devices_add", batch: VisitBatch): Promise<void> {
  const countries = Object.keys(batch);
  if (countries.length === 0) return;
  const admin = createSupabaseAdminClient();
  if (!admin) return;
  const { error } = await admin.rpc(rpc, {
    p_countries: countries,
    p_counts: countries.map((country) => batch[country]),
  });
  if (error && !reported) {
    reported = true;
    reportServerError(`visits.record ${rpc} (are migrations 0033 and 0034 applied?)`, error);
  }
}

const openings = createVisitBatcher({ send: (batch) => sendBatch("country_visits_add", batch) });
const devices = createVisitBatcher({ send: (batch) => sendBatch("country_devices_add", batch) });

/** Count one page opening from `country`. Returns the send to wait for, if this one triggered it. */
export function recordVisit(country: string): Promise<void> | null {
  return openings.add(country);
}

/** Count one device's first page load of the day from `country`. */
export function recordDevice(country: string): Promise<void> | null {
  return devices.add(country);
}
