/**
 * How often each word is actually written, counted from the published library.
 *
 * Run:  node --env-file=.env.local scripts/build-word-frequencies.mjs
 *       node --env-file=.env.local scripts/build-word-frequencies.mjs --rescan
 *
 * Output:
 *   spellcheck-data/frequencies.tsv   word -> bucket, read by build-spelldict.mjs
 *
 * WHY THIS EXISTS. Ranking corrections without frequencies means every
 * candidate at the same edit distance is tied, and the old code broke those ties
 * alphabetically — so «ياخشا» offered whichever real word happened to sort
 * first, not the one anybody meant. P(candidate) is the other half of the
 * noisy-channel model in lib/spellcheck/rank.ts, and this is where it comes
 * from: 15 published books, 7,525 pages, 15.6 MB of edited Uyghur prose.
 *
 * WHY BUCKETS AND NOT COUNTS. Raw counts would cost four bytes a word and buy
 * nothing: the ranking only ever compares them, and the difference between a
 * word seen 9,000 times and one seen 11,000 times never decides anything. A
 * bucket is floor(log2(count)) + 1, capped at 15, which is one byte per word
 * before compression and about a tenth of that after — and it is the log of the
 * count that the score wants anyway, since scores add where probabilities
 * multiply.
 *
 * Words the corpus has never seen keep bucket 0, not "excluded": they are still
 * offered as corrections, just ranked below words people demonstrably write.
 */
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";
import { brotliCompressSync, constants } from "node:zlib";
import { corpusCounts, dataDir, repoRoot } from "./lib/corpus.mjs";
import { looksUyghur } from "./lib/uyghur.mjs";

/** Buckets run 1..15; 0 means the corpus never saw the word. */
export const MAX_BUCKET = 15;

export function bucketOf(total) {
  if (total <= 0) return 0;
  return Math.min(MAX_BUCKET, 1 + Math.floor(Math.log2(total)));
}

async function main() {
  const rescan = process.argv.includes("--rescan");
  const { counts, books, pages } = await corpusCounts({ rescan });

  const rows = [];
  const histogram = new Array(MAX_BUCKET + 1).fill(0);
  let skipped = 0;

  for (const [word, [total]] of counts) {
    // Arabic quotation runs through these books in bulk; admitting it as
    // "frequent Uyghur" would rank real corrections below it. See looksUyghur.
    if (!looksUyghur(word)) {
      skipped++;
      continue;
    }
    const bucket = bucketOf(total);
    histogram[bucket]++;
    rows.push(`${word}\t${bucket}`);
  }
  rows.sort();

  const text = `# books=${books} pages=${pages} words=${rows.length}\n${rows.join("\n")}\n`;
  const path = join(dataDir, "frequencies.tsv");
  await writeFile(path, text, "utf-8");

  // One byte per dictionary word is what this becomes inside the artifact; the
  // number that matters is what it adds after the CDN compresses it.
  const asBytes = Uint8Array.from(rows.map((row) => Number(row.split("\t")[1])));
  const padded = new Uint8Array(441_322);
  padded.set(asBytes.subarray(0, Math.min(asBytes.length, padded.length)));
  const served = brotliCompressSync(Buffer.from(padded), {
    params: { [constants.BROTLI_PARAM_QUALITY]: 3 },
  }).length;

  console.log(`\nfrequencies for ${rows.length.toLocaleString("en-US")} words`);
  console.log(`  skipped (not Uyghur orthography): ${skipped.toLocaleString("en-US")}`);
  console.log(`  written to ${resolve(path).replace(repoRoot + "\\", "").replace(repoRoot + "/", "")}`);
  console.log(`\nartifact cost, one byte per dictionary word:`);
  console.log(`  raw            ${(441_322 / 1024).toFixed(0)} KB`);
  console.log(`  brotli q3      ${(served / 1024).toFixed(1)} KB  <- what the CDN adds`);
  console.log(`\nbucket  words     meaning`);
  for (let bucket = MAX_BUCKET; bucket >= 1; bucket--) {
    if (histogram[bucket] === 0) continue;
    const low = 2 ** (bucket - 1);
    const high = bucket === MAX_BUCKET ? "+" : `-${2 ** bucket - 1}`;
    console.log(
      `  ${String(bucket).padStart(2)}    ${String(histogram[bucket]).padStart(6)}    seen ${low}${high} times`,
    );
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  await main();
}
