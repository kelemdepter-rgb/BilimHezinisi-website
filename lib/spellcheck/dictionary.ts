/**
 * Uyghur spellcheck core, ported from the desktop's spellcheck.js / symspell.js.
 *
 * The desktop precomputes every delete-variant of all 441,322 words up front —
 * SymSpell's symmetric-delete index. Measured on that dictionary it costs
 * 409 MB of heap and 10.4 s to build, which no phone survives, so the index is
 * not precomputed here. The words live in one packed string with an offset
 * table (10 MB, built in 24 ms); membership is a binary search, and the edit
 * variants are generated outward from the typed word only when someone asks
 * for suggestions. Same idea, same ranking, without the index.
 *
 * Everything in this file is pure so it can be tested without a Worker.
 */

/** Arabic tatweel — stripped before any lookup, as the desktop's SOZGHUCH does. */
const TATWEEL = "ـ";

/** UEYHerpler, verbatim from the desktop (Uyghur.cs line 301). */
export const UYGHUR_LETTERS = "ـئابتجخدرزسشغفقكلمنوىيپچژڭگھۆۇۈۋېەلا";

/** MainForm.cs line 93: words may join with a hyphen. */
export const WORD_PATTERN = new RegExp(
  `[${UYGHUR_LETTERS}'’]+(?:[-]?[${UYGHUR_LETTERS}'’]+)*`,
  "gu",
);

const ONLY_UYGHUR = new RegExp(`^[${UYGHUR_LETTERS}'’-]+$`, "u");

/** The desktop's normalizeForLookup. */
export function normalizeForLookup(word: string): string {
  return String(word ?? "")
    .split(TATWEEL)
    .join("")
    .trim()
    .toLowerCase();
}

/**
 * Whether a token is worth checking at all. Mirrors the desktop's early
 * returns: too short, digits, Latin, or anything carrying a non-Uyghur letter
 * (Quran quotations, Cyrillic) is left alone rather than flagged.
 */
export function isCheckable(word: string): boolean {
  const normalized = normalizeForLookup(word);
  if (!normalized || normalized.length < 2) return false;
  if (/^[\d\s]+$/.test(normalized)) return false;
  if (/^[a-zA-Z'’-]+$/.test(normalized)) return false;
  return ONLY_UYGHUR.test(normalized);
}

/** Every word of a text with its position, for underlining in place. */
export function tokenize(text: string): { word: string; start: number; end: number }[] {
  const out: { word: string; start: number; end: number }[] = [];
  WORD_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = WORD_PATTERN.exec(text)) !== null) {
    if (match[0].length < 2) continue;
    out.push({ word: match[0], start: match.index, end: match.index + match[0].length });
  }
  return out;
}

/** '0' + shared-prefix length, matching scripts/build-spelldict.mjs. */
const PREFIX_BASE = 48;

/**
 * The dictionary in memory: one packed string plus where each word starts.
 * A Set of 441k strings costs several times this and gives nothing back.
 */
export type PackedDictionary = {
  packed: string;
  offsets: Uint32Array;
  size: number;
};

/** Expand the front-coded artifact into the packed form the lookups use. */
export function unpackDictionary(encoded: string): PackedDictionary {
  const lines = encoded.split("\n");
  const offsets = new Uint32Array(lines.length + 1);
  let packed = "";
  let previous = "";
  let count = 0;

  for (const line of lines) {
    if (!line) continue;
    const shared = line.charCodeAt(0) - PREFIX_BASE;
    const word = previous.slice(0, shared) + line.slice(1);
    offsets[count] = packed.length;
    packed += `${word}\n`;
    previous = word;
    count++;
  }
  offsets[count] = packed.length;
  return { packed, offsets, size: count };
}

/** The word at `index`, without its separator. */
export function wordAt(dictionary: PackedDictionary, index: number): string {
  return dictionary.packed.slice(dictionary.offsets[index], dictionary.offsets[index + 1] - 1);
}

/** Binary search over the sorted packed dictionary. */
export function hasWord(dictionary: PackedDictionary, word: string): boolean {
  let low = 0;
  let high = dictionary.size - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const candidate = wordAt(dictionary, mid);
    if (candidate === word) return true;
    if (candidate < word) low = mid + 1;
    else high = mid - 1;
  }
  return false;
}

/**
 * Is this word spelled correctly? Follows the desktop's isCorrect, including
 * its compound rule: «foo-bar» is fine when both halves are words in their own
 * right.
 */
export function isCorrect(
  dictionary: PackedDictionary,
  word: string,
  personal: ReadonlySet<string> = new Set(),
): boolean {
  const normalized = normalizeForLookup(word);
  if (!isCheckable(normalized)) return true;
  if (hasWord(dictionary, normalized) || personal.has(normalized)) return true;

  if (normalized.includes("-")) {
    const parts = normalized.split("-").map((part) => part.trim()).filter(Boolean);
    if (parts.length >= 2 && parts.every((part) => hasWord(dictionary, part) || personal.has(part))) {
      return true;
    }
  }
  return false;
}

