/**
 * Import the desktop app's library into the website.
 *
 * Run (DRY RUN — reports what would happen, writes nothing):
 *   node --env-file=.env.local scripts/migrate-from-desktop.mjs
 *
 * Run for real:
 *   node --env-file=.env.local scripts/migrate-from-desktop.mjs --import
 *
 * Flags:
 *   --import                 actually write (without it nothing is written)
 *   --categories=a,b         only books in these categories (comma-separated names)
 *   --limit=N                only the N smallest books
 *   --skip-larger-than=KB    skip books whose text is larger than this
 *   --publish                import as published instead of draft
 *   --skip-pdf               skip PDF-format books instead of importing their text
 *
 * Reads a COPY of the desktop database at migration-data/library.db. The live
 * desktop database is never opened and the desktop folder is never written to.
 *
 * Idempotent and resumable: books are keyed by content hash, so re-running
 * continues where it stopped and never duplicates a book or a page.
 */
import { createClient } from "@supabase/supabase-js";
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { chunkIntoPages } from "../lib/books/chunk.ts";

// node:sqlite is still flagged experimental, and importing the TypeScript
// chunker raises a module-type notice. Neither is actionable here and both
// would bury the report; every other warning still prints.
const NOISE = new Set(["ExperimentalWarning", "MODULE_TYPELESS_PACKAGE_JSON"]);
process.removeAllListeners("warning");
process.on("warning", (warning) => {
  if (!NOISE.has(warning.name) && !NOISE.has(warning.code)) console.warn(warning);
});

/** CLAUDE.md caps a page insert at 500 rows; the upload wizard uses 200. */
const PAGE_BATCH = 200;
const FREE_DB_BYTES = 500 * 1024 * 1024;
/** Refuse to import when the result would leave less than a fifth of the tier. */
const STOP_AT_FRACTION = 0.8;

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dbPath = join(repoRoot, "migration-data", "library.db");

const args = process.argv.slice(2);
const has = (flag) => args.includes(flag);
const value = (name) => {
  const found = args.find((arg) => arg.startsWith(`--${name}=`));
  return found ? found.slice(name.length + 3) : null;
};

const doImport = has("--import");
const publish = has("--publish");
const skipPdf = has("--skip-pdf");
const onlyCategories = value("categories")
  ? value("categories").split(",").map((name) => name.trim()).filter(Boolean)
  : null;
const limit = value("limit") ? Number(value("limit")) : null;
const skipLargerThanKb = value("skip-larger-than") ? Number(value("skip-larger-than")) : null;

