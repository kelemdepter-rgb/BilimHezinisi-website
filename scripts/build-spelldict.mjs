/**
 * Build the Uyghur spellcheck dictionary the browser downloads.
 *
 * Run:  node scripts/build-spelldict.mjs
 *
 * Sources:
 *   ../bilim hezinisi/bilim hezinisi pc/assets/spellcheck/  (READ-ONLY)
 *   data/spellcheck/vocabulary.txt        corpus admissions, reviewable
 *   spellcheck-data/frequencies.tsv       from build-word-frequencies.mjs
 *   spellcheck-data/productive-stems.txt  from build-suffixes.mjs
 *
 * Output:
 *   public/spellcheck/uyghur-dict.bin   words, front-coded, one byte per letter
 *   public/spellcheck/corrections.json  wrong → correct pairs
 *
 * THE ENCODING. The words use exactly 34 distinct characters — 33 Uyghur
 * letters and the hyphen that joins compounds — counted from the list itself,
 * so one byte each is exact rather than a compromise. The previous format
 * stored them as UTF-8 text, where every Uyghur letter costs two bytes, and the
 * browser then held them in a JavaScript string, where each costs two more;
 * both doublings go away together. Front coding survives the change and gets a
 * little better at it, because the shared-prefix length is now a whole byte
 * instead of a character offset from '0' that capped it at 74.
 *
 * PROVING IT IS LOSSLESS. Any character outside the table is a build error, not
 * a dropped word. Then the finished buffer is decoded back and compared to the
 * input word for word — not a sample, all 443,426 of them — and the build
 * refuses to write if a single one differs or if the count moved. An encoding
 * change that silently corrupted one word in a hundred thousand would be
 * invisible in every other measurement in this project, so it is checked here.
 *
 * ONE BYTE PER WORD MORE. The artifact carries a flags byte alongside each
 * word: the low four bits are how often the published library uses it (log2
 * bucket), and the top bit marks a stem the dictionary inflects widely. The
 * ranking needs the first to stop breaking ties alphabetically and the
 * morphology needs the second to refuse obscure stems. Together they cost
 * 21 KB over the wire, which is a twentieth of what the words themselves cost.
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";
import { gzipSync, brotliCompressSync, constants } from "node:zlib";
import { packDictionary, unpackDictionary } from "./lib/codec.mjs";
import {
  allWords,
  baseWords,
  desktopAssets,
  multiWordEntries,
  repoRoot,
  vocabularyCorrections,
} from "./lib/wordlist.mjs";
import { dataDir } from "./lib/corpus.mjs";

const outDir = join(repoRoot, "public", "spellcheck");

/** Top bit of the flags byte; mirrors PRODUCTIVE_STEM in lib/spellcheck/dictionary.ts. */
const PRODUCTIVE_STEM = 0x80;

function readTable(name, parse) {
  const path = join(dataDir, name);
  if (!existsSync(path)) return null;
  return parse(readFileSync(path, "utf-8"));
}

/** The old text format, kept only to measure what the change actually saved. */
function frontCodeAsText(sortedWords) {
  const lines = [];
  let previous = "";
  for (const word of sortedWords) {
    let shared = 0;
    while (
      shared < previous.length &&
      shared < word.length &&
      previous[shared] === word[shared] &&
      shared < 74
    ) {
      shared++;
    }
    lines.push(String.fromCharCode(48 + shared) + word.slice(shared));
    previous = word;
  }
  return lines.join("\n");
}

const served = (buffer) =>
  brotliCompressSync(Buffer.from(buffer), { params: { [constants.BROTLI_PARAM_QUALITY]: 3 } }).length;

