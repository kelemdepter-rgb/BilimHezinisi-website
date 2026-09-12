/**
 * Time the search RPCs against the live library, the way a visitor meets them.
 *
 *   node --env-file=.env.local scripts/search-timing.mjs before
 *   node --env-file=.env.local scripts/search-timing.mjs after
 *   node --env-file=.env.local scripts/search-timing.mjs after --service
 *
 * Anonymous by default: the site's own public key, which carries the 3 s
 * statement timeout Supabase gives the `anon` role. That is what every reader
 * without an account gets, and it is the path that failed on 2026-09-11 while
 * the service-role runs this script used to make (an 8 s timeout, RLS
 * bypassed) kept reporting the whole library healthy. `--service` keeps that
 * older behaviour for comparison.
 *
 * The matrix is every shape the query plan has to get right: an ordinary
 * word, a very common one, a rarer one, a three-word phrase and a word that
 * occurs nowhere — each over the whole library and over three categories of
 * very different sizes — plus the reader's navigator on the published book
 * with the most pages. Median of five calls each.
 *
 * Writes .search-timing-<label>.json holding the timings AND the rows each
 * call returned, so `after` is checked against `before` for the same answers,
 * not only for speed. Exits non-zero when any call fails or misses the budget
 * PROMPT-32 set for it, so a regression cannot pass quietly.
 */
import { createClient } from "@supabase/supabase-js";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const label = process.argv[2] === "after" ? "after" : "before";
const useServiceRole = process.argv.includes("--service");
const file = (name) => `.search-timing-${name}.json`;
const RUNS = 5;

const key = useServiceRole
  ? process.env.SUPABASE_SERVICE_ROLE_KEY
  : process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !key) {
  console.error("NEXT_PUBLIC_SUPABASE_URL and the chosen key must be set (.env.local).");
  process.exit(2);
}
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, key, {
  auth: { autoRefreshToken: false, persistSession: false },
});

/** A word that occurs nowhere: the index answers it in milliseconds, or not. */
const NOWHERE = "قققزززخخخ";

/**
 * Budgets from PROMPT-32's acceptance criteria, in milliseconds, as anon.
 * A word found nowhere is the tell (migration 0011): the index answers
 * "nothing" at once, so anything slower than this is a scan of every page.
 */
const QUERIES = [
  { name: "one ordinary word", q: "ناماز", budget: 1500 },
  { name: "one very common word", q: "پەيغەمبەر", budget: 1500 },
  { name: "a rarer word", q: "زاكات", budget: 1500 },
  { name: "a three-word phrase", q: "نامازغا چاقىرىش ئۈچۈن", budget: 1500 },
  { name: "a word that occurs nowhere", q: NOWHERE, budget: 400 },
];

/** The whole library, then the three categories the audit measured. */
const SCOPE_IDS = [null, 17, 15, 14];

const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const pad = (value, width) => String(value).padStart(width);

/** The categories, so a scope can be named and its size stated. */
async function describeScopes() {
  const { data: categories, error } = await supabase
    .from("categories")
    .select("id, parent_id, name");
  if (error) throw new Error(`categories: ${error.message}`);
  const { data: books, error: bookError } = await supabase
    .from("books")
    .select("id, title, category_id, page_count")
    .eq("status", "published");
  if (bookError) throw new Error(`books: ${bookError.message}`);

  // A category means itself and everything beneath it (migration 0023).
  const descendants = (rootId) => {
    const ids = new Set([rootId]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const category of categories) {
        if (category.parent_id !== null && ids.has(category.parent_id) && !ids.has(category.id)) {
          ids.add(category.id);
          grew = true;
        }
      }
    }
    return ids;
  };

  const scopes = SCOPE_IDS.map((id) => {
    const inScope = id === null ? books : books.filter((book) => descendants(id).has(book.category_id));
    return {
      id,
      name: id === null ? "the whole library" : (categories.find((c) => c.id === id)?.name ?? `category ${id}`),
      books: inScope.length,
      pages: inScope.reduce((sum, book) => sum + (book.page_count ?? 0), 0),
    };
  });

  const largest = [...books].sort((a, b) => (b.page_count ?? 0) - (a.page_count ?? 0))[0] ?? null;
  return { scopes, largest, books: books.length, pages: scopes[0].pages };
}

/** Median of RUNS calls, the rows of the first call that answered, and every failure's code. */
async function time(call) {
  const timings = [];
  let rows = null;
  let failures = 0;
  let code = null;
  let message = null;
  for (let run = 0; run < RUNS; run++) {
    const started = Date.now();
    const { data, error } = await call();
    timings.push(Date.now() - started);
    if (error) {
      failures += 1;
      code = error.code ?? "?";
      message = error.message;
    } else if (rows === null) {
      rows = data ?? [];
    }
  }
  return { ms: median(timings), best: Math.min(...timings), runs: timings, failures, code, message, rows };
}

