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

const TARGETS = {
  category: { table: "categories", onConflict: "id" },
  book: { table: "books", onConflict: "id" },
  page: { table: "book_pages", onConflict: "book_id,page_no" },
  quran_sura: { table: "quran_suras", onConflict: "number" },
  quran_aya: { table: "quran_ayas", onConflict: "sura,aya" },
};

const buffers = { category: [], book: [], page: [], quran_sura: [], quran_aya: [] };
const counts = { category: 0, book: 0, page: 0, quran_sura: 0, quran_aya: 0 };

async function flush(kind, force = false) {
  const rows = buffers[kind];
  if (rows.length === 0 || (!force && rows.length < BATCH)) return;
  counts[kind] += rows.length;
  if (!dryRun) {
    const { table, onConflict } = TARGETS[kind];
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
  } else if (record.type === "quran_sura") {
    await flush("page", true);
    buffers.quran_sura.push(record.data);
    await flush("quran_sura");
  } else if (record.type === "quran_aya") {
    // Ayas reference quran_suras.number, so the suras must land first.
    await flush("quran_sura", true);
    buffers.quran_aya.push(record.data);
    await flush("quran_aya");
  }
}

await flush("category", true);
await flush("book", true);
await flush("page", true);
await flush("quran_sura", true);
await flush("quran_aya", true);

console.log(
  `\nDone — categories: ${counts.category}, books: ${counts.book}, pages: ${counts.page}` +
    `, quran suras: ${counts.quran_sura}, quran ayas: ${counts.quran_aya}${
      dryRun ? " (nothing written)" : ""
    }`,
);
if (!dryRun) {
  console.log("Categories keep their original ids, so book links stay intact.");
}
