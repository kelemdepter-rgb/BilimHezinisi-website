/**
 * Repair books stored as glyph codepoints instead of letters.
 *
 * Run:  node --env-file=.env.local scripts/normalize-presentation-forms.mjs
 *       node --env-file=.env.local scripts/normalize-presentation-forms.mjs --apply
 *
 * Some Word installations save Uyghur as Arabic PRESENTATION FORMS — one
 * codepoint per drawn shape of a letter. The text looks perfect on screen and
 * is a different string to every computer that reads it: invisible to search,
 * a separate entry in the author index, and unusable when a reader copies it
 * out. Book 989 in this library arrived that way. This finds every such row and
 * folds the shapes back into the letters they stand for.
 *
 * IT WRITES NOTHING WITHOUT --apply. Without the flag it reports what it would
 * change and stops. With the flag it takes a full backup first, then writes.
 *
 * Resumable: a repaired row is no longer a candidate, so a run interrupted
 * halfway is finished simply by running it again.
 *
 * Uses only the service-role key from .env.local — no paid feature, no extra
 * vendor. The key is never printed, and neither is a whole page of a book.
 */
import { createClient } from "@supabase/supabase-js";
import { spawnSync } from "node:child_process";
import { statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  CANDIDATE_SHARE,
  LAM_ALEF_FIRST,
  LAM_ALEF_LAST,
  countSacredLigatures,
  foldPresentationForms,
  isCandidate,
  isPresentationForm,
  presentationFormShare,
} from "./lib/presentation-forms.mjs";

/** Rows read per request, and rows written per request. */
const READ_PAGE = 500;
const WRITE_BATCH = 50;
/**
 * A breath between write batches. Every page rewrite also recomputes that
 * page's search vector and its entry in the GIN index (migration 0013), so a
 * big repair must not arrive as one wall of writes.
 */
const WRITE_PAUSE_MS = 200;
/** How much of a page the report shows. Never more — these are books. */
const SAMPLE_CHARS = 100;

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
  console.error("Run with:  node --env-file=.env.local scripts/normalize-presentation-forms.mjs");
  process.exit(1);
}

const apply = process.argv.includes("--apply");
const thresholdFlag = process.argv.indexOf("--threshold");
const threshold =
  thresholdFlag !== -1 && process.argv[thresholdFlag + 1]
    ? Number(process.argv[thresholdFlag + 1])
    : CANDIDATE_SHARE;
if (!Number.isFinite(threshold) || threshold <= 0 || threshold > 1) {
  console.error("--threshold must be a share between 0 and 1.");
  process.exit(1);
}

const supabase = createClient(url, key, {
  auth: { autoRefreshToken: false, persistSession: false },
});

/**
 * The book columns that hold text a reader sees.
 *
 * `description` is here as well as title and author: it is shown on the book's
 * page and in its share card, and in book 989 it was damaged the same way. The
 * generated columns look after themselves — `author_key` (migration 0021) and
 * `content_norm` (0013) are recomputed by Postgres on the same write.
 */
const BOOK_COLUMNS = ["title", "author", "description"];

const percent = (share) => `${(share * 100).toFixed(1)}%`;
const rule = (character) => character.repeat(72);

/**
 * Prove a repair before it is written.
 *
 * Everything here is a reason to REFUSE the row rather than warn about it. The
 * fold is per-character, so a surprise means the assumption behind it has
 * broken, and a book is not the place to discover that afterwards.
 */
function verify(before, after) {
  const problems = [];
  const beforeChars = [...before];
  const afterChars = [...after];

  const survivors = afterChars.filter((character) =>
    isPresentationForm(character.codePointAt(0) ?? 0),
  );
  if (survivors.length > 0) {
    problems.push(`${survivors.length} glyph codepoints are still there after folding`);
  }

  // The lam-alef ligatures are the only characters that may change the length,
  // one codepoint standing for two letters, so each adds exactly one character.
  const expansions = beforeChars.filter(
    (character) => [...foldPresentationForms(character)].length > 1,
  );
  const unexpected = expansions.filter((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint < LAM_ALEF_FIRST || codePoint > LAM_ALEF_LAST;
  });
  if (unexpected.length > 0) {
    const named = [...new Set(unexpected)]
      .map((character) => `U+${(character.codePointAt(0) ?? 0).toString(16).toUpperCase()}`)
      .join(", ");
    problems.push(`characters expand to more than one letter and are not lam-alef: ${named}`);
  }
  const expected = beforeChars.length + expansions.length;
  if (afterChars.length !== expected) {
    problems.push(
      `length is ${afterChars.length}, expected ${expected} ` +
        `(${beforeChars.length} characters plus ${expansions.length} ligature expansions)`,
    );
  }

  const sacredBefore = countSacredLigatures(before);
  const sacredAfter = countSacredLigatures(after);
  if (sacredBefore !== sacredAfter) {
    problems.push(`religious ligatures went from ${sacredBefore} to ${sacredAfter}`);
  }

  if (before.trim() && !after.trim()) problems.push("the repair emptied the row");

  return problems;
}

