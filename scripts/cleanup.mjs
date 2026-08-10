/**
 * Reclaim the space that deleted books are still holding.
 *
 * Run:  node --env-file=.env.local scripts/cleanup.mjs
 *       node --env-file=.env.local scripts/cleanup.mjs --check   (report only)
 *
 * Deleting a book removes its rows immediately — nobody can read them, and
 * ON DELETE CASCADE takes the pages with it. What it does NOT do is give the
 * disk back:
 *
 *   - the rows become "dead tuples" that Postgres keeps until a vacuum,
 *   - the GIN index over page content does not shrink AT ALL on delete; it
 *     only shrinks when the index is rebuilt.
 *
 * Autovacuum makes that space reusable by future books, but it never returns
 * it to Supabase's 500 MB accounting. Only rewriting the table does, and
 * VACUUM FULL cannot run through the API — it has to be a statement of its
 * own. So this script does everything it can (orphaned files and rows), then
 * measures the bloat and prints the exact line to paste into the SQL Editor.
 *
 * Uses only the service-role key — no paid feature, no extra vendor.
 */
import { createClient } from "@supabase/supabase-js";

const FREE_DB_BYTES = 500 * 1024 * 1024;
const PAGE = 1000;
const checkOnly = process.argv.includes("--check");

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("\nNEXT_PUBLIC_SUPABASE_URL ياكى SUPABASE_SERVICE_ROLE_KEY تېپىلمىدى.");
  console.error("مۇنداق ئىجرا قىلىڭ:  node --env-file=.env.local scripts/cleanup.mjs\n");
  process.exit(1);
}