async function main() {
  const words = allWords();
  const base = baseWords();

  const frequencies = readTable("frequencies.tsv", (text) => {
    const table = new Map();
    for (const line of text.split("\n")) {
      if (!line || line.startsWith("#")) continue;
      const [word, bucket] = line.split("\t");
      table.set(word, Number(bucket));
    }
    return table;
  });
  const productive = readTable("productive-stems.txt", (text) => new Set(text.split("\n").filter(Boolean)));

  if (!frequencies) {
    console.warn("No frequencies.tsv — run scripts/build-word-frequencies.mjs first.");
  }
  if (!productive) {
    console.warn("No productive-stems.txt — run scripts/build-suffixes.mjs first.");
  }

  const flags = new Uint8Array(words.length);
  let withFrequency = 0;
  for (let index = 0; index < words.length; index++) {
    const word = words[index];
    const bucket = frequencies?.get(word) ?? 0;
    if (bucket > 0) withFrequency++;
    flags[index] = Math.min(bucket, 15) | (productive?.has(word) ? PRODUCTIVE_STEM : 0);
  }

  const packed = packDictionary(words, flags);

  // ── the lossless check, on every word ────────────────────────────────────
  const roundTrip = unpackDictionary(packed);
  if (roundTrip.words.length !== words.length) {
    console.error(`Round trip changed the count: ${words.length} → ${roundTrip.words.length}`);
    process.exit(1);
  }
  for (let index = 0; index < words.length; index++) {
    if (roundTrip.words[index] !== words[index]) {
      console.error(`Round trip changed word ${index}: ${words[index]} → ${roundTrip.words[index]}`);
      process.exit(1);
    }
  }
  for (let index = 0; index < words.length; index++) {
    if (roundTrip.frequencies[index] !== flags[index]) {
      console.error(`Round trip changed the flags of ${words[index]}`);
      process.exit(1);
    }
  }

  // ── corrections: the desktop's, plus the ones the owner wrote by hand ────
  const corrections = JSON.parse(await readFile(join(desktopAssets, "uyghur_corrections.json"), "utf-8"));
  const reviewed = vocabularyCorrections();

  // A hand-written pair must never end up in the held-out evaluation set: the
  // checker would be handed the answer to a question it is being marked on, and
  // the accuracy it reported would be a measurement of nothing.
  const heldOutPath = join(repoRoot, "tests", "fixtures", "spellcheck", "heldout-corrections.json");
  const heldOut = existsSync(heldOutPath)
    ? new Set(Object.keys(JSON.parse(readFileSync(heldOutPath, "utf-8"))))
    : new Set();

  let added = 0;
  const collisions = [];
  for (const [wrong, right] of reviewed) {
    if (heldOut.has(wrong)) {
      collisions.push(wrong);
      continue;
    }
    corrections[wrong] = right;
    added++;
  }
  if (collisions.length > 0) {
    console.warn(
      `\nSkipped ${collisions.length} reviewed correction(s) already in the held-out\n` +
        `evaluation set, so the measurement stays honest: ${collisions.join(", ")}\n`,
    );
  }

  // A dictionary entry is one word. A reviewer can rightly write two — the
  // corpus joins forms Uyghur keeps apart — so say what happened to them rather
  // than dropping them quietly.
  const phrases = multiWordEntries();
  if (phrases.length > 0) {
    console.log(
      `\n${phrases.length} reviewed entries are more than one word. They are offered as` +
        `\ncorrections but not added to the dictionary, which holds single words only:` +
        `\n  ${phrases.join(", ")}`,
    );
  }

  await mkdir(outDir, { recursive: true });
  await writeFile(join(outDir, "uyghur-dict.bin"), packed);
  await writeFile(join(outDir, "corrections.json"), JSON.stringify(corrections), "utf-8");

  // ── what it cost, like for like ──────────────────────────────────────────
  const oldText = frontCodeAsText(base);
  const oldBytes = Buffer.byteLength(oldText, "utf-8");
  const oldServed = served(Buffer.from(oldText, "utf-8"));
  const sameListPacked = packDictionary(base, null);
  const newServed = served(packed);

  const kb = (bytes) => `${Math.round(bytes / 1024)} KB`;
  const mb = (bytes) => `${(bytes / 1048576).toFixed(2)} MB`;

  console.log(`words:              ${words.length.toLocaleString("en-US")}`);
  console.log(`  from the desktop: ${base.length.toLocaleString("en-US")}`);
  console.log(`  from the library: ${(words.length - base.length).toLocaleString("en-US")}`);
  console.log(`  with a frequency: ${withFrequency.toLocaleString("en-US")}`);
  console.log(`corrections:        ${Object.keys(corrections).length.toLocaleString("en-US")}  (${added} written while reviewing)`);
  console.log();
  console.log(`SAME ${base.length.toLocaleString("en-US")} WORDS, both encodings:`);
  console.log(`  text, raw         ${mb(oldBytes)}      served ${kb(oldServed)}`);
  console.log(`  bytes, raw        ${mb(sameListPacked.length)}      served ${kb(served(sameListPacked))}`);
  console.log();
  console.log(`SHIPPED artifact (${words.length.toLocaleString("en-US")} words + flags):`);
  console.log(`  raw               ${mb(packed.length)}`);
  console.log(`  served (brotli q3)${kb(newServed).padStart(8)}   <- what a phone downloads`);
  console.log(`  for reference     ${kb(brotliCompressSync(Buffer.from(packed), { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }).length)} brotli q11 · ${kb(gzipSync(Buffer.from(packed), { level: 9 }).length)} gzip -9`);
  console.log();
  console.log(`Round trip verified on all ${words.length.toLocaleString("en-US")} words and their flags.`);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  await main();
}
