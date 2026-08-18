/**
 * Uyghur spellcheck storage and lookup, ported from the desktop's
 * spellcheck.js / symspell.js.
 *
 * The desktop precomputes every delete-variant of all 441,322 words up front —
 * SymSpell's symmetric-delete index. Measured on that dictionary it costs
 * 409 MB of heap and 10.4 s to build, which no phone survives, so the index is
 * not precomputed here. The words live in one packed buffer with an offset
 * table; membership is a binary search, and the edit variants are generated
 * outward from the typed word only when someone asks for suggestions. Same
 * idea, same answers, without the index.
 *
 * WHY BYTES AND NOT A STRING. The dictionary contains exactly 34 distinct
 * characters — 33 Uyghur letters and the hyphen that joins compounds — counted
 * from the artifact, not assumed. So one byte per character is not a lossy
 * compromise, it is exact, and it removes a doubling that was being paid twice:
 * once on the wire, where UTF-8 spends two bytes on every Uyghur letter, and
 * again in memory, where a JavaScript string spends two more. The codes are
 * assigned in Unicode code-point order, which is what keeps a byte-wise
 * comparison identical to a string comparison and lets the binary search below
 * stay exactly as it was.
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

/**
 * The 34 characters the dictionary holds, in code-point order.
 *
 * Kept in step with scripts/lib/uyghur.mjs by tests/unit/script-parity.test.ts —
 * the build script and the browser must agree on this table exactly, or a word
 * encoded by one would decode to something else in the other.
 */
export const DICT_ALPHABET = "-ئابتجخدرزسشغفقكلمنوىيپچژڭگھۆۇۈۋېە";

/** Codes run 1..34, leaving 0 free to terminate an entry in the artifact. */
const CODE_OF = new Uint8Array(0x700);
for (let index = 0; index < DICT_ALPHABET.length; index++) {
  CODE_OF[DICT_ALPHABET.charCodeAt(index)] = index + 1;
}

/** The word as dictionary codes, or null when it holds a character the dictionary cannot. */
export function encodeWord(word: string): Uint8Array | null {
  const out = new Uint8Array(word.length);
  for (let index = 0; index < word.length; index++) {
    const code = CODE_OF[word.charCodeAt(index)];
    // Not an error: `isCheckable` lets an apostrophe through, and no dictionary
    // word contains one, so such a word is simply absent rather than malformed.
    if (code === 0) return null;
    out[index] = code;
  }
  return out;
}

export function decodeWord(bytes: Uint8Array, start: number, end: number): string {
  let out = "";
  for (let index = start; index < end; index++) out += DICT_ALPHABET[bytes[index] - 1];
  return out;
}

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

/**
 * The dictionary in memory: the words as bytes, where each one starts, and one
 * byte of what we know about each.
 *
 * `flags` packs two things the ranking needs into the byte the artifact already
 * spends per word: the low four bits are the corpus frequency bucket, and the
 * top bit marks a stem the dictionary itself inflects widely. Both are needed
 * per word and neither justifies a second table.
 */
export type PackedDictionary = {
  bytes: Uint8Array;
  offsets: Uint32Array;
  flags: Uint8Array | null;
  size: number;
};

const MAGIC = 0x32444842; // "BHD2" little-endian
const HEADER_BYTES = 16;
const FLAG_FREQUENCIES = 1;

/** Low four bits of the per-word byte: log2 of how often the corpus saw it. */
export const FREQUENCY_MASK = 0x0f;
/** Top bit: the dictionary gives this stem 150+ inflected forms. */
export const PRODUCTIVE_STEM = 0x80;

/**
 * Expand the artifact into the form lookups use.
 *
 * The front coding is undone into a flat byte buffer sized in one allocation —
 * the coded length bounds the expanded length only loosely, so the buffer grows
 * geometrically rather than being guessed exactly. No JavaScript strings are
 * built along the way, which is the whole point: the previous text format
 * created 441,322 of them and peaked at 48 MB doing it.
 */
