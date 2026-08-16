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

export function readSeed(): { bookId: number } | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { readFileSync } = require("node:fs") as typeof import("node:fs");
    return JSON.parse(readFileSync(SEED_PATH, "utf8")) as { bookId: number };
  } catch {
    return null;
  }
}
