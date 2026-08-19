/**
 * Converts the UKIJ fonts we are allowed to redistribute into woff2 and
 * writes them into public/fonts/.
 *
 * Only fonts whose OWN name table records the UKIJ/LGPL licence are
 * converted — the filename is not evidence. UKIJEsliye.ttf, for one, carries
 * "All Rights Reserved" with no licence grant, which is why UKIJ Esliye is
 * not in the manifest below even though the desktop app offers it.
 *
 * The KFGQPC Uthmanic Hafs OTFs are deliberately NOT here: their licence
 * forbids modifying the font software, and a format conversion is exactly
 * that. They ship as the original .otf files.
 *
 * Sources live in the read-only desktop repo (and upstream at
 * http://www.ukij.org/fonts), so this runs on demand, not as part of `build`:
 *
 *   node scripts/build-fonts.mjs ["<path to desktop app folder>"]
 */
import { readFile, writeFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { compress } from "wawoff2";

const DEFAULT_DESKTOP = resolve(
  process.cwd(),
  "..",
  "bilim hezinisi",
  "bilim hezinisi pc",
);

/** source (relative to the desktop app root) → public/fonts/ target */
const MANIFEST = [
  ["assets/ukijekran.ttf", "ukijekran.woff2"],
  ["assets/fonts/UKIJTuz.ttf", "ukij-tuz.woff2"],
  ["assets/fonts/UKIJTuzBold.ttf", "ukij-tuz-bold.woff2"],
  ["assets/fonts/UKIJTuzTom.ttf", "ukij-tuz-tom.woff2"],
  ["assets/fonts/UKIJTuzKitab.ttf", "ukij-tuz-kitab.woff2"],
  ["assets/fonts/UKIJTuzKitabBold.ttf", "ukij-tuz-kitab-bold.woff2"],
];

const desktopRoot = process.argv[2] ? resolve(process.argv[2]) : DEFAULT_DESKTOP;
const outDir = resolve(process.cwd(), "public", "fonts");

try {
  await stat(desktopRoot);
} catch {
  console.error(`Desktop app folder not found: ${desktopRoot}`);
  console.error("Pass it as an argument: node scripts/build-fonts.mjs \"<path>\"");
  process.exit(1);
}

let totalIn = 0;
let totalOut = 0;

for (const [source, target] of MANIFEST) {
  const ttf = await readFile(join(desktopRoot, source));
  const woff2 = Buffer.from(await compress(ttf));
  await writeFile(join(outDir, target), woff2);
  totalIn += ttf.length;
  totalOut += woff2.length;
  const saved = Math.round((1 - woff2.length / ttf.length) * 100);
  console.log(
    `${target.padEnd(26)} ${(ttf.length / 1024).toFixed(0).padStart(4)} KB → ` +
      `${(woff2.length / 1024).toFixed(0).padStart(4)} KB  (−${saved}%)`,
  );
}

console.log(
  `\ntotal ${(totalIn / 1024).toFixed(0)} KB → ${(totalOut / 1024).toFixed(0)} KB ` +
    `(−${Math.round((1 - totalOut / totalIn) * 100)}%)`,
);
