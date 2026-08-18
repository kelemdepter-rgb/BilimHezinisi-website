/**
 * The binary dictionary format, writer side.
 *
 * The dictionary contains exactly 34 distinct characters — 33 Uyghur letters
 * and the hyphen — so one byte per character is not a compromise, it is exact.
 * The text artifact this replaces stored the same words as UTF-8, where every
 * Uyghur letter costs two bytes, and the browser then held them in a JavaScript
 * string, where every one costs two more. Both halves of that doubling go away
 * for free.
 *
 * The encoding is TOTAL by construction: `encodeWord` throws on any character
 * outside the table rather than skipping or substituting it, so a dictionary
 * that cannot be represented fails the build instead of shipping with quietly
 * corrupted words. `scripts/build-spelldict.mjs` then decodes the whole file
 * back and asserts byte-for-byte equality with the input before writing it.
 *
 *   BHD2 layout
 *     0   "BHD2"                      magic
 *     4   u32  wordCount
 *     8   u32  codedLength            bytes in the front-coded block
 *     12  u32  flags                  bit 0: a frequency table follows
 *     16  front-coded block           per word: [shared u8][codes 1..34][0x00]
 *     ..  frequency block             wordCount bytes, one bucket per word
 *
 * Front coding survives the change and gets slightly better at it: the old text
 * format wrote the shared-prefix length as a single character offset from '0',
 * which capped it at 74, and a full byte has no such ceiling.
 */
import { DICT_ALPHABET } from "./uyghur.mjs";

export const MAGIC = "BHD2";
export const HEADER_BYTES = 16;
export const FLAG_FREQUENCIES = 1;

/** Codes run 1..34 so that 0 is free to terminate each entry. */
const CODE_OF = new Map(DICT_ALPHABET.map((char, index) => [char, index + 1]));

export function encodeWord(word) {
  const out = [];
  for (const char of word) {
    const code = CODE_OF.get(char);
    if (code === undefined) {
      throw new Error(
        `Character outside the dictionary alphabet: ${JSON.stringify(char)} ` +
          `(U+${char.codePointAt(0).toString(16).toUpperCase().padStart(4, "0")}) in ${JSON.stringify(word)}. ` +
          "Add it to DICT_ALPHABET in scripts/lib/uyghur.mjs, or drop the word — never encode it lossily.",
      );
    }
    out.push(code);
  }
  return out;
}

export function decodeWord(bytes) {
  let out = "";
  for (const byte of bytes) out += DICT_ALPHABET[byte - 1];
  return out;
}

/**
 * Pack a sorted word list, and optionally one frequency bucket per word.
 *
 * `frequencies` is indexed the same way as `sortedWords`, which is only safe
 * because both are produced together by the build script from the same list.
 */
export function packDictionary(sortedWords, frequencies = null) {
  const coded = [];
  let previous = [];

  for (const word of sortedWords) {
    const codes = encodeWord(word);
    let shared = 0;
    while (shared < previous.length && shared < codes.length && previous[shared] === codes[shared]) {
      shared++;
    }
    // A byte holds 0..255; Uyghur words never come close, but assert rather
    // than wrap silently if that ever stops being true.
    if (shared > 255) throw new Error(`Shared prefix ${shared} exceeds one byte in ${word}`);
    coded.push(shared);
    for (let i = shared; i < codes.length; i++) coded.push(codes[i]);
    coded.push(0);
    previous = codes;
  }

  const withFrequencies = frequencies !== null;
  if (withFrequencies && frequencies.length !== sortedWords.length) {
    throw new Error(`Frequency table has ${frequencies.length} entries for ${sortedWords.length} words`);
  }

  const total = HEADER_BYTES + coded.length + (withFrequencies ? sortedWords.length : 0);
  const buffer = new Uint8Array(total);
  const view = new DataView(buffer.buffer);
  for (let i = 0; i < 4; i++) buffer[i] = MAGIC.charCodeAt(i);
  view.setUint32(4, sortedWords.length, true);
  view.setUint32(8, coded.length, true);
  view.setUint32(12, withFrequencies ? FLAG_FREQUENCIES : 0, true);
  buffer.set(coded, HEADER_BYTES);
  if (withFrequencies) buffer.set(frequencies, HEADER_BYTES + coded.length);
  return buffer;
}

/** The inverse, so the build can prove the round trip before shipping. */
export function unpackDictionary(buffer) {
  for (let i = 0; i < 4; i++) {
    if (buffer[i] !== MAGIC.charCodeAt(i)) throw new Error("Not a BHD2 dictionary");
  }
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const count = view.getUint32(4, true);
  const codedLength = view.getUint32(8, true);
  const flags = view.getUint32(12, true);

  const words = [];
  let previous = [];
  let cursor = HEADER_BYTES;
  const codedEnd = HEADER_BYTES + codedLength;
  while (cursor < codedEnd) {
    const shared = buffer[cursor++];
    const codes = previous.slice(0, shared);
    while (buffer[cursor] !== 0) codes.push(buffer[cursor++]);
    cursor++;
    words.push(decodeWord(codes));
    previous = codes;
  }

  const frequencies =
    flags & FLAG_FREQUENCIES ? buffer.subarray(codedEnd, codedEnd + count) : null;
  return { words, frequencies };
}