/** Every string one edit away — deletions, transpositions, substitutions, insertions. */
export function editsOnce(word: string, alphabet: string): Set<string> {
  const out = new Set<string>();
  const chars = [...word];

  for (let i = 0; i < chars.length; i++) {
    out.add(chars.slice(0, i).concat(chars.slice(i + 1)).join(""));
  }
  for (let i = 0; i < chars.length - 1; i++) {
    const swapped = chars.slice();
    [swapped[i], swapped[i + 1]] = [swapped[i + 1], swapped[i]];
    out.add(swapped.join(""));
  }
  for (let i = 0; i < chars.length; i++) {
    for (const letter of alphabet) {
      if (letter === chars[i]) continue;
      const replaced = chars.slice();
      replaced[i] = letter;
      out.add(replaced.join(""));
    }
  }
  for (let i = 0; i <= chars.length; i++) {
    for (const letter of alphabet) {
      out.add(chars.slice(0, i).concat([letter]).concat(chars.slice(i)).join(""));
    }
  }

  out.delete(word);
  return out;
}

/**
 * Damerau-Levenshtein with early exit, ported from symspell.js. Works on code
 * points rather than UTF-16 units, which matters for Uyghur.
 */
export function editDistance(a: string, b: string, max: number): number {
  if (a === b) return 0;
  const left = [...a];
  const right = [...b];
  if (Math.abs(left.length - right.length) > max) return -1;
  if (left.length === 0) return right.length;
  if (right.length === 0) return left.length;

  let start = 0;
  while (start < left.length && start < right.length && left[start] === right[start]) start++;
  const x = left.slice(start);
  const y = right.slice(start);
  if (x.length === 0) return y.length;
  if (y.length === 0) return x.length;

  let prevPrev = new Array<number>(y.length + 1).fill(0);
  let previous = new Array<number>(y.length + 1);
  let current = new Array<number>(y.length + 1);
  for (let j = 0; j <= y.length; j++) previous[j] = j;

  for (let i = 1; i <= x.length; i++) {
    current[0] = i;
    let best = i;
    for (let j = 1; j <= y.length; j++) {
      const cost = x[i - 1] === y[j - 1] ? 0 : 1;
      let value = Math.min(current[j - 1] + 1, previous[j] + 1, previous[j - 1] + cost);
      if (i > 1 && j > 1 && x[i - 1] === y[j - 2] && x[i - 2] === y[j - 1]) {
        value = Math.min(value, prevPrev[j - 2] + cost);
      }
      current[j] = value;
      if (value < best) best = value;
    }
    if (best > max) return -1;
    const recycled = prevPrev;
    prevPrev = previous;
    previous = current;
    current = recycled;
  }
  return previous[y.length] <= max ? previous[y.length] : -1;
}

export const MAX_SUGGESTIONS = 10;

/**
 * Ranked corrections for one word, in the desktop's order: the hand-built
 * corrections table first (it encodes mistakes people actually make), then
 * dictionary candidates by edit distance.
 *
 * One edit is tried first and answers almost every real typo in about a
 * millisecond; two edits are only explored when that found nothing, because
 * the candidate set grows about two hundredfold.
 */
export function suggest(
  dictionary: PackedDictionary,
  word: string,
  options: { alphabet: string; corrections?: ReadonlyMap<string, string>; limit?: number } = {
    alphabet: UYGHUR_LETTERS,
  },
): string[] {
  const limit = options.limit ?? MAX_SUGGESTIONS;
  const normalized = normalizeForLookup(word);
  if (!normalized || normalized.length < 2) return [];

  const seen = new Set<string>();
  const out: string[] = [];

  const known = options.corrections?.get(normalized);
  if (known) {
    seen.add(known);
    out.push(known);
  }

  const ranked: { term: string; distance: number }[] = [];
  const collect = (candidates: Iterable<string>, distance: number) => {
    for (const candidate of candidates) {
      if (candidate === normalized || seen.has(candidate)) continue;
      if (!hasWord(dictionary, candidate)) continue;
      seen.add(candidate);
      ranked.push({ term: candidate, distance });
    }
  };

  const once = editsOnce(normalized, options.alphabet);
  collect(once, 1);

  if (ranked.length === 0) {
    const twice = new Set<string>();
    for (const candidate of once) {
      for (const further of editsOnce(candidate, options.alphabet)) twice.add(further);
    }
    collect(twice, 2);
  }

  // Shorter edit distance first, then alphabetically so the order is stable.
  ranked.sort((a, b) => a.distance - b.distance || (a.term < b.term ? -1 : 1));
  for (const item of ranked) {
    if (out.length >= limit) break;
    out.push(item.term);
  }
  return out;
}