export function unpackDictionary(buffer: ArrayBuffer): PackedDictionary {
  const source = new Uint8Array(buffer);
  const view = new DataView(buffer);
  if (view.getUint32(0, true) !== MAGIC) {
    throw new Error("Not a BHD2 dictionary — rebuild with scripts/build-spelldict.mjs");
  }
  const size = view.getUint32(4, true);
  const codedLength = view.getUint32(8, true);
  const hasFrequencies = (view.getUint32(12, true) & FLAG_FREQUENCIES) !== 0;

  const offsets = new Uint32Array(size + 1);
  let bytes = new Uint8Array(codedLength * 2);
  let written = 0;
  let count = 0;
  let cursor = HEADER_BYTES;
  const codedEnd = HEADER_BYTES + codedLength;
  let previousStart = 0;

  while (cursor < codedEnd) {
    const shared = source[cursor++];
    // Worst case this entry adds `shared` carried bytes plus the rest of the
    // coded block; doubling until it fits costs at most one extra copy.
    while (written + shared + (codedEnd - cursor) > bytes.length) {
      const grown = new Uint8Array(bytes.length * 2);
      grown.set(bytes.subarray(0, written));
      bytes = grown;
    }
    offsets[count] = written;
    for (let index = 0; index < shared; index++) bytes[written++] = bytes[previousStart + index];
    while (source[cursor] !== 0) bytes[written++] = source[cursor++];
    cursor++;
    previousStart = offsets[count];
    count++;
  }
  offsets[count] = written;

  const flags = hasFrequencies ? source.subarray(codedEnd, codedEnd + size) : null;
  return { bytes: bytes.subarray(0, written), offsets, flags, size: count };
}

/** The word at `index`, as a string. Only for display and tests — lookups stay in bytes. */
export function wordAt(dictionary: PackedDictionary, index: number): string {
  return decodeWord(dictionary.bytes, dictionary.offsets[index], dictionary.offsets[index + 1]);
}

/**
 * Where this word sits in the dictionary, or -1.
 *
 * Byte-wise comparison over a code-point-ordered alphabet is the same ordering
 * the artifact is sorted in, so this is the same binary search it always was.
 */
export function indexOf(dictionary: PackedDictionary, word: string): number {
  const needle = encodeWord(word);
  if (!needle) return -1;

  let low = 0;
  let high = dictionary.size - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const start = dictionary.offsets[mid];
    const end = dictionary.offsets[mid + 1];
    const length = end - start;
    const shortest = length < needle.length ? length : needle.length;

    let comparison = 0;
    for (let index = 0; index < shortest; index++) {
      const difference = dictionary.bytes[start + index] - needle[index];
      if (difference !== 0) {
        comparison = difference;
        break;
      }
    }
    if (comparison === 0) comparison = length - needle.length;

    if (comparison === 0) return mid;
    if (comparison < 0) low = mid + 1;
    else high = mid - 1;
  }
  return -1;
}

export function hasWord(dictionary: PackedDictionary, word: string): boolean {
  return indexOf(dictionary, word) >= 0;
}

/** How often the published library uses this word, as log2 buckets. 0 means never. */
export function frequencyOf(dictionary: PackedDictionary, word: string): number {
  const index = indexOf(dictionary, word);
  if (index < 0 || !dictionary.flags) return 0;
  return dictionary.flags[index] & FREQUENCY_MASK;
}

/** Is this a word the library uses, or a stem the dictionary inflects widely? */
export function isKnownStem(dictionary: PackedDictionary, word: string): boolean {
  const index = indexOf(dictionary, word);
  if (index < 0) return false;
  if (!dictionary.flags) return true;
  const flag = dictionary.flags[index];
  return (flag & FREQUENCY_MASK) > 0 || (flag & PRODUCTIVE_STEM) !== 0;
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
