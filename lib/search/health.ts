import "server-only";
import { createClient } from "@supabase/supabase-js";
import { hasSupabaseEnv } from "@/lib/env";
import { isSearchBusy } from "@/lib/search/busy";
import { SERVER_FETCH_TIMEOUT_MS, fetchWithTimeout } from "@/lib/supabase/timeouts";

/**
 * The daily search self-check.
 *
 * On 2026-09-11 every whole-library search had been failing for every
 * anonymous visitor, and nothing said so: the timing script ran with the
 * service role, the parity corpus was four pages, and the owner applies
 * migrations by hand after the tests have run. So /api/health — already
 * called once a day by the only Vercel cron this site has — now also makes
 * four fixed calls AS AN ANONYMOUS VISITOR, with the anon key and no
 * session, and writes what happened under the `search_health` setting for
 * /admin to show. No new cron, no new vendor, no new table.
 *
 * The second word, «ئاللاھ», came with PROMPT-41: on 2026-10-05 it timed out
 * live for every reader while «ناماز» — the only word checked — answered in
 * 0.59 s, so the check had never seen the hard case.
 *
 * Only these fixed words ever go through it. What readers type is never
 * inspected or logged (PROMPT-29), and this file sends none of it.
 */

export const SEARCH_HEALTH_KEY = "search_health";

/** Answered, but slower than a reader should wait: shown as a warning. */
export const SEARCH_HEALTH_SLOW_MS = 1500;

/**
 * Past this a call is abandoned and counted as failed, so the route still
 * answers the cron whatever the database does. Well above every role's
 * statement timeout (3 s anon, 8 s authenticated), so a real 57014 arrives
 * as itself rather than as an abort.
 */
export const SEARCH_HEALTH_CALL_TIMEOUT_MS = 10_000;

/**
 * The word most books carry; the word that timed out on 2026-10-05 — on 3,613
 * of 19,596 pages, gathered in a few books, which is what made the planner
 * walk the library instead of reading the index (migration 0029); and the word
 * none does.
 */
const COMMON_WORD = "ناماز";
const HARD_WORD = "ئاللاھ";
const NOWHERE_WORD = "قققزززخخخ";

export const SEARCH_HEALTH_NAMES = ["common", "hard", "nowhere", "navigator"] as const;
export type SearchHealthName = (typeof SEARCH_HEALTH_NAMES)[number];

/** Checks added after records were first stored: an older record lacks them. */
type LaterCheck = "hard";

export type SearchHealthCheck = {
  ok: boolean;
  ms: number;
  /**
   * The Postgres SQLSTATE (e.g. 57014), "aborted" past the call timeout,
   * "busy" when every search slot was in use, or null when ok.
   */
  code: string | null;
  at: string;
  /**
   * Every search slot was in use (migration 0028) on the call AND on its one
   * retry. Its own state, not a failure: the database refused politely, which
   * is what it is meant to do while many people search. Absent on records
   * written before PROMPT-40, which read as false.
   */
  busy?: boolean;
};

/**
 * How long to wait before asking once more after a "busy". A slot is held
 * for one search — well under a second on most words, the 3 s statement
 * timeout at worst — so two seconds is usually enough for one to come free,
 * and short enough for the route's time budget (app/api/health/route.ts).
 */
export const SEARCH_HEALTH_BUSY_PAUSE_MS = 2_000;

/** What one run of the check writes: every call. */
export type FullSearchHealth = Record<SearchHealthName, SearchHealthCheck>;

/**
 * What a stored record holds: every call, except that a record written before
 * a check existed lacks it. /admin shows what is there rather than calling an
 * older record unreadable until the next daily run.
 */
export type SearchHealth = Omit<FullSearchHealth, LaterCheck> & Partial<Pick<FullSearchHealth, LaterCheck>>;

/** The checks a record holds, in the order they run. */
function checksOf(health: SearchHealth): [SearchHealthName, SearchHealthCheck][] {
  return SEARCH_HEALTH_NAMES.flatMap((name) => {
    const check = health[name];
    return check ? [[name, check] as [SearchHealthName, SearchHealthCheck]] : [];
  });
}

/**
 * What the check needs from the database, and nothing more — so a test can
 * stand in for it without a network, and the route cannot reach anything
 * else through it.
 */