const supabase = createClient(url, key, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const mb = (bytes) => `${(Number(bytes) / 1024 / 1024).toFixed(2)} MB`;

console.log("=".repeat(72));
console.log("  ئەخلەت تازىلاش — ئۆچۈرۈلگەن كىتابلارنىڭ قالدۇقى");
console.log("=".repeat(72));

// ── 1. Live book ids, used to spot anything left behind ─────────────────────
const bookIds = new Set();
for (let from = 0; ; from += PAGE) {
  const { data, error } = await supabase.from("books").select("id").range(from, from + PAGE - 1);
  if (error) {
    console.error(`\nكىتابلارنى ئوقۇغىلى بولمىدى: ${error.message}\n`);
    process.exit(1);
  }
  if (!data || data.length === 0) break;
  for (const row of data) bookIds.add(row.id);
  if (data.length < PAGE) break;
}
console.log(`\nھازىر كۇتۇپخانىدا ${bookIds.size} كىتاب بار.`);

// ── 2. Orphaned storage objects ─────────────────────────────────────────────
// The delete action removes a book's cover and original file before deleting
// the row, so this should always find nothing — but a failed half-delete would
// leave a file paying rent against the 1 GB storage allowance forever.
let orphanFiles = 0;
let orphanBytes = 0;
for (const bucket of ["covers", "book-files"]) {
  const { data: folders, error } = await supabase.storage.from(bucket).list("", { limit: PAGE });
  if (error) continue;
  for (const entry of folders ?? []) {
    if (entry.id) continue; // a file at the root, not a book folder
    if (bookIds.has(Number(entry.name))) continue;
    const { data: inner } = await supabase.storage.from(bucket).list(entry.name, { limit: PAGE });
    const paths = (inner ?? []).map((file) => `${entry.name}/${file.name}`);
    if (paths.length === 0) continue;
    orphanFiles += paths.length;
    orphanBytes += (inner ?? []).reduce((sum, file) => sum + Number(file.metadata?.size ?? 0), 0);
    if (!checkOnly) {
      const { error: removeError } = await supabase.storage.from(bucket).remove(paths);
      if (removeError) console.log(`  ! ${bucket}/${entry.name}: ${removeError.message}`);
    }
  }
}
console.log(
  orphanFiles === 0
    ? "ساقلىغۇچتا ئىگىسىز ھۆججەت يوق."
    : `ساقلىغۇچتىن ${orphanFiles} ئىگىسىز ھۆججەت (${mb(orphanBytes)}) ${checkOnly ? "تېپىلدى" : "ئۆچۈرۈلدى"}.`,
);

// ── 3. Orphaned pages ───────────────────────────────────────────────────────
// ON DELETE CASCADE should make this impossible; checked because a page left
// without its book would be invisible in the UI and still cost space.
const orphanPageBooks = new Map();
for (let from = 0; ; from += PAGE) {
  const { data, error } = await supabase
    .from("book_pages")
    .select("book_id")
    .range(from, from + PAGE - 1);
  if (error) break;
  if (!data || data.length === 0) break;
  for (const row of data) {
    if (!bookIds.has(row.book_id)) {
      orphanPageBooks.set(row.book_id, (orphanPageBooks.get(row.book_id) ?? 0) + 1);
    }
  }
  if (data.length < PAGE) break;
}

if (orphanPageBooks.size === 0) {
  console.log("ئىگىسىز بەت يوق.");
} else {
  const totalOrphanPages = [...orphanPageBooks.values()].reduce((sum, n) => sum + n, 0);
  console.log(`ئىگىسىز ${totalOrphanPages} بەت تېپىلدى (${orphanPageBooks.size} كىتابتىن).`);
  if (!checkOnly) {
    for (const bookId of orphanPageBooks.keys()) {
      const { error } = await supabase.from("book_pages").delete().eq("book_id", bookId);
      if (error) console.log(`  ! book ${bookId}: ${error.message}`);
    }
    console.log("ئۇلار ئۆچۈرۈلدى.");
  }
}

// ── 4. Where the space actually went ────────────────────────────────────────
const { data: totalBytes } = await supabase.rpc("db_total_size");
const { data: bloat, error: bloatError } = await supabase.rpc("db_bloat_stats");

console.log(
  `\nساندان: ${mb(totalBytes)} / 500 MB  (${((Number(totalBytes) / FREE_DB_BYTES) * 100).toFixed(1)}%)`,
);

if (bloatError) {
  console.log(
    "\nتەپسىلاتنى كۆرگىلى بولمىدى — supabase/migrations/0010_bloat_stats.sql نى تېخى قوشمىغانسىز.",
  );
  process.exit(0);
}

/**
 * Worth rewriting when the indexes have grown out of proportion to the data
 * they cover, or when dead rows are still sitting in the table. A GIN index
 * that is larger than its table is the signature of deleted book pages.
 */
const candidates = (bloat ?? []).filter((row) => {
  if (Number(row.total_bytes) < 1024 * 1024) return false;
  const indexHeavy = Number(row.index_bytes) > Number(row.table_bytes) * 1.5;
  const manyDead = Number(row.dead_rows) > Math.max(500, Number(row.live_rows) * 0.2);
  return indexHeavy || manyDead;
});

console.log("\nجەدۋەللەر:");
for (const row of bloat ?? []) {
  if (Number(row.total_bytes) < 512 * 1024) continue;
  const flag = candidates.includes(row) ? "  ← تازىلاشقا ئەرزىيدۇ" : "";
  console.log(
    `  ${row.table_name.padEnd(16)} ${mb(row.total_bytes).padStart(9)}` +
      `  (مەلۇمات ${mb(row.table_bytes)}، ئىندېكس ${mb(row.index_bytes)})` +
      `  ئۆلۈك قۇر: ${row.dead_rows}${flag}`,
  );
}

if (candidates.length === 0) {
  console.log("\nتازىلىغۇدەك ئەخلەت يوق — ھەممىسى ئورۇنلۇق.");
  process.exit(0);
}

const reclaimable = candidates.reduce((sum, row) => {
  // A rough figure, not a promise: a healthy GIN index over this kind of text
  // runs a little larger than the table it covers, so whatever the index has
  // grown BEYOND its table is the part that a rebuild gives back. The real
  // number shows up in --check afterwards.
  const excess = Math.max(0, Number(row.index_bytes) - Number(row.table_bytes));
  return sum + excess;
}, 0);

console.log(`\n${"=".repeat(72)}`);
console.log("  ئاخىرقى قەدەمنى ئۆزىڭىز بېسىڭ (بىر مىنۇت)");
console.log("=".repeat(72));
console.log(
  `\nتەخمىنەن ${mb(reclaimable)} بوشلۇقنى قايتۇرغىلى بولىدۇ. بۇنى API ئارقىلىق قىلغىلى` +
    "\nبولمايدۇ — Supabase → SQL Editor → New query غا تۆۋەندىكىنى چاپلاپ Run بېسىڭ:\n",
);
for (const row of candidates) console.log(`    vacuum full public.${row.table_name};`);
console.log(
  "\n(ئىجرا بولۇۋاتقاندا سايت بىر نەچچە سېكۇنت جاۋاب بەرمەسلىكى مۇمكىن — نورمال.)" +
    "\nئاندىن نەتىجىنى كۆرۈش ئۈچۈن:  node --env-file=.env.local scripts/cleanup.mjs --check\n",
);
