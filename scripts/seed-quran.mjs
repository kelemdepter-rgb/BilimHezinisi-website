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
 *
 * --dry-run  writes nothing. With the env set it reads every stored aya and
 *            reports how many translations (`text_ug`) would change, and why;
 *            it fails if any stored Arabic (`text_ar`, `text_ar_simple`)
 *            differs from what the sources give.
 * --force    rewrites the TRANSLATION of every stored aya whose `text_ug`
 *            differs (use after changing the cleaning rules). The Arabic is
 *            never rewritten: each row is written back with its own stored
 *            `text_ar` and `text_ar_simple`, and the run refuses to start if
 *            the sources' Arabic differs from what is stored. Back up first
 *            (scripts/backup.mjs), and bump QURAN_DATA_VERSION in
 *            lib/quran/data.ts so the next deploy reads the new rows.
 *
 * Uses only the service-role key — no paid feature, no extra vendor.
 */
import { createClient } from "@supabase/supabase-js";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import {
  MARKER_DIGIT,
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

// ── Compare with what is stored ─────────────────────────────────────────────
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  if (dryRun) {
    console.log("\n--dry-run: nothing was written (no env, so nothing was compared with the database).");
    process.exit(0);
  }
  fail(
    "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.\n" +
      "Run with:  node --env-file=.env.local scripts/seed-quran.mjs",
  );
}

const supabase = createClient(url, key, {
  auth: { autoRefreshToken: false, persistSession: false },
});

/** A «(digits and separators)» verse marker still inside a translation. */
function hasMarker(text) {
  for (const m of text.matchAll(/\(([\s0-9٠-٩\-–ـ،,\u200c\u200d]*)\)/g)) {
    if (MARKER_DIGIT.test(m[1])) return true;
  }
  return false;
}

/** Every stored aya, in order: (sura:aya) → its three text columns. */
async function readStored() {
  const stored = new Map();
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("quran_ayas")
      .select("sura, aya, text_ar, text_ar_simple, text_ug")
      .order("sura", { ascending: true })
      .order("aya", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) fail(`quran_ayas: ${error.message}`);
    if (!data || data.length === 0) return stored;
    for (const row of data) stored.set(`${row.sura}:${row.aya}`, row);
    if (data.length < PAGE) return stored;
  }
}

console.log("\nReading the stored ayas…");
const stored = await readStored();

const arabicDiffers = [];
const ugChanges = [];
for (const row of ayaRows) {
  const old = stored.get(`${row.sura}:${row.aya}`);
  if (!old) continue;
  if (old.text_ar !== row.text_ar || old.text_ar_simple !== row.text_ar_simple) {
    arabicDiffers.push(`${row.sura}:${row.aya}`);
  }
  if (old.text_ug !== row.text_ug) ugChanges.push({ row, old });
}

const markersOut = ugChanges.filter((c) => hasMarker(c.old.text_ug)).length;
const periodOnly = ugChanges.filter(
  (c) => !hasMarker(c.old.text_ug) && c.row.text_ug === `${c.old.text_ug}.`,
).length;
const other = ugChanges.length - markersOut - periodOnly;
const storedMarkers = [...stored.values()].filter((row) => hasMarker(row.text_ug)).length;

console.log(`  stored: ${stored.size} ayas, ${storedMarkers} with a verse marker in text_ug`);
console.log(`  missing (would be inserted): ${ayaRows.length - [...ayaRows].filter((r) => stored.has(`${r.sura}:${r.aya}`)).length}`);
console.log(`  text_ug that would change: ${ugChanges.length}`);
console.log(`    - a verse marker removed:        ${markersOut}`);
console.log(`    - only the final period restored: ${periodOnly}`);
console.log(`    - anything else:                  ${other}`);
for (const c of ugChanges.filter((c) => !hasMarker(c.old.text_ug) && c.row.text_ug !== `${c.old.text_ug}.`).slice(0, 10)) {
  console.log(`      ${c.row.sura}:${c.row.aya}  …${c.old.text_ug.slice(-40)}  →  …${c.row.text_ug.slice(-40)}`);
}
console.log(`  text_ar / text_ar_simple that differ: ${arabicDiffers.length}`);