const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(2)} MB`;
const kb = (bytes) => `${Math.round(bytes / 1024)} KB`;

function fail(message) {
  console.error(`\n${message}\n`);
  process.exit(1);
}

function table(rows, columns) {
  if (rows.length === 0) return;
  const widths = columns.map((column) =>
    Math.max(column.header.length, ...rows.map((row) => String(column.value(row)).length)),
  );
  const line = (cells) =>
    cells.map((cell, index) => String(cell).padEnd(widths[index])).join("  ");
  console.log(line(columns.map((column) => column.header)));
  console.log(line(widths.map((width) => "-".repeat(width))));
  for (const row of rows) console.log(line(columns.map((column) => column.value(row))));
}

// ── Read the desktop copy ───────────────────────────────────────────────────
if (!existsSync(dbPath)) {
  fail(
    "The desktop library was not found.\n" +
      "Copy it (do not move it) from\n" +
      "  %USERPROFILE%\\JamiyKutupxana\\library.db\n" +
      "into\n" +
      `  ${join(repoRoot, "migration-data")}`,
  );
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  fail(
    "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.\n" +
      "Run with:  node --env-file=.env.local scripts/migrate-from-desktop.mjs",
  );
}

const supabase = createClient(url, key, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const desktop = new DatabaseSync(dbPath, { readOnly: true });

const desktopCategories = desktop
  .prepare("select id, name, parent_id, sort_order, icon from categories order by sort_order, id")
  .all();

const desktopBooks = desktop
  .prepare(
    `select b.id, b.title, b.author, b.category, b.format, b.date, b.description,
            b.file_hash, coalesce(c.content, '') as content
     from books b
     left join book_content c on c.book_id = b.id
     order by b.id`,
  )
  .all();

/**
 * A stable key for "is this the same book". The desktop hashes the source
 * FILE, and most of its rows predate that, so fall back to hashing the text —
 * which is what actually got imported and never changes.
 */
function contentHash(book) {
  const existing = String(book.file_hash ?? "").trim();
  if (existing) return existing;
  return createHash("sha256").update(book.content, "utf8").digest("hex");
}

const catalogue = desktopBooks.map((book) => {
  const content = String(book.content ?? "");
  const isPdf = String(book.format ?? "").toUpperCase() === "PDF";
  return {
    id: book.id,
    title: String(book.title ?? "").trim() || "(ئىسىمسىز)",
    author: String(book.author ?? "").trim(),
    category: String(book.category ?? "").trim(),
    // The web edition carries no PDFs, only text. This book's text was already
    // extracted on the desktop, which is exactly the supported route, so it is
    // imported and labelled for what is actually stored — never silently.
    format: isPdf ? "TXT" : String(book.format ?? "TXT").trim() || "TXT",
    wasPdf: isPdf,
    date: String(book.date ?? "").trim(),
    description: String(book.description ?? "").trim(),
    content,
    chars: content.length,
    bytes: Buffer.byteLength(content, "utf8"),
    hash: contentHash(book),
  };
});

// ── Calibrate storage cost against real rows in the live database ───────────
async function tableBytes(name) {
  const { data, error } = await supabase.rpc("db_size_stats");
  if (error) fail(`Could not read database sizes: ${error.message}`);
  const row = (data ?? []).find((entry) => entry.table_name === name);
  return Number(row?.total_bytes ?? 0);
}

/**
 * Bytes of database per character of text, measured — never guessed.
 *
 * Prefers book_pages once it holds enough imported text. Before that it
 * measures the Quran, which is the same kind of text in the same database;
 * that reading is conservative, because quran_ayas carries two more indexes
 * than book_pages does.
 */
async function calibrate() {
  const { count: pageCount } = await supabase
    .from("book_pages")
    .select("book_id", { count: "exact", head: true });

  if ((pageCount ?? 0) >= 100) {
    const { data: sample } = await supabase.from("book_pages").select("content").limit(200);
    const rows = sample ?? [];
    if (rows.length > 0) {
      const averageChars =
        rows.reduce((sum, row) => sum + String(row.content).length, 0) / rows.length;
      const totalChars = averageChars * (pageCount ?? 0);
      const bytes = await tableBytes("book_pages");
      if (totalChars > 0) {
        return { perChar: bytes / totalChars, source: "your imported books (book_pages)" };
      }
    }
  }

  let chars = 0;
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("quran_ayas")
      .select("text_ar, text_ar_simple, text_ug")
      .range(from, from + 999);
    if (error) fail(`Could not read the Quran text: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const row of data) {
      chars += row.text_ar.length + row.text_ar_simple.length + row.text_ug.length;
    }
    if (data.length < 1000) break;
  }
  if (chars === 0) fail("Nothing in the database to measure against — seed the Quran first.");
  const bytes = await tableBytes("quran_ayas");
  return {
    perChar: bytes / chars,
    source: "the Quran already in your database (conservative — it carries two extra indexes)",
  };
}

// ── Decide what would be imported ───────────────────────────────────────────
const { data: existingBookRows } = await supabase.from("books").select("id, title, file_hash");
const existingHashes = new Map(
  (existingBookRows ?? [])
    .filter((row) => row.file_hash)
    .map((row) => [row.file_hash, row]),
);

const { data: totalBytesNow, error: totalError } = await supabase.rpc("db_total_size");
if (totalError) fail(`Could not read the database size: ${totalError.message}`);
const currentBytes = Number(totalBytesNow);

const calibration = await calibrate();

for (const book of catalogue) {
  book.estimatedBytes = Math.round(book.chars * calibration.perChar);
  book.duplicate = existingHashes.get(book.hash) ?? null;
}

// Two desktop rows can hold byte-identical text under different titles. They
// would collapse into one row anyway (file_hash is unique), so say so here
// rather than letting a book vanish silently into another one's page range.
const firstWithHash = new Map();
for (const book of catalogue) {
  const seen = firstWithHash.get(book.hash);
  if (seen) book.sameContentAs = seen;
  else firstWithHash.set(book.hash, book);
}

