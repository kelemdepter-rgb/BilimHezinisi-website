import "server-only";
import { reportServerError } from "@/lib/server-log";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { parseCountryVisitReport, type CountryVisitReport } from "./report";

/**
 * How long the tally is kept. The privacy page tells readers "a year", and
 * the sweep below (daily, from /api/health) is what makes that true.
 */
export const VISIT_KEEP_DAYS = 366;

/**
 * The tally for /admin. Service role, because the table is closed to every
 * other role; the caller (app/admin/page.tsx) has already verified the admin.
 * Unreachable, or migration 0033 not yet applied → `{ available: false }`.
 */
export async function getCountryVisitReport(): Promise<CountryVisitReport> {
  const admin = createSupabaseAdminClient();
  if (!admin) return { available: false };
  const { data, error } = await admin.rpc("country_visit_stats");
  if (error) {
    reportServerError("visits.report", error);
    return { available: false };
  }
  return parseCountryVisitReport(data);
}

/** Forget days past the keep window — run by the daily cron. Null when it could not. */
export async function sweepCountryVisits(): Promise<number | null> {
  const admin = createSupabaseAdminClient();
  if (!admin) return null;
  const { data, error } = await admin.rpc("country_visits_sweep", { p_keep_days: VISIT_KEEP_DAYS });
  if (error) {
    reportServerError("visits.sweep", error);
    return null;
  }
  return typeof data === "number" ? data : null;
}
