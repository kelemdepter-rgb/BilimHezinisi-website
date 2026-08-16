/**
 * Build the Uyghur spellcheck dictionary the browser downloads.
 *
 * Run:  node scripts/build-spelldict.mjs
 *
 * Source (READ-ONLY, from the desktop app):
 *   ../bilim hezinisi/bilim hezinisi pc/assets/spellcheck/uyghur_words.txt
 *   ../bilim hezinisi/bilim hezinisi pc/assets/spellcheck/uyghur_corrections.json
 *
 * Output:
 *   public/spellcheck/uyghur-dict.txt   front-coded word list
 *   public/spellcheck/corrections.json  wrong → correct pairs
 *
 * 441,322 words are 9.4 MB as plain text, which no phone should download. The
 * list is sorted and Uyghur words share long prefixes (ئائورتا / ئائورتىنىڭ),
 * so each line stores how many characters it shares with the line before it
 * and then only the rest:
 *
 *   ئائورتا          →  0ئائورتا
 *   ئائورتىنىڭ       →  5ىنىڭ
 *
 * That alone takes it to 2.7 MB. Vercel's CDN then compresses it on the fly —
 * measured against the deployment, at brotli quality 3, which is NOT what
 * `brotli -q 11` gives locally: 795,424 bytes served against 434,230 packed
 * here. The number that matters to a phone is the served one. It is downloaded
 * once per device (the worker keeps it in Cache Storage) and only by someone
 * who opens the notebook and switches spellcheck on.
 *
 * The shared-prefix length is written as a single character offset from '0',
 * which caps it at 74; longer shared prefixes simply start over, costing a few
 * bytes rather than needing a wider field.
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { gzipSync, brotliCompressSync, constants } from "node:zlib";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const desktop = resolve(repoRoot, "..", "bilim hezinisi", "bilim hezinisi pc", "assets", "spellcheck");
const outDir = join(repoRoot, "public", "spellcheck");

/** '0' + n, so the prefix length is one character. */
export const PREFIX_BASE = 48;
export const MAX_SHARED_PREFIX = 74;

/** Front-code a sorted word list. Exported so the decoder can be tested against it. */
export function frontCode(sortedWords) {
  const lines = [];
  let previous = "";
  for (const word of sortedWords) {
    let shared = 0;
    while (
      shared < previous.length &&
      shared < word.length &&
      previous[shared] === word[shared] &&
      shared < MAX_SHARED_PREFIX
    ) {
      shared++;
    }
    lines.push(String.fromCharCode(PREFIX_BASE + shared) + word.slice(shared));
    previous = word;
  }
  return lines.join("\n");
}

/** The inverse, kept here so a unit test can prove the round trip. */
export function frontDecode(encoded) {
  const words = [];
  let previous = "";
  for (const line of encoded.split("\n")) {
    if (!line) continue;
    const shared = line.charCodeAt(0) - PREFIX_BASE;
    const word = previous.slice(0, shared) + line.slice(1);
    words.push(word);
    previous = word;
  }
  return words;
}

async function main() {
  const wordsPath = join(desktop, "uyghur_words.txt");
  const correctionsPath = join(desktop, "uyghur_corrections.json");

  if (!existsSync(wordsPath)) {
    console.error(
      `\nThe desktop dictionary was not found at\n  ${wordsPath}\n` +
        "This script reads the desktop app's assets and never writes to them.\n",
    );
    process.exit(1);
  }

  const raw = await readFile(wordsPath, "utf-8");
  // Sorted and deduplicated: front-coding depends on the order, and duplicates
  // would both waste space and skew the suggestion ranking.
  const words = [...new Set(raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean))].sort();

  const encoded = frontCode(words);
  const roundTrip = frontDecode(encoded);
  if (roundTrip.length !== words.length) {
    console.error(`Round trip lost words: ${words.length} → ${roundTrip.length}`);
    process.exit(1);
  }
  for (let i = 0; i < words.length; i++) {
    if (roundTrip[i] !== words[i]) {
      console.error(`Round trip changed a word at ${i}: ${words[i]} → ${roundTrip[i]}`);
      process.exit(1);
    }
  }

  const corrections = JSON.parse(await readFile(correctionsPath, "utf-8"));

  await mkdir(outDir, { recursive: true });
  await writeFile(join(outDir, "uyghur-dict.txt"), encoded, "utf-8");
  await writeFile(join(outDir, "corrections.json"), JSON.stringify(corrections), "utf-8");

  const plain = Buffer.byteLength(words.join("\n"), "utf-8");
  const coded = Buffer.byteLength(encoded, "utf-8");
  // Quality 3 is what Vercel actually applies; quality 11 is shown only so the
  // gap is visible rather than surprising.
  const served = brotliCompressSync(Buffer.from(encoded, "utf-8"), {
    params: { [constants.BROTLI_PARAM_QUALITY]: 3 },
  }).length;
  const brotli = brotliCompressSync(Buffer.from(encoded, "utf-8"), {
    params: { [constants.BROTLI_PARAM_QUALITY]: 11 },
  }).length;
  const gzip = gzipSync(Buffer.from(encoded, "utf-8"), { level: 9 }).length;
  const mb = (bytes) => `${(bytes / 1048576).toFixed(2)} MB`;
  const kb = (bytes) => `${Math.round(bytes / 1024)} KB`;

  console.log(`words:            ${words.length.toLocaleString("en-US")}`);
  console.log(`corrections:      ${Object.keys(corrections).length.toLocaleString("en-US")}`);
  console.log(`plain text:       ${mb(plain)}`);
  console.log(`front-coded:      ${mb(coded)}`);
  console.log(`  over the wire:  ${kb(served)} as Vercel serves it (brotli q3)`);
  console.log(`  for reference:  ${kb(brotli)} brotli q11 · ${kb(gzip)} gzip -9`);
  console.log(`\nWritten to public/spellcheck/. Round trip verified on all ${words.length} words.`);
}

// Only build when run directly; the encoder is imported by tests.
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  await main();
}