// Selection order: smallest first, so --limit=N takes the cheapest books.
const bySize = [...catalogue].sort((a, b) => a.chars - b.chars);
let taken = 0;
for (const book of bySize) {
  const reasons = [];
  if (book.chars === 0) reasons.push("مەزمۇنى بوش");
  if (book.duplicate) reasons.push(`ئاللىبۇرۇن بار (#${book.duplicate.id})`);
  if (book.sameContentAs) reasons.push(`«${book.sameContentAs.title}» بىلەن ئوخشاش`);
  if (onlyCategories && !onlyCategories.includes(book.category)) reasons.push("تۈرى تاللانمىدى");
  if (skipLargerThanKb !== null && book.bytes > skipLargerThanKb * 1024) {
    reasons.push(`${skipLargerThanKb} KB دىن چوڭ`);
  }
  if (skipPdf && book.wasPdf) reasons.push("PDF");
  if (reasons.length === 0 && limit !== null && taken >= limit) reasons.push(`--limit=${limit}`);
  book.skipReason = reasons.length > 0 ? reasons.join(" · ") : null;
  if (!book.skipReason) taken += 1;
}

const selected = catalogue.filter((book) => !book.skipReason);
const skipped = catalogue.filter((book) => book.skipReason);
const addedBytes = selected.reduce((sum, book) => sum + book.estimatedBytes, 0);
const projected = currentBytes + addedBytes;
const projectedFraction = projected / FREE_DB_BYTES;

// ── Report ──────────────────────────────────────────────────────────────────
console.log("=".repeat(78));
console.log(`  DESKTOP LIBRARY → WEBSITE${doImport ? "" : "   (DRY RUN — nothing is written)"}`);
console.log("=".repeat(78));

console.log(`\nIn ${dbPath}:`);
console.log(`  books: ${catalogue.length}`);
console.log(`  categories: ${desktopCategories.length}`);
console.log(
  `  text: ${catalogue.reduce((sum, book) => sum + book.chars, 0).toLocaleString("en-US")} characters` +
    ` (${mb(catalogue.reduce((sum, book) => sum + book.bytes, 0))} as UTF-8)`,
);

console.log(`\nStorage cost measured from ${calibration.source}:`);
console.log(`  ${calibration.perChar.toFixed(2)} bytes of database per character of book text`);

console.log("\nBOOKS");
table(
  [...catalogue].sort((a, b) => b.chars - a.chars),
  [
    { header: "book", value: (row) => row.title.slice(0, 42) },
    { header: "category", value: (row) => row.category.slice(0, 22) },
    { header: "chars", value: (row) => row.chars.toLocaleString("en-US") },
    { header: "est. size", value: (row) => kb(row.estimatedBytes) },
    { header: "", value: (row) => (row.skipReason ? `skip: ${row.skipReason}` : "import") },
  ],
);

console.log("\nFREE TIER");
console.log(`  now:            ${mb(currentBytes)} / 500 MB  (${((currentBytes / FREE_DB_BYTES) * 100).toFixed(1)}%)`);
console.log(`  this import:  + ${mb(addedBytes)}   (${selected.length} books, ${skipped.length} skipped)`);
console.log(`  after:          ${mb(projected)} / 500 MB  (${(projectedFraction * 100).toFixed(1)}%)`);
console.log(`  still free:     ${mb(Math.max(0, FREE_DB_BYTES - projected))}`);

const twins = catalogue.filter((book) => book.sameContentAs);
if (twins.length > 0) {
  console.log(
    `\n  NOTE: ${twins.length} desktop book(s) hold exactly the same text as another book.` +
      "\n  Only one copy is imported:",
  );
  for (const book of twins) console.log(`    - «${book.title}» = «${book.sameContentAs.title}»`);
}

const pdfBooks = selected.filter((book) => book.wasPdf);
if (pdfBooks.length > 0) {
  console.log(
    `\n  NOTE: ${pdfBooks.length} book(s) are PDF on the desktop. The web edition stores no PDFs,` +
      "\n  so their already-extracted text is imported and the format is recorded as TXT:",
  );
  for (const book of pdfBooks) console.log(`    - ${book.title}`);
  console.log("  Use --skip-pdf to leave them out instead.");
}