const library = await describeScopes();
const cells = [];

for (const query of QUERIES) {
  for (const scope of library.scopes) {
    const timed = await time(() =>
      supabase.rpc("search_books", { q: query.q, category_id: scope.id, lim: 20, off: 0 }),
    );
    cells.push({
      kind: "search_books",
      name: query.name,
      q: query.q,
      scope,
      budget: query.budget,
      ...timed,
      rows: (timed.rows ?? []).map((row) => ({
        book_id: row.book_id,
        page_no: row.page_no,
        rank: row.rank,
        capped: row.capped,
        snippet: row.snippet,
      })),
    });
  }
}

// The reader's navigator on the biggest book: its cost grows with the pages
// of ONE book, so this is where a per-page plan shows up last and worst.
if (library.largest) {
  for (const query of [QUERIES[0], QUERIES[QUERIES.length - 1]]) {
    const timed = await time(() =>
      supabase.rpc("book_match_pages", { book_id: library.largest.id, q: query.q, lim: 500 }),
    );
    cells.push({
      kind: "book_match_pages",
      name: query.name,
      q: query.q,
      scope: {
        id: library.largest.id,
        name: `book ${library.largest.id} (${library.largest.page_count} pages)`,
        books: 1,
        pages: library.largest.page_count,
      },
      budget: query.budget,
      ...timed,
      rows: (timed.rows ?? []).map((row) => ({ page_no: row.page_no, hits: row.hits })),
    });
  }
}

const report = {
  label,
  role: useServiceRole ? "service_role" : "anon",
  at: new Date().toISOString(),
  runs: RUNS,
  library: { books: library.books, pages: library.pages, largest: library.largest },
  cells,
};
writeFileSync(file(label), JSON.stringify(report, null, 2), "utf8");

// ── Print ───────────────────────────────────────────────────────────────────
console.log(
  `SEARCH TIMING — ${label.toUpperCase()}  as ${report.role}  (median of ${RUNS} runs)  ` +
    `${library.books} books / ${library.pages} pages`,
);
console.log("=".repeat(100));
let failed = 0;
let overBudget = 0;
for (const cell of cells) {
  const status = cell.failures > 0 ? `FAIL ${cell.code} ×${cell.failures}` : cell.ms > cell.budget ? "OVER BUDGET" : "ok";
  if (cell.failures > 0) failed += 1;
  else if (cell.ms > cell.budget) overBudget += 1;
  console.log(
    `${pad(cell.ms, 5)} ms  ${pad(cell.rows.length, 3)} rows  ` +
      `${cell.kind === "search_books" ? "search" : "nav   "}  ${cell.scope.name.padEnd(28)} ` +
      `${pad(cell.scope.pages, 6)} pages  ${cell.name} — «${cell.q}»  ${status}`,
  );
}

// ── Compare with the run before ─────────────────────────────────────────────
if (label === "after" && existsSync(file("before"))) {
  const before = JSON.parse(readFileSync(file("before"), "utf8"));
  const previousCells = Array.isArray(before.cells) ? before.cells : [];
  const sameCell = (cell) => (other) =>
    other.kind === cell.kind && other.q === cell.q && other.scope?.id === cell.scope.id;

  console.log(`\n${"=".repeat(100)}\nBEFORE (${before.role ?? "?"}) → AFTER (${report.role})\n${"=".repeat(100)}`);
  let differentAnswers = 0;
  for (const cell of cells) {
    const previous = previousCells.find(sameCell(cell));
    if (!previous) continue;
    const delta = cell.ms - previous.ms;
    let answers;
    if (previous.failures > 0) {
      answers = "before failed — nothing to compare";
    } else if (cell.failures > 0) {
      answers = "AFTER FAILED";
    } else if (JSON.stringify(previous.rows) === JSON.stringify(cell.rows)) {
      answers = "same answers";
    } else {
      // A capped result is the best of an early slice by design (0014), and
      // which slice depends on the plan; an uncapped difference is a real one.
      const capped = previous.rows[0]?.capped === true || cell.rows[0]?.capped === true;
      answers = capped ? "DIFFERENT (capped slice)" : "DIFFERENT ANSWERS";
      differentAnswers += 1;
    }
    console.log(
      `${pad(previous.ms, 5)} → ${pad(cell.ms, 5)} ms  (${delta > 0 ? "+" : ""}${delta})  ` +
        `${cell.scope.name.padEnd(28)} ${cell.name} — «${cell.q}»  ${answers}`,
    );
  }
  if (differentAnswers > 0) console.log(`\n${differentAnswers} cell(s) answered differently — see above.`);
}

console.log(`\n${failed} failed, ${overBudget} over budget, of ${cells.length} calls.`);
process.exit(failed > 0 || overBudget > 0 ? 1 : 0);
