import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Playwright does not read .env.local, so load it here. Values already in the
 * environment win, which keeps CI overrides working.
 */
export function loadEnvLocal(root = process.cwd()): void {
  let raw: string;
  try {
    raw = readFileSync(join(root, ".env.local"), "utf8");
  } catch {
    return;
  }
  for (const line of raw.split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key]) continue;
    process.env[key] = rawValue.trim().replace(/^["']|["']$/g, "");
  }
}

/** Admin-area tests need a real session, which needs the service-role key. */
export function hasStaffTestEnv(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY &&
      process.env.SUPABASE_SERVICE_ROLE_KEY,
  );
}

export const STAFF_STATE_PATH = "tests/.auth/staff.json";

/**
 * Where the reader keeps its typography choices. Kept in step with
 * SETTINGS_STORAGE_KEY in lib/reader/settings.ts — the licence clean-up has
 * to leave readers who stored a now-removed font still able to open a book.
 */
export const READER_SETTINGS_KEY = "bh-reader-settings";
export const STAFF_EMAIL = "bh-e2e-uploader@mailinator.com";
export const STAFF_PASSWORD = "bh-e2e-password-8842";

/**
 * A second, ordinary account. Notes are per-user, and the only honest way to
 * test that is with two real people: one writes, the other must not be able to
 * open it.
 */
export const READER_STATE_PATH = "tests/.auth/reader.json";
export const READER_EMAIL = "bh-e2e-reader@mailinator.com";
export const READER_PASSWORD = "bh-e2e-password-5517";

/**
 * Marks every book request a test writes.
 *
 * These rows land in the OWNER'S real inbox and count against the daily cap,
 * so the teardown deletes them by this prefix — a test run must not leave the
 * admin a page of its own noise to wade through.
 */
export const SEED_REQUEST_PREFIX = "__e2e_telep__";

/**
 * Marks every book the batch-import spec creates.
 *
 * That spec writes REAL books to the owner's library — it is the only honest
 * way to prove an import worked — so every one of them is named with this
 * prefix and removed again, both by the spec and by the teardown, in case a
 * run is interrupted partway through.
 *
 * No underscores or asterisks, unlike the other markers here: this one appears
 * inside a Markdown heading in a fixture, where `__like_this__` is bold and the
 * importer would quite correctly strip the marks back off again.
 */
export const BATCH_PREFIX = "e2eToplam";

/** Disposable published book used by the reader and search specs. */
export const SEED_PATH = "tests/.auth/seed.json";
export const SEED_BOOK_TITLE = "__e2e_kitab__ سىناق كىتابى";
export const SEED_BOOK_HASH = "__e2e_book_hash__";
/** A word placed on a known page so search results can be asserted exactly. */
export const SEED_NEEDLE = "ئالتۇنكۆۋرۈك";
export const SEED_NEEDLE_PAGE = 3;
/** A second page carrying the needle, so match stepping has to cross pages. */
export const SEED_NEEDLE_LATER_PAGE = 7;
/** A phrase the seeded book carries verbatim, for phrase-search tests. */
export const SEED_NEEDLE_PHRASE = `بۇ بەتتە ${SEED_NEEDLE} دېگەن`;
/** How many times the needle occurs in the seeded book, in total. */
export const SEED_NEEDLE_COUNT = 3;
export const SEED_PAGE_COUNT = 14;

/**
 * The production bug, reduced to a fixture.
 *
 * «نامازغا چا» highlighted a standalone «چالايلى» and a standalone «چاقىر»,
 * because ts_headline marked the lexeme «چا» wherever it began a word. So one
 * page carries the phrase followed by a longer word (the match must reach into
 * it) AND the same fragment standing on its own (it must not be touched).
 */
/**
 * Its own stem, deliberately not SEED_NEEDLE: extra occurrences of the needle
 * would change how ts_rank orders the results, and the tests above assert which
 * page comes first.
 */
export const SEED_FRAGMENT_PAGE = 5;
export const SEED_FRAGMENT_STEM = "تاشكۆۋرۈككە";
export const SEED_FRAGMENT_PHRASE = `${SEED_FRAGMENT_STEM} چا`;
/** Words that begin with the phrase's last fragment but are not the phrase. */
export const SEED_FRAGMENT_DECOYS = ["چالايلى", "چاقىر"] as const;
/** How many times the phrase itself occurs on that page. */
export const SEED_FRAGMENT_COUNT = 2;

/**
 * A second seeded book, stored as Markdown. Two thirds of the real library is,
 * and that path rendered no highlights at all — following a search result
 * opened the right page with nothing marked on it.
 */
export const SEED_MD_BOOK_TITLE = "__e2e_md__ ماركداۋن سىناق كىتابى";
export const SEED_MD_BOOK_HASH = "__e2e_md_hash__";
export const SEED_MD_PATH = "tests/.auth/seed-md.json";
export const SEED_MD_PAGE_COUNT = 6;
/** The needle sits on this page, once inside bold markup and once in plain prose. */
export const SEED_MD_NEEDLE_PAGE = 2;

export function readMarkdownSeed(): { bookId: number } | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { readFileSync } = require("node:fs") as typeof import("node:fs");
    return JSON.parse(readFileSync(SEED_MD_PATH, "utf8")) as { bookId: number };
  } catch {
    return null;
  }
}

export function readSeed(): { bookId: number } | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { readFileSync } = require("node:fs") as typeof import("node:fs");
    return JSON.parse(readFileSync(SEED_PATH, "utf8")) as { bookId: number };
  } catch {
    return null;
  }
}

/**
 * The cron token the Playwright servers run with when .env.local has none.
 *
 * /api/health is what stops the free Supabase project pausing after ~7 idle
 * days; it only authenticates when CRON_SECRET is set, so the suite sets one
 * in order to prove both halves — 200 with the token, 401 without it.
 */
export const CRON_TEST_SECRET = "bh-e2e-cron-4471";