if (projectedFraction > STOP_AT_FRACTION) {
  console.log(`\n${"!".repeat(78)}`);
  console.log(
    `  STOPPING: this import would fill ${(projectedFraction * 100).toFixed(1)}% of the free 500 MB.\n` +
      `  Nothing has been written. Import less at a time — for example:\n\n` +
      `    --categories=${desktopCategories[0]?.name ?? "…"}      only one category\n` +
      `    --limit=5                                             the 5 smallest books\n` +
      `    --skip-larger-than=500                                nothing over 500 KB\n`,
  );
  console.log(`${"!".repeat(78)}\n`);
  process.exit(2);
}

if (!doImport) {
  console.log("\nThis was a dry run. Nothing was written.");
  console.log("To import, add --import (and --publish to make the books public straight away).");
  process.exit(0);
}

if (selected.length === 0) {
  console.log("\nNothing to import.");
  process.exit(0);
}

// ── Import ──────────────────────────────────────────────────────────────────
console.log(`\n${"=".repeat(78)}`);
console.log(`  IMPORTING ${selected.length} BOOKS as ${publish ? "PUBLISHED" : "DRAFT"}`);
console.log("=".repeat(78));

/** Merge the desktop tree into the existing categories by name. */
async function resolveCategories() {
  const { data: webCategories } = await supabase.from("categories").select("id, name");
  const byName = new Map((webCategories ?? []).map((row) => [row.name, row.id]));

  const wanted = desktopCategories.filter((category) =>
    selected.some((book) => book.category === category.name),
  );
  const missing = wanted.filter((category) => !byName.has(category.name));

  if (missing.length > 0) {
    const { data: created, error } = await supabase
      .from("categories")
      .insert(
        missing.map((category) => ({
          name: category.name,
          icon: category.icon || "folder",
          sort_order: category.sort_order ?? 0,
        })),
      )
      .select("id, name");
    if (error) fail(`categories: ${error.message}`);
    for (const row of created ?? []) byName.set(row.name, row.id);
    console.log(`  created ${created?.length ?? 0} new categories`);
  }
  console.log(`  matched ${wanted.length - missing.length} existing categories by name`);
  return byName;
}

const categoryIds = await resolveCategories();

/** Attribute the import to the owner when their account can be found. */
async function findOwnerId() {
  const adminEmail = process.env.ADMIN_EMAIL;
  if (!adminEmail) return null;
  const { data } = await supabase.auth.admin.listUsers({ page: 1, perPage: 200 });
  const user = (data?.users ?? []).find(
    (candidate) => candidate.email?.toLowerCase() === adminEmail.toLowerCase(),
  );
  return user?.id ?? null;
}

const ownerId = await findOwnerId();

let importedBooks = 0;
let importedPages = 0;
let resumedBooks = 0;

for (const [index, book] of selected.entries()) {
  const position = `[${index + 1}/${selected.length}]`;
  const pages = chunkIntoPages(book.content);
  if (pages.length === 0) {
    console.log(`${position} ${book.title} — no text, skipped`);
    continue;
  }

  // Resume: a book from an interrupted run already has its row.
  const { data: existing } = await supabase
    .from("books")
    .select("id, page_count")
    .eq("file_hash", book.hash)
    .maybeSingle();

  let bookId = existing?.id ?? null;
  if (bookId) {
    resumedBooks += 1;
  } else {
    const { data: created, error } = await supabase
      .from("books")
      .insert({
        title: book.title,
        author: book.author,
        category_id: categoryIds.get(book.category) ?? null,
        format: book.format,
        date: book.date,
        description: book.description,
        language: "ug",
        status: publish ? "published" : "draft",
        file_hash: book.hash,
        page_count: pages.length,
        // Desktop content is plain text. Nothing here invents Markdown.
        content_format: "text",
        uploaded_by: ownerId,
      })
      .select("id")
      .single();
    if (error) fail(`${book.title}: ${error.message}`);
    bookId = created.id;
  }

  // Only send pages that are not already stored, so a resumed book is cheap.
  const { count: storedPages } = await supabase
    .from("book_pages")
    .select("page_no", { count: "exact", head: true })
    .eq("book_id", bookId);
  const from = storedPages === pages.length ? pages.length : 0;

  for (let start = from; start < pages.length; start += PAGE_BATCH) {
    const slice = pages.slice(start, start + PAGE_BATCH).map((content, offset) => ({
      book_id: bookId,
      page_no: start + offset + 1,
      content,
    }));
    const { error } = await supabase
      .from("book_pages")
      .upsert(slice, { onConflict: "book_id,page_no" });
    if (error) fail(`${book.title} (pages from ${start}): ${error.message}`);
    importedPages += slice.length;
  }

  if (existing && existing.page_count !== pages.length) {
    await supabase.from("books").update({ page_count: pages.length }).eq("id", bookId);
  }

  importedBooks += 1;
  console.log(
    `${position} ${book.title} — ${pages.length} pages${from > 0 ? " (already complete)" : ""}`,
  );
}

