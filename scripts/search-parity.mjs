/**
 * Record what search_books answers for a fixed set of queries, so a change to
 * search can be held to "the same rows, in the same order, with the same
 * snippets" — run before the change and after it.
 *
 *   node --env-file=.flood/local.env scripts/search-parity.mjs before   (the local copy)
 *   node --env-file=.flood/local.env scripts/search-parity.mjs after
 *   … add --service to call as the service role instead
 *
 * Anonymous by default — the public key, the 3 s statement timeout, the path
 * every reader takes. Each query is asked over the whole library and over one
 * large category, for the FULL ranked list a reader can page through (300
 * rows, 15 pages of 20), not just the first page.
 *
 * Writes .search-parity-<label>.json; `after` compares with `before` and
 * sorts every difference into one of two kinds:
 *   - capped or partial on either side: more than 300 pages match, or the pages
 *     a phrase may open ran out (0014, 0029). Which slice is ranked depends on
 *     the plan by design, so a difference here is listed and explained, not a
 *     failure;
 *   - anything else: a real difference. The script exits non-zero.
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const label = process.argv[2] === "after" ? "after" : "before";
const useServiceRole = process.argv.includes("--service");
const file = (name) => `.search-parity-${name}.json`;
/** The deepest a reader can page: 15 pages of 20 (app/search/page.tsx). */
const DEPTH = 300;
/** The whole library, and the largest category the audits measured. */
const SCOPES = [null, 15];

const key = useServiceRole
  ? process.env.SUPABASE_SERVICE_ROLE_KEY
  : process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !key) {
  console.error("NEXT_PUBLIC_SUPABASE_URL and the chosen key must be set.");
  process.exit(2);
}
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, key, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// Real words out of the library too, so the set is not only words chosen by hand.
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
const derivedCommon = sorted[0]?.[0] ?? "كىتاب";
const deepPage = (pages ?? [])[Math.min(2, (pages?.length ?? 1) - 1)];
const derivedRare =
  String(deepPage?.content ?? "")
    .split(/\s+/)
    .map((w) => w.replace(/[^\p{L}\p{M}]/gu, ""))
    .find((w) => w.length > 5 && words.get(w) === 1) ?? sorted[sorted.length - 1]?.[0] ?? "خەزىنە";
const phraseSource = String(pages?.[0]?.content ?? "").split(/\s+/).filter((w) => w.length > 3);
const derivedPhrase = phraseSource.slice(0, 2).join(" ").replace(/[^\p{L}\p{M}\s]/gu, "").trim();

const QUERIES = [
  // PROMPT-41's list.
  { name: "the 2026-10-05 timeout", q: "ئاللاھ" },
  { name: "very common", q: "پەيغەمبەر" },
  { name: "common", q: "ئىلىم" },
  { name: "common", q: "كىتاب" },
  { name: "common", q: "ناماز" },
  { name: "ordinary", q: "مېۋە" },
  { name: "rare", q: "تېخنىكا" },
  { name: "common phrase", q: "ئاللاھ تائالا" },
  { name: "common words, seldom adjacent", q: "پەيغەمبەر ئاللاھ" },
  { name: "occurs nowhere", q: "قققزززخخخ" },
  // Ordinary words and phrases.
  { name: "rarer word", q: "زاكات" },
  { name: "three-word phrase", q: "نامازغا چاقىرىش ئۈچۈن" },
  { name: "phrase", q: "ناماز ئوقۇش" },
  { name: "word start (نامازغا)", q: "نامازغا" },
  { name: "title word", q: "جەننەت" },
  { name: "hamza/alif variant (آية vs اية)", q: "اية" },
  { name: "hamza variant (إسلام vs اسلام)", q: "اسلام" },
  { name: "uyghur ya vs alif maqsura (تىل)", q: "تىل" },
  // What used to be operators is plain text now (0016).
  { name: "the word OR, literally", q: `${derivedCommon} OR خەزىنە` },
  // Out of the library itself.
  { name: "derived: most frequent word", q: derivedCommon },
  { name: "derived: rare word deep in a book", q: derivedRare },
  { name: "derived: two words verbatim", q: derivedPhrase },
];

