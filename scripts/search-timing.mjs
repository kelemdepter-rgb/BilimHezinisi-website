/**
 * Time the search RPCs against the live library.
 *
 * Run before and after a search change, so a claim about speed is a measurement
 * rather than an impression:
 *
 *   node --env-file=.env.local scripts/search-timing.mjs before
 *   node --env-file=.env.local scripts/search-timing.mjs after
 *
 * Writes .search-timing-<label>.json and, for "after", prints the difference.
 */
import { createClient } from "@supabase/supabase-js";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const label = process.argv[2] === "after" ? "after" : "before";
const file = (name) => `.search-timing-${name}.json`;
const RUNS = 5;

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

/** The phrase from the bug report, plus the shapes that stress the query plan. */
const QUERIES = [
  { name: "the reported phrase", q: "نامازغا چا" },
  { name: "one very common word", q: "پەيغەمبەر" },
  { name: "one ordinary word", q: "ناماز" },
  { name: "a rarer word", q: "زاكات" },
  { name: "a three-word phrase", q: "نامازغا چاقىرىش ئۈچۈن" },
  { name: "a phrase that occurs nowhere", q: "قىيامەت كۈنى پىلسىرات" },
];

const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

const results = [];
for (const query of QUERIES) {
  const timings = [];
  let rows = 0;
  let failure = null;

  for (let run = 0; run < RUNS; run++) {
    const started = Date.now();
    const { data, error } = await supabase.rpc("search_books", {
      q: query.q,
      category_id: null,
      lim: 20,
      off: 0,
    });
    timings.push(Date.now() - started);
    rows = (data ?? []).length;
    if (error) failure = error.message;
  }

  // The reader's match navigator, on the book the query hits hardest.
  const { data: hits } = await supabase.rpc("search_books", {
    q: query.q,
    category_id: null,
    lim: 1,
    off: 0,
  });
  const bookId = hits?.[0]?.book_id ?? null;
  let navMs = null;
  if (bookId) {
    const started = Date.now();
    await supabase.rpc("book_match_pages", { book_id: bookId, q: query.q, lim: 500 });
    navMs = Date.now() - started;
  }

  results.push({
    name: query.name,
    q: query.q,
    rows,
    ms: median(timings),
    best: Math.min(...timings),
    navMs,
    failure,
  });
}

writeFileSync(file(label), JSON.stringify(results, null, 2), "utf8");

console.log(`SEARCH TIMING — ${label.toUpperCase()}  (median of ${RUNS} runs)`);
console.log("=".repeat(78));
for (const entry of results) {
  console.log(
    `${String(entry.ms).padStart(5)} ms  ${String(entry.rows).padStart(3)} rows  ` +
      `nav ${String(entry.navMs ?? "-").padStart(5)} ms  ${entry.name} — «${entry.q}»` +
      (entry.failure ? `  ERROR: ${entry.failure}` : ""),
  );
}

if (label === "after" && existsSync(file("before"))) {
  const before = JSON.parse(readFileSync(file("before"), "utf8"));
  console.log(`\n${"=".repeat(78)}\nBEFORE → AFTER\n${"=".repeat(78)}`);
  for (const [index, entry] of results.entries()) {
    const previous = before[index];
    if (!previous) continue;
    const delta = entry.ms - previous.ms;
    const sign = delta > 0 ? "+" : "";
    console.log(
      `${String(previous.ms).padStart(5)} → ${String(entry.ms).padStart(5)} ms  ` +
        `(${sign}${delta} ms)  ${String(previous.rows)} → ${entry.rows} rows  ${entry.name}`,
    );
  }
}