// ── Verify ──────────────────────────────────────────────────────────────────
console.log(`\n${"=".repeat(78)}`);
console.log("  VERIFYING");
console.log("=".repeat(78));

const { count: bookTotal } = await supabase
  .from("books")
  .select("id", { count: "exact", head: true });
const { count: pageTotal } = await supabase
  .from("book_pages")
  .select("book_id", { count: "exact", head: true });
const { count: draftTotal } = await supabase
  .from("books")
  .select("id", { count: "exact", head: true })
  .eq("status", "draft");

console.log(`  books in the library: ${bookTotal}   (${draftTotal} still drafts)`);
console.log(`  pages: ${pageTotal}`);

// Read a sample back: first and last page of three imported books.
const sample = selected.slice(0, 3);
for (const book of sample) {
  const { data: row } = await supabase
    .from("books")
    .select("id, page_count")
    .eq("file_hash", book.hash)
    .maybeSingle();
  if (!row) {
    console.log(`  ! ${book.title}: not found after import`);
    continue;
  }
  const [{ data: first }, { data: last }] = await Promise.all([
    supabase.from("book_pages").select("content").eq("book_id", row.id).eq("page_no", 1).maybeSingle(),
    supabase
      .from("book_pages")
      .select("content")
      .eq("book_id", row.id)
      .eq("page_no", row.page_count)
      .maybeSingle(),
  ]);
  const ok = Boolean(first?.content?.trim()) && Boolean(last?.content?.trim());
  console.log(`  ${ok ? "✓" : "!"} ${book.title}: ${row.page_count} pages, first and last page ${ok ? "read back fine" : "EMPTY"}`);
}

// Search has to find a word from a newly imported book — but search_books
// only ever returns PUBLISHED books, so a draft import is expected to return
// nothing. Both halves are checked, and the expectation is stated either way.
const searchProbe = selected.find((book) => book.chars > 2000) ?? selected[0];
if (searchProbe) {
  const words = [...new Set(searchProbe.content.split(/\s+/))].filter(
    (word) => word.length >= 7 && /^[\p{L}]+$/u.test(word),
  );
  const probe = words[Math.floor(words.length / 2)] ?? searchProbe.title.split(/\s+/)[0];

  const { count: storedWithWord } = await supabase
    .from("book_pages")
    .select("book_id", { count: "exact", head: true })
    .ilike("content", `%${probe.replace(/[%_\\]/g, (char) => `\\${char}`)}%`);
  console.log(`  ${storedWithWord ? "✓" : "!"} «${probe}» is stored on ${storedWithWord} page(s)`);

  const { data: hits, error: searchError } = await supabase.rpc("search_books", {
    q: probe,
    category_id: null,
    lim: 5,
    off: 0,
  });
  if (searchError) {
    console.log(`  ! search failed: ${searchError.message}`);
  } else if (publish) {
    console.log(`  ${hits?.length ? "✓" : "!"} search for «${probe}» → ${hits?.length ?? 0} hits`);
  } else {
    console.log(
      `  ${hits?.length === 0 ? "✓" : "!"} search for «${probe}» → ${hits?.length ?? 0} hits` +
        " (drafts are deliberately kept out of search; publish to make them findable)",
    );
  }
}

const { data: afterBytes } = await supabase.rpc("db_total_size");
console.log(
  `\n  database now: ${mb(Number(afterBytes))} / 500 MB  (${((Number(afterBytes) / FREE_DB_BYTES) * 100).toFixed(1)}%)`,
);
console.log(`  still free:   ${mb(Math.max(0, FREE_DB_BYTES - Number(afterBytes)))}`);

console.log(
  `\nDone — ${importedBooks} books (${resumedBooks} were already partly there), ${importedPages} pages written.`,
);
if (!publish) {
  console.log(
    `The books are DRAFTS: only you can see them. Publish them from /admin/books when you are ready.`,
  );
}
console.log("Now run ZAPASLA.bat so the new books are in your backup.");
