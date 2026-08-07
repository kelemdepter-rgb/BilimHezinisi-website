/**
 * Record search results for a fixed query set, so the same queries can be
 * compared before and after a storage change.
 *
 * Run:  node --env-file=.env.local scripts/search-parity.mjs before
 *       node --env-file=.env.local scripts/search-parity.mjs after
 *
 * Writes .search-parity-<label>.json and, for "after", diffs against "before".
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const label = process.argv[2] === "after" ? "after" : "before";
const file = (name) => `.search-parity-${name}.json`;

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

// Pull real words out of the library so the queries exercise actual content.
const { data: pages } = await supabase
  .from("book_pages")
  .select("book_id, page_no, content")
  .order("book_id", { ascending: true })
  .order("page_no", { ascending: true })
  .limit(50);

const words = new Map();
for (const page of pages ?? []) {
  for (const word of String(page.content).split(/\s+/)) {
    const clean = word.replace(/[^\p{L}\p{M}]/gu, "");
    if (clean.length < 4) continue;
    words.set(clean, (words.get(clean) ?? 0) + 1);
  }
}
const sorted = [...words.entries()].sort((a, b) => b[1] - a[1]);
const common = sorted[0]?.[0] ?? "كىتاب";
// A word appearing once, ideally on a later page — the "rare word deep in a
// book" case.
const deepPage = (pages ?? [])[Math.min(2, (pages?.length ?? 1) - 1)];
const rare =
  String(deepPage?.content ?? "")
    .split(/\s+/)
    .map((w) => w.replace(/[^\p{L}\p{M}]/gu, ""))
    .find((w) => w.length > 5 && words.get(w) === 1) ?? sorted[sorted.length - 1]?.[0] ?? "خەزىنە";

// A two-word phrase taken verbatim from the text.
const phraseSource = String(pages?.[0]?.content ?? "").split(/\s+/).filter((w) => w.length > 3);
const phrase = phraseSource.slice(0, 2).join(" ").replace(/[^\p{L}\p{M}\s]/gu, "").trim();

const QUERIES = [
  { name: "single common word", q: common },
  { name: "rare word deep in a book", q: rare },
  { name: "quoted phrase", q: `"${phrase}"` },
  { name: "hamza/alif variant (آية vs اية)", q: "اية" },
  { name: "hamza variant (إسلام vs اسلام)", q: "اسلام" },
  { name: "uyghur ya vs alif maqsura (تىل)", q: "تىل" },
  { name: "boolean OR", q: `${common} OR خەزىنە` },
  { name: "exclusion", q: `${common} -قوندۇرۇلمىغانسۆز` },
  { name: "title word", q: "جەننەت" },
];

const results = [];
for (const query of QUERIES) {
  const started = Date.now();
  const { data, error } = await supabase.rpc("search_books", {
    q: query.q,
    category_id: null,
    lim: 20,
    off: 0,
  });
  const ms = Date.now() - started;
  results.push({
    name: query.name,
    q: query.q,
    ms,
    error: error?.message ?? null,
    hits: (data ?? []).map((row) => ({
      book_id: row.book_id,
      page_no: row.page_no,
      rank: Number(row.rank).toFixed(4),
      snippet: String(row.snippet).replace(/\s+/g, " ").slice(0, 90),
    })),
  });
}

writeFileSync(file(label), JSON.stringify(results, null, 2), "utf8");

console.log(`SEARCH PARITY — ${label.toUpperCase()}`);
console.log("=".repeat(72));
for (const entry of results) {
  console.log(`\n${entry.name}  →  ${entry.q}`);
  console.log(`  ${entry.hits.length} hit(s) in ${entry.ms} ms${entry.error ? ` ERROR: ${entry.error}` : ""}`);
  for (const hit of entry.hits.slice(0, 3)) {
    console.log(`    book ${hit.book_id} p${hit.page_no} rank ${hit.rank} | ${hit.snippet}`);
  }
}

if (label === "after" && existsSync(file("before"))) {
  const before = JSON.parse(readFileSync(file("before"), "utf8"));
  console.log(`\n${"=".repeat(72)}\nCOMPARISON WITH BEFORE\n${"=".repeat(72)}`);
  let differences = 0;
  for (const [index, entry] of results.entries()) {
    const previous = before[index];
    if (!previous) continue;
    const key = (hits) => hits.map((h) => `${h.book_id}:${h.page_no}`).join(",");
    const same = key(previous.hits) === key(entry.hits);
    const snippetsSame =
      previous.hits.map((h) => h.snippet).join("|") === entry.hits.map((h) => h.snippet).join("|");
    if (!same || !snippetsSame) differences++;
    console.log(
      `${same && snippetsSame ? "SAME    " : "CHANGED "} ${entry.name}  (${previous.hits.length} → ${entry.hits.length} hits, ${previous.ms} → ${entry.ms} ms)`,
    );
    if (!same) {
      console.log(`    before: ${key(previous.hits) || "(none)"}`);
      console.log(`    after:  ${key(entry.hits) || "(none)"}`);
    } else if (!snippetsSame) {
      console.log("    same pages, different snippet text");
    }
  }
  console.log(
    differences === 0
      ? "\nRESULT: every query returns identical results and snippets."
      : `\nRESULT: ${differences} query/queries changed — review above.`,
  );
}
