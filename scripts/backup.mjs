/**
 * Full library backup to a compressed file on your own computer.
 *
 * Run:  node --env-file=.env.local scripts/backup.mjs
 *       node --env-file=.env.local scripts/backup.mjs --out backups/my-backup.ndjson.gz
 *
 * Exports categories, books and every page as gzipped NDJSON (one JSON record
 * per line), so a huge library never has to fit in memory at once. Reads in
 * pages, so it survives large tables; safe to re-run any time.
 *
 * Uses only the service-role key — no paid feature, no extra vendor.
 */
import { createClient } from "@supabase/supabase-js";
import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createGzip } from "node:zlib";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";

const PAGE_SIZE = 500;

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
  console.error("Run with:  node --env-file=.env.local scripts/backup.mjs");
  process.exit(1);
}

const outFlag = process.argv.indexOf("--out");
const stamp = new Date().toISOString().slice(0, 10);
const outPath = resolve(
  outFlag !== -1 && process.argv[outFlag + 1]
    ? process.argv[outFlag + 1]
    : `backups/bilim-backup-${stamp}.ndjson.gz`,
);

const supabase = createClient(url, key, {
  auth: { autoRefreshToken: false, persistSession: false },
});

/** Yield every row of a table in id order, a page at a time. */
async function* readAll(table, columns, orderColumn) {
  let from = 0;
  for (;;) {
    const { data, error } = await supabase
      .from(table)
      .select(columns)
      .order(orderColumn, { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    if (!data || data.length === 0) return;
    for (const row of data) yield row;
    if (data.length < PAGE_SIZE) return;
    from += PAGE_SIZE;
  }
}

async function* records() {
  yield { type: "meta", version: 1, created_at: new Date().toISOString(), source: url };

  let categories = 0;
  for await (const row of readAll("categories", "*", "id")) {
    categories++;
    yield { type: "category", data: row };
  }
  console.log(`  categories: ${categories}`);

  let books = 0;
  for await (const row of readAll("books", "*", "id")) {
    books++;
    yield { type: "book", data: row };
  }
  console.log(`  books: ${books}`);

  let pages = 0;
  // book_pages has a composite key; ordering by book_id then paging is enough
  // because the range window walks the whole table in a stable order.
  let from = 0;
  for (;;) {
    const { data, error } = await supabase
      .from("book_pages")
      .select("book_id, page_no, content")
      .order("book_id", { ascending: true })
      .order("page_no", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`book_pages: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const row of data) {
      pages++;
      yield { type: "page", data: row };
    }
    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
    if (pages % 5000 === 0) console.log(`  pages: ${pages}…`);
  }
  console.log(`  pages: ${pages}`);

  // Quran: seeded from migration-data/, but those source files are gitignored
  // and live only on this computer, so the backup carries the verses too.
  // Identity ids are left out on purpose — both tables have natural keys
  // (number, and sura+aya), which is what the restore upserts on.
  let suras = 0;
  for await (const row of readAll(
    "quran_suras",
    "number, name_ar, name_ug, name_translit, revelation, aya_count",
    "number",
  )) {
    suras++;
    yield { type: "quran_sura", data: row };
  }
  console.log(`  quran suras: ${suras}`);

  let ayas = 0;
  for (let start = 0; ; start += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("quran_ayas")
      .select("sura, aya, text_ar, text_ar_simple, text_ug")
      .order("sura", { ascending: true })
      .order("aya", { ascending: true })
      .range(start, start + PAGE_SIZE - 1);
    if (error) throw new Error(`quran_ayas: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const row of data) {
      ayas++;
      yield { type: "quran_aya", data: row };
    }
    if (data.length < PAGE_SIZE) break;
  }
  console.log(`  quran ayas: ${ayas}`);
}

async function* lines() {
  for await (const record of records()) yield `${JSON.stringify(record)}\n`;
}

console.log("Backing up the library…");
await mkdir(dirname(outPath), { recursive: true });
await pipeline(Readable.from(lines()), createGzip(), createWriteStream(outPath));
console.log(`\nDone → ${outPath}`);
console.log("Keep this file somewhere safe (external drive or cloud drive).");
