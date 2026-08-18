/**
 * Learn what Uyghur writers actually mistype, from the corrections people made.
 *
 * Run:  node scripts/build-edit-weights.mjs
 *
 * Source (READ-ONLY, from the desktop app):
 *   ../bilim hezinisi/bilim hezinisi pc/assets/spellcheck/uyghur_corrections.json
 *
 * Output:
 *   lib/spellcheck/edit-weights.generated.ts             the learned tables
 *   tests/fixtures/spellcheck/heldout-corrections.json   pairs never trained on
 *
 * WHY MULTI-CHARACTER REWRITES. Single-character edit distance treats every
 * substitution as one unit of wrong, so «تەۋەلىنگەن → تەۋەلەنگەن» (ى→ە inside a
 * suffix) and «تەۋەلىنگەن → تەۋەلىنگەت» (a nonsense final consonant) cost the
 * same. They are not the same: «لىن→لەن» is a rewrite Uyghur writers make over
 * and over, and the final-consonant one is not a thing at all. Brill and Moore's
 * answer is to learn weights over aligned SEGMENTS rather than characters, so a
 * rewrite the data shows happening becomes cheap as a unit.
 *
 * THE HELD-OUT SPLIT IS NOT OPTIONAL. Weights learned from a pair and then
 * measured on that same pair prove nothing. One pair in five is set aside before
 * any counting happens and is never looked at again here; the evaluation reads
 * it back from the fixture. The split is a hash of the misspelling, so it is
 * identical on every machine and every rerun without storing a seed.
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const desktop = resolve(repoRoot, "..", "bilim hezinisi", "bilim hezinisi pc", "assets", "spellcheck");

/** One pair in five is held out for measurement. */
const HELD_OUT_MODULUS = 5;
/** Longest segment on either side of a learned rewrite. */
const MAX_SEGMENT = 3;
/** How much surrounding context a rewrite may capture. */
const MAX_CONTEXT = 1;
/** A rewrite must be seen this often to be worth shipping. */
const MIN_REWRITE_COUNT = 3;
/** A single-character confusion must be seen this often. */
const MIN_CONFUSION_COUNT = 3;

/** FNV-1a over code points — stable across machines and Node versions. */
function hash(text) {
  let value = 0x811c9dc5;
  for (const char of text) {
    value ^= char.codePointAt(0);
    value = Math.imul(value, 0x01000193) >>> 0;
  }
  return value;
}

export function isHeldOut(wrong) {
  return hash(wrong) % HELD_OUT_MODULUS === 0;
}

/**
 * Align two words and return the operations, in order.
 *
 * Plain Levenshtein with a backtrace. Ties prefer substitution over an
 * insert/delete pair, which keeps «قالدور→قالدۇر» a single aligned position
 * rather than a deletion sitting next to an insertion.
 */
export function align(from, to) {
  const a = [...from];
  const b = [...to];
  const distance = Array.from({ length: a.length + 1 }, () => new Int32Array(b.length + 1));
  for (let i = 0; i <= a.length; i++) distance[i][0] = i;
  for (let j = 0; j <= b.length; j++) distance[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      distance[i][j] = Math.min(
        distance[i - 1][j - 1] + cost,
        distance[i - 1][j] + 1,
        distance[i][j - 1] + 1,
      );
    }
  }

  const ops = [];
  let i = a.length;
  let j = b.length;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      if (distance[i][j] === distance[i - 1][j - 1] + cost) {
        ops.push({
          kind: cost === 0 ? "match" : "sub",
          from: a[i - 1],
          to: b[j - 1],
          i: i - 1,
          j: j - 1,
        });
        i--;
        j--;
        continue;
      }
    }
    if (i > 0 && distance[i][j] === distance[i - 1][j] + 1) {
      ops.push({ kind: "delete", from: a[i - 1], to: "", i: i - 1, j });
      i--;
      continue;
    }
    ops.push({ kind: "insert", from: "", to: b[j - 1], i, j: j - 1 });
    j--;
  }
  ops.reverse();
  return ops;
}