const results = [];
for (const query of QUERIES) {
  for (const scope of SCOPES) {
    const started = Date.now();
    const { data, error } = await supabase.rpc("search_books", {
      q: query.q,
      category_id: scope,
      lim: DEPTH,
      off: 0,
    });
    const ms = Date.now() - started;
    const rows = data ?? [];
    results.push({
      name: query.name,
      q: query.q,
      scope,
      ms,
      error: error ? `${error.code} ${error.message}` : null,
      capped: rows.some((row) => row.capped === true),
      partial: rows.some((row) => row.partial === true),
      // The flags-only row 0029 sends when nothing was found in the part searched.
      hits: rows
        .filter((row) => row.book_id !== null)
        .map((row) => ({
          book_id: row.book_id,
          page_no: row.page_no,
          rank: Number(row.rank).toFixed(6),
          snippet: String(row.snippet).replace(/\s+/g, " "),
        })),
    });
  }
}

writeFileSync(file(label), JSON.stringify({ label, role: useServiceRole ? "service_role" : "anon", results }, null, 2), "utf8");

const scopeName = (scope) => (scope === null ? "whole library" : `category ${scope}`);
console.log(`SEARCH PARITY — ${label.toUpperCase()}  as ${useServiceRole ? "service_role" : "anon"}  (up to ${DEPTH} rows)`);
console.log("=".repeat(80));
for (const entry of results) {
  const flags = [entry.capped && "capped", entry.partial && "partial"].filter(Boolean).join(", ");
  console.log(
    `${String(entry.ms).padStart(5)} ms  ${String(entry.hits.length).padStart(3)} rows  ${scopeName(entry.scope).padEnd(13)} ` +
      `${entry.name} — «${entry.q}»${flags ? `  [${flags}]` : ""}${entry.error ? `  ERROR ${entry.error}` : ""}`,
  );
}

if (label === "after" && existsSync(file("before"))) {
  const before = JSON.parse(readFileSync(file("before"), "utf8"));
  const previousResults = Array.isArray(before) ? before : before.results;
  console.log(`\n${"=".repeat(80)}\nCOMPARISON WITH BEFORE\n${"=".repeat(80)}`);
  let real = 0;
  let sliced = 0;
  for (const entry of results) {
    const previous = previousResults.find((other) => other.q === entry.q && other.scope === entry.scope);
    if (!previous) continue;
    const rowsKey = (hits) => hits.map((h) => `${h.book_id}:${h.page_no}:${h.rank}`).join(",");
    const snippetsKey = (hits) => hits.map((h) => h.snippet).join("|");
    const same =
      !previous.error &&
      !entry.error &&
      rowsKey(previous.hits) === rowsKey(entry.hits) &&
      snippetsKey(previous.hits) === snippetsKey(entry.hits) &&
      previous.capped === entry.capped &&
      Boolean(previous.partial) === entry.partial;
    let verdict = "SAME";
    if (!same) {
      if (previous.error) verdict = `before failed (${previous.error})`;
      else if (previous.capped || previous.partial || entry.capped || entry.partial) {
        verdict = "DIFFERENT — capped or partial slice";
        sliced += 1;
      } else {
        verdict = "DIFFERENT — REAL";
        real += 1;
      }
    }
    console.log(
      `${verdict.padEnd(36)} ${scopeName(entry.scope).padEnd(13)} «${entry.q}»  ` +
        `(${previous.hits.length} → ${entry.hits.length} rows, ${previous.ms} → ${entry.ms} ms)`,
    );
    if (verdict === "DIFFERENT — REAL") {
      console.log(`    before: ${rowsKey(previous.hits).slice(0, 300) || "(none)"}`);
      console.log(`    after:  ${rowsKey(entry.hits).slice(0, 300) || "(none)"}`);
    }
  }
  console.log(
    real === 0
      ? `\nRESULT: no real difference; ${sliced} capped/partial slice(s) differ by design.`
      : `\nRESULT: ${real} REAL difference(s) — review above.`,
  );
  process.exit(real === 0 ? 0 : 1);
}