/** One row that would change: what it is now, and what it would become. */
function planRow(kind, ids, before) {
  const { forms, total, share } = presentationFormShare(before);
  const after = foldPresentationForms(before);
  return { kind, ids, before, after, forms, total, share, problems: verify(before, after) };
}

console.log("Looking for books stored as glyph codepoints…");
console.log(`Threshold: a row is a candidate at ${percent(threshold)} or more.`);
console.log("Religious ligatures (U+FDF0–U+FDFD) are never folded.\n");

// ── 1. Find every candidate row ─────────────────────────────────────────────
const plans = [];
const nearMisses = [];

const { data: books, error: booksError } = await supabase
  .from("books")
  .select("id, title, author, description, status, page_count")
  .order("id");
if (booksError) throw new Error(`books: ${booksError.message}`);

const bookById = new Map(books.map((book) => [book.id, book]));

for (const book of books) {
  for (const column of BOOK_COLUMNS) {
    const value = book[column] ?? "";
    const { forms, share } = presentationFormShare(value);
    if (forms === 0) continue;
    if (isCandidate(value, threshold)) {
      plans.push(planRow("book", { id: book.id, column }, value));
    } else {
      nearMisses.push({ what: `book ${book.id} ${column}`, forms, share });
    }
  }
}

let scanned = 0;
for (let from = 0; ; from += READ_PAGE) {
  const { data, error } = await supabase
    .from("book_pages")
    .select("book_id, page_no, content")
    .order("book_id", { ascending: true })
    .order("page_no", { ascending: true })
    .range(from, from + READ_PAGE - 1);
  if (error) throw new Error(`book_pages: ${error.message}`);
  if (!data || data.length === 0) break;
  for (const page of data) {
    scanned += 1;
    const value = page.content ?? "";
    const { forms, share } = presentationFormShare(value);
    if (forms === 0) continue;
    if (isCandidate(value, threshold)) {
      plans.push(planRow("page", { book_id: page.book_id, page_no: page.page_no }, value));
    } else {
      nearMisses.push({ what: `book ${page.book_id} page ${page.page_no}`, forms, share });
    }
  }
  if (data.length < READ_PAGE) break;
}

console.log(`Scanned ${books.length} books and ${scanned} pages.\n`);

if (plans.length === 0) {
  console.log("Nothing to repair. Every row is already stored as letters.");
  process.exit(0);
}

// ── 2. The report ───────────────────────────────────────────────────────────
const byBook = new Map();
for (const plan of plans) {
  const bookId = plan.kind === "book" ? plan.ids.id : plan.ids.book_id;
  if (!byBook.has(bookId)) byBook.set(bookId, []);
  byBook.get(bookId).push(plan);
}

console.log(rule("="));
console.log(`WOULD CHANGE ${plans.length} rows across ${byBook.size} book(s)`);
console.log(rule("="));

for (const [bookId, rows] of byBook) {
  const book = bookById.get(bookId);
  const columns = rows.filter((row) => row.kind === "book");
  const pages = rows.filter((row) => row.kind === "page");
  const forms = rows.reduce((sum, row) => sum + row.forms, 0);
  const total = rows.reduce((sum, row) => sum + row.total, 0);

  console.log(`\n-- book ${bookId} (${book?.status ?? "?"}, ${book?.page_count ?? "?"} pages) --`);
  console.log(`   ${forms} of ${total} characters are glyph codepoints (${percent(forms / total)})`);
  console.log(`   book columns: ${columns.length}   pages: ${pages.length}`);

  for (const row of columns) {
    const label = `books.${row.ids.column}`.padEnd(18);
    console.log(`   ${label} ${percent(row.share)}  (${row.forms}/${row.total})`);
    console.log(`     before  ${row.before.slice(0, SAMPLE_CHARS)}`);
    console.log(`     after   ${row.after.slice(0, SAMPLE_CHARS)}`);
  }
  for (const row of pages) {
    const label = `page ${row.ids.page_no}`.padEnd(18);
    console.log(`   ${label} ${percent(row.share)}  (${row.forms}/${row.total})`);
  }

  // One readable sample per book, from its first affected page.
  const sample = pages[0] ?? columns[0];
  if (sample) {
    const where =
      sample.kind === "page" ? `page ${sample.ids.page_no}` : `books.${sample.ids.column}`;
    console.log(`\n   sample — ${where}, first ${SAMPLE_CHARS} characters:`);
    console.log(`     before  ${sample.before.slice(0, SAMPLE_CHARS)}`);
    console.log(`     after   ${sample.after.slice(0, SAMPLE_CHARS)}`);
  }
}