/**
 * Every segment rewrite this pair demonstrates.
 *
 * A maximal run of non-matching operations is the rewrite itself; it is then
 * grown outward by up to MAX_CONTEXT matching characters on each side, because
 * «ى→ە» on its own is far too broad to be useful while «لىن→لەن» is exactly the
 * pattern worth learning. Every widening is emitted, so the narrow and the
 * contextual form are both counted and the ranking can prefer whichever the
 * data actually supports.
 */
export function rewritesOf(from, to) {
  const a = [...from];
  const b = [...to];
  const ops = align(from, to);
  const out = [];

  let index = 0;
  while (index < ops.length) {
    if (ops[index].kind === "match") {
      index++;
      continue;
    }
    const start = index;
    while (index < ops.length && ops[index].kind !== "match") index++;

    // Where this run of edits sits inside each word.
    let aStart = a.length;
    let aEnd = 0;
    let bStart = b.length;
    let bEnd = 0;
    for (let k = start; k < index; k++) {
      const op = ops[k];
      if (op.kind === "insert") {
        aStart = Math.min(aStart, op.i);
        aEnd = Math.max(aEnd, op.i);
      } else {
        aStart = Math.min(aStart, op.i);
        aEnd = Math.max(aEnd, op.i + 1);
      }
      if (op.kind === "delete") {
        bStart = Math.min(bStart, op.j);
        bEnd = Math.max(bEnd, op.j);
      } else {
        bStart = Math.min(bStart, op.j);
        bEnd = Math.max(bEnd, op.j + 1);
      }
    }
    if (aEnd < aStart) aEnd = aStart;
    if (bEnd < bStart) bEnd = bStart;

    for (let pad = 0; pad <= MAX_CONTEXT; pad++) {
      const aFrom = aStart - pad;
      const aTo = aEnd + pad;
      const bFrom = bStart - pad;
      const bTo = bEnd + pad;
      if (aFrom < 0 || bFrom < 0 || aTo > a.length || bTo > b.length) break;
      const left = a.slice(aFrom, aTo).join("");
      const right = b.slice(bFrom, bTo).join("");
      if (left === right) continue;
      if (a.slice(aFrom, aTo).length > MAX_SEGMENT || b.slice(bFrom, bTo).length > MAX_SEGMENT) break;
      out.push([left, right]);
    }
  }
  return out;
}

/**
 * Count both tables over a set of pairs. Exported so scripts/build-eval-sets.mjs
 * draws its mutations from exactly the confusions this learned from, rather
 * than from a second, silently divergent copy of the same idea.
 */
export function mineWeights(training) {
  const rewrites = new Map();
  const confusions = new Map();
  for (const [wrong, right] of training) {
    for (const [left, rightSide] of rewritesOf(wrong, right)) {
      const key = `${left}\t${rightSide}`;
      rewrites.set(key, (rewrites.get(key) ?? 0) + 1);
    }
    for (const op of align(wrong, right)) {
      if (op.kind !== "sub") continue;
      const key = op.from < op.to ? op.from + op.to : op.to + op.from;
      confusions.set(key, (confusions.get(key) ?? 0) + 1);
    }
  }
  return { rewrites, confusions };
}

/** Split the desktop corrections the same way on every machine. */
export function splitCorrections(corrections) {
  const training = [];
  const heldOut = {};
  for (const [wrong, right] of Object.entries(corrections)) {
    if (isHeldOut(wrong)) heldOut[wrong] = right;
    else training.push([wrong, right]);
  }
  return { training, heldOut };
}

