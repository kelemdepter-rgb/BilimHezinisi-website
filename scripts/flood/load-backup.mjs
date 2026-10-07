#!/usr/bin/env node
/**
 * Load a backup of the REAL library into the local flood stack, so search can
 * be measured on exactly what readers search (PROMPT-41,
 * docs/search-common-words.md).
 *
 *   node scripts/flood/stack.mjs up
 *   node scripts/flood/load-backup.mjs backups/bilim-backup-2026-09-16.ndjson.gz
 *
 * LOCAL ONLY: it writes through `docker exec` into the stack's own database
 * container and nowhere else — no URL, no key, nothing from .env.local. The
 * backup is a file scripts/backup.mjs made earlier; reading it costs the live
 * project nothing.
 *
 * Categories, books, every page and the Qur'an are loaded with COPY in one
 * transaction (replica mode, so the foreign keys and triggers of a half-loaded
 * tree do not object). `uploaded_by` is cleared: the copy has no accounts.
 * Then the live project's planner settings — from 0025's diagnostic — are set
 * with ALTER SYSTEM, because the plan a search gets depends on them, and
 * everything is analyzed.
 */
import { spawn } from "node:child_process";
import { createReadStream, existsSync } from "node:fs";
import { createInterface } from "node:readline";
import { createGunzip } from "node:zlib";

const file = process.argv[2];
if (!file || !existsSync(file)) {
  console.error("usage: node scripts/flood/load-backup.mjs <backups/bilim-backup-….ndjson.gz>");
  process.exit(2);
}
const container = process.env.BH_FLOOD_DB ?? "bh-flood-db";

const COLUMNS = {
  category: ["categories", ["id", "parent_id", "name", "icon", "sort_order", "created_at"]],
  book: ["books", ["id", "title", "author", "category_id", "format", "date", "description", "language", "cover_path",
    "original_file_path", "file_hash", "page_count", "status", "uploaded_by", "created_at", "updated_at",
    "content_format", "published_at"]],
  page: ["book_pages", ["book_id", "page_no", "content"]],
  quran_sura: ["quran_suras", ["number", "name_ar", "name_ug", "name_translit", "revelation", "aya_count"]],
  quran_aya: ["quran_ayas", ["sura", "aya", "text_ar", "text_ar_simple", "text_ug"]],
};

/** One value in COPY's text format. */
const field = (value) => {
  if (value === null || value === undefined) return "\\N";
  const text = typeof value === "object" ? JSON.stringify(value) : String(value);
  return text.replace(/\\/g, "\\\\").replace(/\t/g, "\\t").replace(/\n/g, "\\n").replace(/\r/g, "\\r");
};

const rows = Object.fromEntries(Object.keys(COLUMNS).map((kind) => [kind, []]));
for await (const line of createInterface({ input: createReadStream(file).pipe(createGunzip()) })) {
  const record = JSON.parse(line);
  if (!rows[record.type]) continue;
  if (record.type === "book") record.data.uploaded_by = null;
  rows[record.type].push(record.data);
}

// supabase_admin: replica mode and ALTER SYSTEM need it, and it exists only
// inside this local image.
const psql = spawn(
  "docker",
  ["exec", "-i", container, "psql", "-v", "ON_ERROR_STOP=1", "-q", "-U", "supabase_admin", "-h", "127.0.0.1", "-d", "postgres"],
  { stdio: ["pipe", "inherit", "inherit"], env: { ...process.env, MSYS_NO_PATHCONV: "1" } },
);
const write = (text) => new Promise((resolve) => (psql.stdin.write(text) ? resolve() : psql.stdin.once("drain", resolve)));

await write("begin;\nset session_replication_role = replica;\n");
await write("truncate public.book_pages, public.books, public.categories, public.quran_ayas, public.quran_suras cascade;\n");
for (const [kind, [table, columns]] of Object.entries(COLUMNS)) {
  await write(`copy public.${table} (${columns.join(", ")}) from stdin;\n`);
  for (const row of rows[kind]) await write(columns.map((column) => field(row[column])).join("\t") + "\n");
  await write("\\.\n");
  console.log(`${table}: ${rows[kind].length}`);
}
await write("select setval(pg_get_serial_sequence('public.books', 'id'), (select max(id) from public.books));\n");
await write("select setval(pg_get_serial_sequence('public.categories', 'id'), (select max(id) from public.categories));\n");
await write("commit;\n");
// The live project's planner settings (0025's diagnostic, PostgreSQL 17.6).
await write("alter system set random_page_cost = 1.1;\n");
await write("alter system set work_mem = '2184kB';\n");
await write("alter system set effective_cache_size = '384MB';\n");
await write("select pg_reload_conf();\nanalyze;\n");
psql.stdin.end();
const code = await new Promise((resolve) => psql.on("close", resolve));
if (code !== 0) process.exit(code ?? 1);
console.log("loaded; the local copy now holds the backup's library");
