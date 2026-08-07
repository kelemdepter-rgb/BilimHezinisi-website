/**
 * Restore a backup made by scripts/backup.mjs into a Supabase project.
 *
 * Run:  node --env-file=.env.local scripts/restore.mjs backups/bilim-backup-2026-08-07.ndjson.gz
 *
 * Intended for rebuilding on a FRESH free project if the original is ever
 * lost. Existing rows with the same id are updated rather than duplicated
 * (upsert), so re-running is safe and the restore is resumable: stop it and
 * start it again and it picks up where it left off.
 *
 * Pass --dry-run to see what would be written without touching the database.
 */
import { createClient } from "@supabase/supabase-js";
import { createReadStream } from "node:fs";
import { createGunzip } from "node:zlib";
import { createInterface } from "node:readline";
import { resolve } from "node:path";

const BATCH = 200;

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}

const file = process.argv.find((arg) => arg.endsWith(".ndjson.gz"));
if (!file) {
  console.error("Usage: node --env-file=.env.local scripts/restore.mjs <backup.ndjson.gz>");
  process.exit(1);
}
const dryRun = process.argv.includes("--dry-run");

const supabase = createClient(url, key, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const buffers = { category: [], book: [], page: [] };
const counts = { category: 0, book: 0, page: 0 };

async function flush(kind, force = false) {
  const rows = buffers[kind];
  if (rows.length === 0 || (!force && rows.length < BATCH)) return;
  counts[kind] += rows.length;
  if (!dryRun) {
    const table = kind === "page" ? "book_pages" : kind === "book" ? "books" : "categories";
    const onConflict = kind === "page" ? "book_id,page_no" : "id";
    const { error } = await supabase.from(table).upsert(rows, { onConflict });
    if (error) throw new Error(`${table}: ${error.message}`);
  }
  buffers[kind] = [];
}

console.log(`Restoring from ${resolve(file)}${dryRun ? " (dry run)" : ""}…`);

const reader = createInterface({
  input: createReadStream(resolve(file)).pipe(createGunzip()),
  crlfDelay: Infinity,
});

// Categories and books must land before the pages that reference them, which
// the backup's record order already guarantees.
for await (const line of reader) {
  if (!line.trim()) continue;
  const record = JSON.parse(line);
  if (record.type === "meta") {
    console.log(`  backup taken ${record.created_at} from ${record.source}`);
    continue;
  }
  if (record.type === "category") {
    buffers.category.push(record.data);
    await flush("category");
  } else if (record.type === "book") {
    await flush("category", true);
    buffers.book.push(record.data);
    await flush("book");
  } else if (record.type === "page") {
    await flush("category", true);
    await flush("book", true);
    buffers.page.push(record.data);
    await flush("page");
    if (counts.page % 2000 === 0 && counts.page > 0) console.log(`  pages: ${counts.page}…`);
  }
}

await flush("category", true);
await flush("book", true);
await flush("page", true);

console.log(
  `\nDone — categories: ${counts.category}, books: ${counts.book}, pages: ${counts.page}${
    dryRun ? " (nothing written)" : ""
  }`,
);
if (!dryRun) {
  console.log("Categories keep their original ids, so book links stay intact.");
}