if (nearMisses.length > 0) {
  console.log(`\n-- left alone: ${nearMisses.length} rows below the threshold --`);
  for (const miss of nearMisses.slice(0, 20)) {
    console.log(`   ${miss.what}: ${miss.forms} glyph codepoints, ${percent(miss.share)}`);
  }
  if (nearMisses.length > 20) console.log(`   … and ${nearMisses.length - 20} more`);
}

// ── 3. Refuse anything that does not verify ─────────────────────────────────
const refused = plans.filter((plan) => plan.problems.length > 0);
if (refused.length > 0) {
  console.log(`\n${rule("=")}`);
  console.log(`REFUSED ${refused.length} rows — these would NOT be written:`);
  for (const plan of refused) {
    console.log(`   ${plan.kind} ${JSON.stringify(plan.ids)}`);
    for (const problem of plan.problems) console.log(`     - ${problem}`);
  }
  console.log("Nothing is written while a row fails its own check. Fix the fold first.");
  process.exit(1);
}
console.log(`\nAll ${plans.length} rows pass their checks:`);
console.log("  - no glyph codepoints survive the fold");
console.log("  - the length changes only by lam-alef ligatures, one character each");
console.log("  - every religious ligature is still there, in the same number");

if (!apply) {
  console.log(`\n${rule("=")}`);
  console.log("DRY RUN — nothing was written.");
  console.log("To write these changes, show this report to the owner first, then run:");
  console.log("  node --env-file=.env.local scripts/normalize-presentation-forms.mjs --apply");
  process.exit(0);
}

// ── 4. Back up before writing ───────────────────────────────────────────────
const startedAt = Date.now();
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const backupPath = `backups/bilim-backup-before-presentation-forms-${stamp}.ndjson.gz`;
const backupScript = fileURLToPath(new URL("backup.mjs", import.meta.url));

console.log(`\n${rule("=")}`);
console.log("Backing up the whole library before writing anything…");
const backup = spawnSync(process.execPath, [backupScript, "--out", backupPath], {
  stdio: "inherit",
  // The key is already in this process's environment and is handed down the
  // same way — it never appears on a command line or in a log.
  env: process.env,
});
if (backup.status !== 0) {
  console.error("The backup did not finish. Nothing has been written.");
  process.exit(1);
}
let backupStat;
try {
  backupStat = statSync(backupPath);
} catch {
  console.error(`No backup file at ${backupPath}. Nothing has been written.`);
  process.exit(1);
}
if (backupStat.mtimeMs < startedAt) {
  console.error(`${backupPath} is older than this run. Nothing has been written.`);
  process.exit(1);
}
console.log(`Backup: ${backupPath} (${(backupStat.size / 1024 / 1024).toFixed(1)} MB)`);

// ── 5. Write ────────────────────────────────────────────────────────────────
const pagePlans = plans.filter((plan) => plan.kind === "page");
const columnPlans = plans.filter((plan) => plan.kind === "book");

console.log(`\nWriting ${columnPlans.length} book columns and ${pagePlans.length} pages…`);

for (const plan of columnPlans) {
  const { error } = await supabase
    .from("books")
    .update({ [plan.ids.column]: plan.after })
    .eq("id", plan.ids.id);
  if (error) throw new Error(`books ${plan.ids.id}.${plan.ids.column}: ${error.message}`);
  console.log(`  books ${plan.ids.id}.${plan.ids.column} ok`);
}

for (let index = 0; index < pagePlans.length; index += WRITE_BATCH) {
  const slice = pagePlans.slice(index, index + WRITE_BATCH).map((plan) => ({
    book_id: plan.ids.book_id,
    page_no: plan.ids.page_no,
    content: plan.after,
  }));
  const { error } = await supabase
    .from("book_pages")
    .upsert(slice, { onConflict: "book_id,page_no" });
  if (error) {
    console.error(`\nStopped at page ${index + 1} of ${pagePlans.length}: ${error.message}`);
    console.error("Everything before this batch is repaired. Run the script again to finish.");
    process.exit(1);
  }
  console.log(`  pages ${Math.min(index + WRITE_BATCH, pagePlans.length)}/${pagePlans.length}`);
  if (index + WRITE_BATCH < pagePlans.length) {
    await new Promise((resolve) => setTimeout(resolve, WRITE_PAUSE_MS));
  }
}

console.log(`\nDone. ${plans.length} rows repaired.`);
console.log("If anything looks wrong, restore with:");
console.log(`  node --env-file=.env.local scripts/restore.mjs ${backupPath}`);
console.log("\nNow check the site itself: search for the book's title and for its author.");
// This wrote straight to the database, so no Server Action dropped the cache
// tags. Search is answered per request and is right immediately; the author
// index and the shelf are cached for CACHE_SECONDS (lib/cache.ts), which is
// the case that file's comment describes.
console.log("Search is right at once. /authors and the shelf catch up within five minutes.");
