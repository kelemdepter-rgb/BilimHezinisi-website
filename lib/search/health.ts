import "server-only";
import { createClient } from "@supabase/supabase-js";
import { hasSupabaseEnv } from "@/lib/env";

/**
 * The daily search self-check.
 *
 * On 2026-09-11 every whole-library search had been failing for every
 * anonymous visitor, and nothing said so: the timing script ran with the
 * service role, the parity corpus was four pages, and the owner applies
 * migrations by hand after the tests have run. So /api/health — already
 * called once a day by the only Vercel cron this site has — now also makes
 * three fixed calls AS AN ANONYMOUS VISITOR, with the anon key and no
 * session, and writes what happened under the `search_health` setting for
 * /admin to show. No new cron, no new vendor, no new table.
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

/** The word most books carry, and the word none does. */
const COMMON_WORD = "ناماز";
const NOWHERE_WORD = "قققزززخخخ";

export const SEARCH_HEALTH_NAMES = ["common", "nowhere", "navigator"] as const;
export type SearchHealthName = (typeof SEARCH_HEALTH_NAMES)[number];

export type SearchHealthCheck = {
  ok: boolean;
  ms: number;
  /** The Postgres SQLSTATE (e.g. 57014), "aborted" past the call timeout, or null when ok. */
  code: string | null;
  at: string;
};

export type SearchHealth = Record<SearchHealthName, SearchHealthCheck>;

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
  ): Promise<{ code?: string | null } | null>;
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
    { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } },
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
      return error ? { code: error.code } : null;
    },
  };
}

async function timeCall(
  run: (signal: AbortSignal) => Promise<{ code?: string | null } | null>,
  timeoutMs: number,
): Promise<SearchHealthCheck> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = Date.now();
  const at = new Date().toISOString();
  try {
    const error = await run(controller.signal);
    const ms = Date.now() - started;
    if (!error) return { ok: true, ms, code: null, at };
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
 * The three calls, one after another, each on its own clock — three
 * measurements a reader would recognise, not three searches racing each
 * other for the free tier's shared CPU.
 */
export async function runSearchHealthCheck(
  client: SearchHealthClient,
  options: { timeoutMs?: number } = {},
): Promise<SearchHealth> {
  const timeoutMs = options.timeoutMs ?? SEARCH_HEALTH_CALL_TIMEOUT_MS;

  const common = await timeCall(
    (signal) => client.call("search_books", { q: COMMON_WORD, category_id: null, lim: 1, off: 0 }, signal),
    timeoutMs,
  );
  const nowhere = await timeCall(
    (signal) => client.call("search_books", { q: NOWHERE_WORD, category_id: null, lim: 1, off: 0 }, signal),
    timeoutMs,
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
      : await timeCall(
          (signal) => client.call("book_match_pages", { book_id: largest, q: COMMON_WORD, lim: 500 }, signal),
          timeoutMs,
        );

  return { common, nowhere, navigator };
}

/** Whatever was stored, read back defensively: the setting is jsonb. */
export function parseSearchHealth(value: unknown): SearchHealth | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const checks: Partial<SearchHealth> = {};
  for (const name of SEARCH_HEALTH_NAMES) {
    const check = record[name];
    if (!check || typeof check !== "object") return null;
    const { ok, ms, code, at } = check as Record<string, unknown>;
    if (typeof ok !== "boolean" || typeof ms !== "number" || typeof at !== "string") return null;
    checks[name] = { ok, ms, code: typeof code === "string" ? code : null, at };
  }
  return checks as SearchHealth;
}

const LABELS: Record<SearchHealthName, string> = {
  common: "بارلىق كىتابلاردىن بىر سۆز",
  nowhere: "يوق سۆز",
  navigator: "كىتاب ئىچىدىكى ساناقچى",
};

export type SearchHealthSummary = {
  level: "ok" | "warning" | "unknown";
  text: string;
};

const stamp = (at: string) => `${at.slice(0, 16).replace("T", " ")} (UTC)`;

/**
 * One line for /admin: calm when all three answered inside
 * SEARCH_HEALTH_SLOW_MS, a clearly marked warning naming what failed — and
 * when — otherwise.
 */
export function summarizeSearchHealth(health: SearchHealth | null): SearchHealthSummary {
  if (!health) {
    return { level: "unknown", text: "ئىزدەش تەكشۈرۈشى تېخى ئىشلىمىدى — كۈندىلىك تەكشۈرۈشتىن كېيىن بۇ يەردە كۆرۈنىدۇ." };
  }

  const problems = SEARCH_HEALTH_NAMES.filter(
    (name) => !health[name].ok || health[name].ms > SEARCH_HEALTH_SLOW_MS,
  );
  const latest = SEARCH_HEALTH_NAMES.map((name) => health[name].at).sort().at(-1) ?? "";

  if (problems.length === 0) {
    const timings = SEARCH_HEALTH_NAMES.map((name) => `${LABELS[name]} ${health[name].ms} ms`).join(" · ");
    return {
      level: "ok",
      text: `ئىزدەش تەكشۈرۈشى: ھەممىسى نورمال (${timings}) — ${stamp(latest)}.`,
    };
  }

  const named = problems
    .map((name) => {
      const check = health[name];
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