export type SearchHealthClient = {
  /** The published book with the most pages, or null when there is none. */
  largestPublishedBook(): Promise<number | null>;
  /** One of the two RPCs; resolves with its error, or null when it answered. */
  call(
    fn: "search_books" | "book_match_pages",
    args: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<{ code?: string | null; message?: string | null } | null>;
};

/**
 * The anonymous visitor: the public key, no cookies, no session. Not the
 * cookie-bound server client — the cron has no reader behind it, and the
 * point is to see what a reader without an account sees.
 */
export function anonymousSearchHealthClient(): SearchHealthClient | null {
  if (!hasSupabaseEnv()) return null;
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      // The calls below carry their own 10 s abort; this covers the one that
      // does not (largestPublishedBook) with the same server ceiling.
      global: { fetch: fetchWithTimeout({ timeoutMs: SERVER_FETCH_TIMEOUT_MS }) },
    },
  );
  return {
    async largestPublishedBook() {
      const { data } = await supabase
        .from("books")
        .select("id")
        .eq("status", "published")
        .order("page_count", { ascending: false })
        .limit(1)
        .maybeSingle();
      return (data as { id: number } | null)?.id ?? null;
    },
    async call(fn, args, signal) {
      const { error } = await supabase.rpc(fn, args).abortSignal(signal);
      return error ? { code: error.code, message: error.message } : null;
    },
  };
}

type Run = (signal: AbortSignal) => Promise<{ code?: string | null; message?: string | null } | null>;

