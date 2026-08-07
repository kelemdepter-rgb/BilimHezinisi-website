/**
 * Read-only free-tier usage report.
 *
 * Run:  node --env-file=.env.local scripts/db-usage.mjs
 *
 * Measure before optimising: every storage change in this project is judged
 * against these numbers. Uses the service role, writes nothing.
 */
import { createClient } from "@supabase/supabase-js";

const FREE_DB_BYTES = 500 * 1024 * 1024;
const FREE_STORAGE_BYTES = 1024 * 1024 * 1024;

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
  console.error("Run with:  node --env-file=.env.local scripts/db-usage.mjs");
  process.exit(1);
}

const supabase = createClient(url, key, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const mb = (bytes) => `${(Number(bytes) / 1024 / 1024).toFixed(2)} MB`;
const kb = (bytes) => `${(Number(bytes) / 1024).toFixed(1)} KB`;

function table(rows, columns) {
  const widths = columns.map((column) =>
    Math.max(column.header.length, ...rows.map((row) => String(column.value(row)).length)),
  );
  const line = (cells) => cells.map((cell, i) => String(cell).padEnd(widths[i])).join("  ");
  console.log(line(columns.map((c) => c.header)));
  console.log(line(widths.map((w) => "-".repeat(w))));
  for (const row of rows) console.log(line(columns.map((c) => c.value(row))));
}

console.log("=".repeat(72));
console.log("  BILIM HEZINISI — FREE TIER USAGE");
console.log("=".repeat(72));

// ── Totals ──────────────────────────────────────────────────────────────────
const { data: totalBytes, error: totalError } = await supabase.rpc("db_total_size");
if (totalError) {
  console.error(`\nCould not read database size: ${totalError.message}`);
  console.error("Apply supabase/migrations/0005_usage_stats.sql first.");
  process.exit(1);
}

const dbPercent = (Number(totalBytes) / FREE_DB_BYTES) * 100;
console.log(`\nDATABASE: ${mb(totalBytes)} / 500 MB  (${dbPercent.toFixed(1)}% used)`);

// ── Per table ───────────────────────────────────────────────────────────────
const { data: tables } = await supabase.rpc("db_size_stats");
console.log("\nPER TABLE");
table(tables ?? [], [
  { header: "table", value: (r) => r.table_name },
  { header: "total", value: (r) => mb(r.total_bytes) },
  { header: "data", value: (r) => mb(r.table_bytes) },
  { header: "indexes", value: (r) => mb(r.index_bytes) },
  { header: "~rows", value: (r) => r.row_estimate },
]);

// ── Per index ───────────────────────────────────────────────────────────────
const { data: indexes } = await supabase.rpc("db_index_stats");
const meaningful = (indexes ?? []).filter((row) => Number(row.index_bytes) > 0);
console.log("\nPER INDEX");
table(meaningful, [
  { header: "table", value: (r) => r.table_name },
  { header: "index", value: (r) => r.index_name },
  { header: "size", value: (r) => mb(r.index_bytes) },
]);

// ── Storage buckets ─────────────────────────────────────────────────────────
console.log("\nSTORAGE BUCKETS");
const { data: buckets } = await supabase.storage.listBuckets();
let storageTotal = 0;
const bucketRows = [];
for (const bucket of buckets ?? []) {
  let bytes = 0;
  let count = 0;
  // Walk one level of folders; book assets live under <bookId>/.
  const { data: top } = await supabase.storage.from(bucket.id).list("", { limit: 1000 });
  for (const entry of top ?? []) {
    if (entry.id) {
      bytes += Number(entry.metadata?.size ?? 0);
      count += 1;
      continue;
    }
    const { data: inner } = await supabase.storage
      .from(bucket.id)
      .list(entry.name, { limit: 1000 });
    for (const file of inner ?? []) {
      bytes += Number(file.metadata?.size ?? 0);
      count += 1;
    }
  }
  storageTotal += bytes;
  bucketRows.push({ bucket: bucket.id, files: count, bytes });
}
table(bucketRows, [
  { header: "bucket", value: (r) => r.bucket },
  { header: "files", value: (r) => r.files },
  { header: "size", value: (r) => mb(r.bytes) },
]);
console.log(
  `\nSTORAGE TOTAL: ${mb(storageTotal)} / 1 GB  (${((storageTotal / FREE_STORAGE_BYTES) * 100).toFixed(1)}% used)`,
);

// ── Per-book economics ──────────────────────────────────────────────────────
const { count: bookCount } = await supabase
  .from("books")
  .select("id", { count: "exact", head: true });
const { count: pageCount } = await supabase
  .from("book_pages")
  .select("book_id", { count: "exact", head: true });

const pagesTable = (tables ?? []).find((row) => row.table_name === "book_pages");
const pagesBytes = Number(pagesTable?.total_bytes ?? 0);

console.log("\nLIBRARY");
console.log(`  books: ${bookCount ?? 0}`);
console.log(`  pages: ${pageCount ?? 0}`);

if ((bookCount ?? 0) > 0) {
  const perBook = pagesBytes / bookCount;
  const perPage = pageCount ? pagesBytes / pageCount : 0;
  console.log(`  book_pages total: ${mb(pagesBytes)}`);
  console.log(`  average per book: ${kb(perBook)}`);
  console.log(`  average per page: ${kb(perPage)}`);

  // Headroom uses the whole database, not just book_pages, so the estimate is
  // honest about indexes and everything else growing alongside.
  const remaining = FREE_DB_BYTES - Number(totalBytes);
  const perBookTotal = Number(totalBytes) / bookCount;
  console.log(
    `\n  CAPACITY: about ${Math.max(0, Math.floor(remaining / perBook))} more books at the current text size`,
  );
  console.log(
    `  (a stricter estimate, charging each book its share of the whole database: ${Math.max(
      0,
      Math.floor(remaining / perBookTotal),
    )} more)`,
  );
} else {
  console.log("  (no books yet — upload one, then re-run for per-book figures)");
}

console.log(`\n${"=".repeat(72)}`);