if (arabicDiffers.length) {
  fail(
    `The stored Arabic differs from the sources in ${arabicDiffers.length} ayas ` +
      `(${arabicDiffers.slice(0, 10).join(", ")}${arabicDiffers.length > 10 ? ", …" : ""}).\n` +
      "The Arabic is never rewritten. Nothing was written — investigate before seeding.",
  );
}

if (dryRun) {
  console.log("\n--dry-run: nothing was written.");
  process.exit(0);
}

// ── Write ───────────────────────────────────────────────────────────────────
console.log("\nWriting suras…");
{
  const { error } = await supabase.from("quran_suras").upsert(suraRows, { onConflict: "number" });
  if (error) fail(`quran_suras: ${error.message}`);
}
console.log(`  ${suraRows.length} suras written.`);

const pending = ayaRows.filter((row) => !stored.has(`${row.sura}:${row.aya}`));
if (pending.length === 0) {
  console.log("\nAll 6,236 ayas are already seeded — nothing to insert.");
} else {
  if (stored.size > 0) console.log(`\n  ${stored.size} ayas already present, resuming.`);
  console.log(`Writing ${pending.length} ayas in batches of ${BATCH}…`);
  for (let i = 0; i < pending.length; i += BATCH) {
    const batch = pending.slice(i, i + BATCH);
    const { error } = await supabase.from("quran_ayas").upsert(batch, { onConflict: "sura,aya" });
    if (error) fail(`quran_ayas (batch at ${i}): ${error.message}`);
    console.log(`  ${Math.min(i + BATCH, pending.length)} / ${pending.length}`);
  }
}

if (force && ugChanges.length > 0) {
  // The stored Arabic goes back exactly as it was read; only text_ug is new.
  const rewrites = ugChanges.map(({ row, old }) => ({
    sura: row.sura,
    aya: row.aya,
    text_ar: old.text_ar,
    text_ar_simple: old.text_ar_simple,
    text_ug: row.text_ug,
  }));
  console.log(`\nRewriting the translation of ${rewrites.length} ayas in batches of ${BATCH}…`);
  for (let i = 0; i < rewrites.length; i += BATCH) {
    const batch = rewrites.slice(i, i + BATCH);
    const { error } = await supabase.from("quran_ayas").upsert(batch, { onConflict: "sura,aya" });
    if (error) fail(`quran_ayas (rewrite batch at ${i}): ${error.message}`);
    console.log(`  ${Math.min(i + BATCH, rewrites.length)} / ${rewrites.length}`);
  }
} else if (ugChanges.length > 0) {
  console.log(`\n${ugChanges.length} stored translations differ from the sources; pass --force to rewrite them.`);
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

// Read every row back: the Arabic as it was before this run, the
// translations as the sources give them, and no verse marker left.
const after = await readStored();
const arabicChanged = [];
const ugWrong = [];
let markersLeft = 0;
for (const row of ayaRows) {
  const k = `${row.sura}:${row.aya}`;
  const now = after.get(k);
  const before = stored.get(k) ?? row;
  if (!now) continue;
  if (now.text_ar !== before.text_ar || now.text_ar_simple !== before.text_ar_simple) arabicChanged.push(k);
  if (force && now.text_ug !== row.text_ug) ugWrong.push(k);
  if (hasMarker(now.text_ug)) markersLeft++;
}
if (arabicChanged.length) problems.push(`the Arabic of ${arabicChanged.length} ayas changed: ${arabicChanged.slice(0, 10).join(", ")}`);
if (ugWrong.length) problems.push(`${ugWrong.length} translations differ from the sources: ${ugWrong.slice(0, 10).join(", ")}`);
if (force && markersLeft) problems.push(`${markersLeft} translations still hold a verse marker`);
const fiftyEight = after.get("58:4")?.text_ug ?? "";
if (!fiftyEight.includes("(60 مىسكىنگە بىر ۋاخ تاماق بېرىشى لازىم)")) {
  problems.push("58:4 lost its parentheses with words");
}
console.log(`  Arabic unchanged: ${arabicChanged.length === 0 ? "yes" : "NO"}`);
console.log(`  translations with a verse marker: ${markersLeft}`);

if (problems.length) {
  fail(`Verification FAILED:\n  - ${problems.join("\n  - ")}`);
}

console.log("\nDone — the Quran is seeded and verified.");
console.log("Check the size it added with:  node --env-file=.env.local scripts/db-usage.mjs");