async function timeCall(run: Run, timeoutMs: number): Promise<SearchHealthCheck> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = Date.now();
  const at = new Date().toISOString();
  try {
    const error = await run(controller.signal);
    const ms = Date.now() - started;
    if (!error) return { ok: true, ms, code: null, at };
    if (isSearchBusy(error)) return { ok: false, ms, code: "busy", at, busy: true };
    return { ok: false, ms, code: controller.signal.aborted ? "aborted" : error.code || "error", at };
  } catch {
    return {
      ok: false,
      ms: Date.now() - started,
      code: controller.signal.aborted ? "aborted" : "error",
      at,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * One call; if every slot was in use, one pause and one more try. A single
 * "busy" says only that somebody else was searching at 06:00 — reporting it
 * as a failure would be a false alarm — so the second answer is the one kept,
 * busy or not.
 */
async function measure(run: Run, timeoutMs: number, busyPauseMs: number): Promise<SearchHealthCheck> {
  const first = await timeCall(run, timeoutMs);
  if (!first.busy) return first;
  await new Promise((resolve) => setTimeout(resolve, busyPauseMs));
  return timeCall(run, timeoutMs);
}

/**
 * The four calls, one after another, each on its own clock — four
 * measurements a reader would recognise, not four searches racing each
 * other for the free tier's shared CPU.
 */
export async function runSearchHealthCheck(
  client: SearchHealthClient,
  options: { timeoutMs?: number; busyPauseMs?: number } = {},
): Promise<FullSearchHealth> {
  const timeoutMs = options.timeoutMs ?? SEARCH_HEALTH_CALL_TIMEOUT_MS;
  const busyPauseMs = options.busyPauseMs ?? SEARCH_HEALTH_BUSY_PAUSE_MS;

  const common = await measure(
    (signal) => client.call("search_books", { q: COMMON_WORD, category_id: null, lim: 1, off: 0 }, signal),
    timeoutMs,
    busyPauseMs,
  );
  const hard = await measure(
    (signal) => client.call("search_books", { q: HARD_WORD, category_id: null, lim: 1, off: 0 }, signal),
    timeoutMs,
    busyPauseMs,
  );
  const nowhere = await measure(
    (signal) => client.call("search_books", { q: NOWHERE_WORD, category_id: null, lim: 1, off: 0 }, signal),
    timeoutMs,
    busyPauseMs,
  );

  let largest: number | null = null;
  try {
    largest = await client.largestPublishedBook();
  } catch {
    largest = null;
  }
  const navigator =
    largest === null
      ? { ok: false, ms: 0, code: "no-book", at: new Date().toISOString() }
      : await measure(
          (signal) => client.call("book_match_pages", { book_id: largest, q: COMMON_WORD, lim: 500 }, signal),
          timeoutMs,
          busyPauseMs,
        );

  return { common, hard, nowhere, navigator };
}

const LATER_CHECKS: readonly SearchHealthName[] = ["hard"] satisfies LaterCheck[];

/** Whatever was stored, read back defensively: the setting is jsonb. */
export function parseSearchHealth(value: unknown): SearchHealth | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const checks: Partial<FullSearchHealth> = {};
  for (const name of SEARCH_HEALTH_NAMES) {
    const check = record[name];
    // Written before this check existed: the record is still good without it.
    if (check === undefined && LATER_CHECKS.includes(name)) continue;
    if (!check || typeof check !== "object") return null;
    const { ok, ms, code, at, busy } = check as Record<string, unknown>;
    if (typeof ok !== "boolean" || typeof ms !== "number" || typeof at !== "string") return null;
    checks[name] = { ok, ms, code: typeof code === "string" ? code : null, at, ...(busy === true ? { busy } : {}) };
  }
  return checks as SearchHealth;
}

const LABELS: Record<SearchHealthName, string> = {
  common: "بارلىق كىتابلاردىن بىر سۆز",
  hard: "بارلىق كىتابلاردىن «ئاللاھ»",
  nowhere: "يوق سۆز",
  navigator: "كىتاب ئىچىدىكى ساناقچى",
};

export type SearchHealthSummary = {
  level: "ok" | "busy" | "warning" | "unknown";
  text: string;
};

const stamp = (at: string) => `${at.slice(0, 16).replace("T", " ")} (UTC)`;

/**
 * One line for /admin: calm when every call answered inside
 * SEARCH_HEALTH_SLOW_MS, a clearly marked warning naming what failed — and
 * when — otherwise. "Busy" (every search slot in use, twice) is neither: its
 * own quieter line, because the database turning searches away under load is
 * the protection working, not search breaking.
 */
export function summarizeSearchHealth(health: SearchHealth | null): SearchHealthSummary {
  if (!health) {
    return { level: "unknown", text: "ئىزدەش تەكشۈرۈشى تېخى ئىشلىمىدى — كۈندىلىك تەكشۈرۈشتىن كېيىن بۇ يەردە كۆرۈنىدۇ." };
  }

  const checks = checksOf(health);
  const problems = checks.filter(
    ([, check]) => !check.busy && (!check.ok || check.ms > SEARCH_HEALTH_SLOW_MS),
  );
  const busy = checks.filter(([, check]) => check.busy);
  const latest = checks.map(([, check]) => check.at).sort().at(-1) ?? "";

  if (problems.length === 0 && busy.length > 0) {
    const named = busy.map(([name]) => LABELS[name]).join("، ");
    return {
      level: "busy",
      text: `ئىزدەش تەكشۈرۈشى: ${named} — ئىزدەۋاتقانلار كۆپ بولغاچقا ساندان «ئالدىراش» دېدى (ئىككى قېتىم سىنالدى). بۇ خاتالىق ئەمەس؛ ھەر كۈنى كۆرۈنسە، سايتقا كەلكۈن كېلىۋاتقان بولۇشى مۇمكىن — ${stamp(latest)}.`,
    };
  }

  if (problems.length === 0) {
    const timings = checks.map(([name, check]) => `${LABELS[name]} ${check.ms} ms`).join(" · ");
    return {
      level: "ok",
      text: `ئىزدەش تەكشۈرۈشى: ھەممىسى نورمال (${timings}) — ${stamp(latest)}.`,
    };
  }

  const named = problems
    .map(([name, check]) => {
      return check.ok
        ? `${LABELS[name]} بەك ئاستا (${check.ms} ms)`
        : `${LABELS[name]} مەغلۇپ (خاتالىق ${check.code ?? "?"}، ${check.ms} ms)`;
    })
    .join("؛ ");
  return {
    level: "warning",
    text: `⚠ ئىزدەش تەكشۈرۈشى ئاگاھلاندۇرىدۇ — ${named} — ${stamp(latest)}. ئوقۇرمەنلەرنىڭ ئىزدىشى مەغلۇپ بولۇۋاتقان بولۇشى مۇمكىن.`,
  };
}
