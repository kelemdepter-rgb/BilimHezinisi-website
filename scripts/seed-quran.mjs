/**
 * Seed the Quran (114 suras, 6,236 ayas) into Supabase.
 *
 * Run:  node --env-file=.env.local scripts/seed-quran.mjs
 *       node --env-file=.env.local scripts/seed-quran.mjs --dry-run
 *       node --env-file=.env.local scripts/seed-quran.mjs --force
 *
 * Source files (copy them from the desktop app's assets/seed/ into
 * migration-data/, which is gitignored — nothing here ever reads the desktop
 * folder at runtime):
 *   migration-data/quran-uthmani-hafs.txt          Uthmani Hafs Arabic (Tanzil)
 *   migration-data/uyghur_saleh_v1.0.2-xml.1.xml   Uyghur translation (Muhammad Salih)
 *
 * Idempotent: every write is an upsert on the natural key, so running it twice
 * changes nothing and can never duplicate a verse. Resumable: ayas already in
 * the table are skipped, so an interrupted run picks up where it stopped.
 * Pass --force to rewrite every row (use after changing the parsing rules).
 *
 * Uses only the service-role key — no paid feature, no extra vendor.
 */
import { createClient } from "@supabase/supabase-js";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import {
  TOTAL_AYAS,
  SURA_META,
  buildAyaRows,
  buildSuraRows,
  checkIntegrity,
  parseTanzil,
  parseUyghurXml,
} from "./quran-text.mjs";

const BATCH = 500;
const PAGE = 1000;

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const seedDir = join(repoRoot, "migration-data");

const dryRun = process.argv.includes("--dry-run");
const force = process.argv.includes("--force");

function findSeedFile(name) {
  const path = join(seedDir, name);
  return existsSync(path) ? path : null;
}

function fail(message) {
  console.error(`\n${message}\n`);
  process.exit(1);
}

const arabicPath = findSeedFile("quran-uthmani-hafs.txt");
const uyghurPath = findSeedFile("uyghur_saleh_v1.0.2-xml.1.xml");

if (!arabicPath || !uyghurPath) {
  fail(
    "Quran seed files are missing.\n" +
      "Copy these two files from the desktop app's assets/seed/ folder into\n" +
      `  ${seedDir}\n` +
      "  - quran-uthmani-hafs.txt\n" +
      "  - uyghur_saleh_v1.0.2-xml.1.xml",
  );
}

// ── Parse and verify before touching the database ───────────────────────────
console.log("Reading the seed files…");
const [arContent, ugContent] = await Promise.all([
  readFile(arabicPath, "utf-8"),
  readFile(uyghurPath, "utf-8"),
]);

const arMap = parseTanzil(arContent);
const ugMap = parseUyghurXml(ugContent);

const { errors, warnings, totalAr } = checkIntegrity(arMap, ugMap);
let totalUg = 0;
for (const sura of Object.keys(ugMap)) totalUg += Object.keys(ugMap[sura]).length;

console.log(`  Arabic: ${totalAr} ayas`);
console.log(`  Uyghur: ${totalUg} ayas`);

if (errors.length) {
  fail(
    `Quran data integrity check FAILED (${errors.length} problems):\n  - ` +
      errors.slice(0, 20).join("\n  - ") +
      (errors.length > 20 ? `\n  … and ${errors.length - 20} more` : "") +
      "\n\nNothing was written. Re-copy the seed files and try again.",
  );
}

if (warnings.length) {
  console.log(`\n  NOTE: ${warnings.length} ayas have no Uyghur translation:`);
  for (const warning of warnings.slice(0, 10)) console.log(`    - ${warning}`);
  if (warnings.length > 10) console.log(`    … and ${warnings.length - 10} more`);
  console.log("  They are still seeded, with an empty translation.");
}

const suraRows = buildSuraRows();
const ayaRows = buildAyaRows(arMap, ugMap);
console.log(`\nParsed ${suraRows.length} suras and ${ayaRows.length} ayas — integrity OK.`);

if (dryRun) {
  console.log("\n--dry-run: nothing was written.");
  process.exit(0);
}

// ── Write ───────────────────────────────────────────────────────────────────
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  fail(
    "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.\n" +
      "Run with:  node --env-file=.env.local scripts/seed-quran.mjs",
  );
}

const supabase = createClient(url, key, {
  auth: { autoRefreshToken: false, persistSession: false },
});