async function main() {
  const correctionsPath = join(desktop, "uyghur_corrections.json");
  if (!existsSync(correctionsPath)) {
    console.error(`\nThe desktop corrections file was not found at\n  ${correctionsPath}\n`);
    process.exit(1);
  }
  const corrections = JSON.parse(await readFile(correctionsPath, "utf-8"));
  const pairs = Object.entries(corrections);

  const { training, heldOut } = splitCorrections(corrections);

  /** segment rewrite "typed\tintended" → times observed */
  const rewrites = new Map();
  /** single-character substitution, unordered pair → times observed */
  const confusions = new Map();

  for (const [wrong, right] of training) {
    for (const [left, rightSide] of rewritesOf(wrong, right)) {
      const key = `${left}\t${rightSide}`;
      rewrites.set(key, (rewrites.get(key) ?? 0) + 1);
    }
    for (const op of align(wrong, right)) {
      if (op.kind !== "sub") continue;
      const key = op.from < op.to ? op.from + op.to : op.to + op.from;
      confusions.set(key, (confusions.get(key) ?? 0) + 1);
    }
  }

  const keptRewrites = [...rewrites.entries()]
    .filter(([key, count]) => {
      if (count < MIN_REWRITE_COUNT) return false;
      // Keep only segments that say something the base edit model cannot
      // already express. A one-for-one substitution is the confusion table's
      // job; a bare insertion or deletion with no context around it is just the
      // insert/delete operation itself, and learning it as "free" would make
      // inserting ر cheap EVERYWHERE rather than in the places writers do it.
      // «ەن -> ەرن» earns its place precisely because it carries the context.
      const [left, right] = key.split("\t");
      return [...left].length > 1 || [...right].length > 1;
    })
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));

  const keptConfusions = [...confusions.entries()]
    .filter(([, count]) => count >= MIN_CONFUSION_COUNT)
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));

  const generated = `/**
 * GENERATED by scripts/build-edit-weights.mjs — do not edit by hand.
 *
 * Learned from ${training.length.toLocaleString("en-US")} of the desktop's ${pairs.length.toLocaleString("en-US")} wrong -> right correction pairs.
 * The other ${Object.keys(heldOut).length.toLocaleString("en-US")} were held out before any counting happened and live in
 * tests/fixtures/spellcheck/heldout-corrections.json, so every number the
 * evaluation reports was measured on pairs these weights never saw.
 *
 * REWRITES are aligned segment pairs of up to ${MAX_SEGMENT} characters, each grown by up
 * to ${MAX_CONTEXT} character of surrounding context, kept when seen ${MIN_REWRITE_COUNT} times or more.
 * CONFUSIONS are single-character substitutions, kept at ${MIN_CONFUSION_COUNT} or more.
 */

/** Aligned segment rewrites: typed form, intended form, times observed. */
export const REWRITES: readonly (readonly [string, string, number])[] = [
${keptRewrites
  .map(([key, count]) => {
    const [left, right] = key.split("\t");
    return `  ["${left}", "${right}", ${count}],`;
  })
  .join("\n")}
];

/** Single-character substitutions, as an unordered pair and a count. */
export const CONFUSIONS: readonly (readonly [string, number])[] = [
${keptConfusions.map(([pair, count]) => `  ["${pair}", ${count}],`).join("\n")}
];

/** How many pairs each table was learned from — quoted in the report. */
export const TRAINING_PAIRS = ${training.length};
export const HELD_OUT_PAIRS = ${Object.keys(heldOut).length};
`;

  await writeFile(join(repoRoot, "lib", "spellcheck", "edit-weights.generated.ts"), generated, "utf-8");
  await mkdir(join(repoRoot, "tests", "fixtures", "spellcheck"), { recursive: true });
  await writeFile(
    join(repoRoot, "tests", "fixtures", "spellcheck", "heldout-corrections.json"),
    `${JSON.stringify(heldOut)}\n`,
    "utf-8",
  );

  const held = Object.keys(heldOut).length;
  console.log(`correction pairs:   ${pairs.length.toLocaleString("en-US")}`);
  console.log(`  trained on:       ${training.length.toLocaleString("en-US")}`);
  console.log(`  held out:         ${held.toLocaleString("en-US")}  (${((held / pairs.length) * 100).toFixed(1)}%)`);
  console.log(
    `segment rewrites:   ${rewrites.size.toLocaleString("en-US")} distinct, ${keptRewrites.length} kept at >=${MIN_REWRITE_COUNT}`,
  );
  console.log(
    `confusion pairs:    ${confusions.size} distinct, ${keptConfusions.length} kept at >=${MIN_CONFUSION_COUNT}`,
  );
  console.log(`\ntop learned rewrites:`);
  for (const [key, count] of keptRewrites.slice(0, 24)) {
    const [left, right] = key.split("\t");
    console.log(`  ${left} -> ${right}   ${count}x`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  await main();
}
