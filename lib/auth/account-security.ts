import "server-only";
import { cachedClient } from "@/lib/cache";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { BLOCKED_PROVIDER_DOMAINS, BLOCKED_TLDS } from "./blocked-email-domains";
import { DISPOSABLE_DOMAINS } from "./disposable-domains";

/**
 * The owner's controls over new accounts (PROMPT-39, parts D–F): the pause
 * switch, the report the /admin security card shows, and the daily sweep of
 * accounts never confirmed. The rules themselves — the hook and the automatic
 * brake — live in the database (migration 0027); this is the site's side.
 */

/** settings.registration_paused — public: /register reads it to hide its form. */
export const REGISTRATION_PAUSED_KEY = "registration_paused";
/** settings.unconfirmed_sweep_enabled — off until the owner switches it on. */
export const SWEEP_ENABLED_KEY = "unconfirmed_sweep_enabled";
/** settings.unconfirmed_sweep_last — what the last daily sweep did. */
export const SWEEP_LAST_KEY = "unconfirmed_sweep_last";

/** At most this many accounts a day, so the cron stays inside its 45 s. */
export const SWEEP_CAP = 200;
/** How many deletions run at once. */
const SWEEP_CONCURRENCY = 5;
/** Stop starting new deletions after this long; tomorrow's run takes the rest. */
const SWEEP_BUDGET_MS = 12_000;

/**
 * Whether new registrations are paused. Read as an anonymous visitor would,
 * uncached, so the switch takes effect on the next request. When the answer
 * cannot be read the form stays open: the hook, which reads the same row
 * inside the database, still refuses every sign-up while the pause is on.
 */
export async function isRegistrationPaused(): Promise<boolean> {
  const supabase = cachedClient();
  if (!supabase) return false;
  const { data, error } = await supabase
    .from("settings")
    .select("value")
    .eq("key", REGISTRATION_PAUSED_KEY)
    .maybeSingle();
  return !error && data?.value === true;
}

/** Write one of the switches above. Service role: callers verify the admin first. */
export async function writeSwitch(key: typeof REGISTRATION_PAUSED_KEY | typeof SWEEP_ENABLED_KEY, on: boolean) {
  const admin = createSupabaseAdminClient();
  if (!admin) throw new Error("not configured");
  const { error } = await admin
    .from("settings")
    .upsert({ key, value: on, is_public: key === REGISTRATION_PAUSED_KEY }, { onConflict: "key" });
  if (error) throw new Error(error.message);
}

export type AccountSecurityReport =
  | { available: false }
  | {
      available: true;
      registrationPaused: boolean;
      brakeEngaged: boolean;
      /** Unconfirmed accounts created in the last hour — what the brake counts. */
      brakeCount: number;
      brakeLimit: number;
      newLastHour: number;
      newLastDay: number;
      activeLocks: number;
      unconfirmed: number;
      /** Unconfirmed readers older than 7 days: what the sweep would delete. */
      sweepable: number;
      sweepEnabled: boolean;
      lastSweep: { at: string; deleted: number } | null;
      /** Whether the database holds the same lists the site uses. */
      listsInSync: boolean;
    };

type Stats = {
  new_last_hour: number;
  new_last_day: number;
  brake_count: number;
  brake_limit: number;
  unconfirmed: number;
  sweepable: number;
  active_locks: number;
  blocked_domains: number;
  disposable_domains: number;
};

const EXPECTED_BLOCKED = new Set([...BLOCKED_TLDS, ...BLOCKED_PROVIDER_DOMAINS]).size;

function adminEmail(): string | null {
  return process.env.ADMIN_EMAIL?.trim().toLowerCase() || null;
}

/**
 * Everything the security card shows, in one round trip for the numbers
 * (public.account_security_stats) and one for the switches. Unavailable until
 * migration 0027 is in.
 */
export async function getAccountSecurityReport(): Promise<AccountSecurityReport> {
  const admin = createSupabaseAdminClient();
  if (!admin) return { available: false };

  const [stats, settings] = await Promise.all([
    admin.rpc("account_security_stats", { p_admin_email: adminEmail() }),
    admin
      .from("settings")
      .select("key, value")
      .in("key", [REGISTRATION_PAUSED_KEY, SWEEP_ENABLED_KEY, SWEEP_LAST_KEY]),
  ]);
  if (stats.error || !stats.data) return { available: false };

  const numbers = stats.data as Stats;
  const values = new Map(
    ((settings.data as { key: string; value: unknown }[] | null) ?? []).map((row) => [row.key, row.value]),
  );
  const last = values.get(SWEEP_LAST_KEY) as { at?: unknown; deleted?: unknown } | undefined;

  return {
    available: true,
    registrationPaused: values.get(REGISTRATION_PAUSED_KEY) === true,
    brakeEngaged: numbers.brake_count >= numbers.brake_limit,
    brakeCount: numbers.brake_count,
    brakeLimit: numbers.brake_limit,
    newLastHour: numbers.new_last_hour,
    newLastDay: numbers.new_last_day,
    activeLocks: numbers.active_locks,
    unconfirmed: numbers.unconfirmed,
    sweepable: numbers.sweepable,
    sweepEnabled: values.get(SWEEP_ENABLED_KEY) === true,
    lastSweep:
      last && typeof last.at === "string" && typeof last.deleted === "number"
        ? { at: last.at, deleted: last.deleted }
        : null,
    listsInSync:
      numbers.blocked_domains === EXPECTED_BLOCKED && numbers.disposable_domains === DISPOSABLE_DOMAINS.length,
  };
}

/**
 * The daily sweep, run by /api/health: delete accounts that were never
 * confirmed, more than 7 days on — an ordinary reader's, never the admin's,
 * never an uploader's (public.unconfirmed_accounts_to_sweep decides who).
 * Such an account never signed in and owns nothing; deleting the auth user
 * cascades to its profile and every per-user table regardless.
 *
 * Off until the owner switches it on from /admin. Returns how many went, or
 * null when it did not run; only the count is ever logged.
 */
export async function sweepUnconfirmedAccounts(): Promise<number | null> {
  const admin = createSupabaseAdminClient();
  if (!admin) return null;

  const { data: switchRow } = await admin
    .from("settings")
    .select("value")
    .eq("key", SWEEP_ENABLED_KEY)
    .maybeSingle();
  if (switchRow?.value !== true) return null;

  const { data, error } = await admin.rpc("unconfirmed_accounts_to_sweep", {
    p_admin_email: adminEmail(),
    p_limit: SWEEP_CAP,
  });
  if (error) {
    console.error(`[auth] unconfirmed sweep could not list accounts: code=${error.code ?? "?"}`);
    return null;
  }

  const ids = ((data as string[] | null) ?? []).filter((id) => typeof id === "string");
  const started = Date.now();
  let deleted = 0;
  for (let index = 0; index < ids.length && Date.now() - started < SWEEP_BUDGET_MS; index += SWEEP_CONCURRENCY) {
    const results = await Promise.all(
      ids.slice(index, index + SWEEP_CONCURRENCY).map((id) => admin.auth.admin.deleteUser(id)),
    );
    deleted += results.filter((result) => !result.error).length;
  }

  await admin
    .from("settings")
    .upsert(
      { key: SWEEP_LAST_KEY, value: { at: new Date().toISOString(), deleted }, is_public: false },
      { onConflict: "key" },
    );
  console.log(`[auth] unconfirmed sweep deleted ${deleted} account(s)`);
  return deleted;
}