console.log("\nWriting suras…");
{
  const { error } = await supabase.from("quran_suras").upsert(suraRows, { onConflict: "number" });
  if (error) fail(`quran_suras: ${error.message}`);
}
console.log(`  ${suraRows.length} suras written.`);

/** Every (sura, aya) pair already stored, so a repeat run stays cheap. */
async function readExistingKeys() {
  const seen = new Set();
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("quran_ayas")
      .select("sura, aya")
      .order("sura", { ascending: true })
      .order("aya", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) fail(`quran_ayas: ${error.message}`);
    if (!data || data.length === 0) return seen;
    for (const row of data) seen.add(`${row.sura}:${row.aya}`);
    if (data.length < PAGE) return seen;
  }
}

const existing = force ? new Set() : await readExistingKeys();
const pending = ayaRows.filter((row) => !existing.has(`${row.sura}:${row.aya}`));

if (pending.length === 0) {
  console.log("\nAll 6,236 ayas are already seeded — nothing to write.");
} else {
  if (existing.size > 0) console.log(`\n  ${existing.size} ayas already present, resuming.`);
  console.log(`Writing ${pending.length} ayas in batches of ${BATCH}…`);
  for (let i = 0; i < pending.length; i += BATCH) {
    const batch = pending.slice(i, i + BATCH);
    const { error } = await supabase.from("quran_ayas").upsert(batch, { onConflict: "sura,aya" });
    if (error) fail(`quran_ayas (batch at ${i}): ${error.message}`);
    console.log(`  ${Math.min(i + BATCH, pending.length)} / ${pending.length}`);
  }
}

// ── Verify what actually landed ─────────────────────────────────────────────
console.log("\nVerifying…");

const problems = [];

const { count: suraCount } = await supabase
  .from("quran_suras")
  .select("number", { count: "exact", head: true });
if (suraCount !== SURA_META.length) {
  problems.push(`quran_suras holds ${suraCount} rows, expected ${SURA_META.length}`);
}

const { count: ayaCount } = await supabase
  .from("quran_ayas")
  .select("sura", { count: "exact", head: true });
if (ayaCount !== TOTAL_AYAS) {
  problems.push(`quran_ayas holds ${ayaCount} rows, expected ${TOTAL_AYAS}`);
}

// Per-sura counts, read back in pages rather than trusted from the write path.
const perSura = new Map();
for (let from = 0; ; from += PAGE) {
  const { data, error } = await supabase
    .from("quran_ayas")
    .select("sura")
    .order("sura", { ascending: true })
    .order("aya", { ascending: true })
    .range(from, from + PAGE - 1);
  if (error) fail(`quran_ayas: ${error.message}`);
  if (!data || data.length === 0) break;
  for (const row of data) perSura.set(row.sura, (perSura.get(row.sura) ?? 0) + 1);
  if (data.length < PAGE) break;
}
for (const meta of SURA_META) {
  const actual = perSura.get(meta.n) ?? 0;
  if (actual !== meta.count) {
    problems.push(`sura ${meta.n} (${meta.ar}) holds ${actual} ayas, expected ${meta.count}`);
  }
}

const { count: emptyArabic } = await supabase
  .from("quran_ayas")
  .select("sura", { count: "exact", head: true })
  .eq("text_ar", "");
if (emptyArabic) problems.push(`${emptyArabic} ayas have empty Arabic text`);

const { count: emptyUyghur } = await supabase
  .from("quran_ayas")
  .select("sura", { count: "exact", head: true })
  .eq("text_ug", "");

console.log(`  suras: ${suraCount} / ${SURA_META.length}`);
console.log(`  ayas: ${ayaCount} / ${TOTAL_AYAS}`);
console.log(`  ayas with Arabic text: ${(ayaCount ?? 0) - (emptyArabic ?? 0)}`);
console.log(
  `  ayas with Uyghur translation: ${(ayaCount ?? 0) - (emptyUyghur ?? 0)}` +
    (emptyUyghur ? `  (${emptyUyghur} without)` : ""),
);

if (problems.length) {
  fail(`Verification FAILED:\n  - ${problems.join("\n  - ")}`);
}

console.log("\nDone — the Quran is seeded and verified.");
console.log("Check the size it added with:  node --env-file=.env.local scripts/db-usage.mjs");
