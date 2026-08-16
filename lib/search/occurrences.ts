/**
 * THE matcher. Every highlight on this site comes from here — search snippets,
 * the reader (plain text and Markdown alike), the match counter, the
 * «ئالدىنقى»/«كېيىنكى» navigator and the in-book search box.
 *
 * The rule is the desktop app's, and it is one sentence: find every occurrence
 * of the WHOLE string the reader typed. Nothing is tokenised, nothing is
 * prefix-matched, nothing is stemmed. `getBookContentSnippets` in the desktop
 * `database.js` is a plain `indexOf` loop, and this is that loop plus the two
 * things a web edition needs — diacritic-insensitivity, and offsets that still
 * point at the real characters afterwards.
 *
 * Before this existed the reader ran one algorithm and the results list ran
 * another (Postgres `ts_headline`), so «نامازغا چا» highlighted a bare «چالايلى»
 * on one screen and not on the other. There is now exactly one answer to
 * "does this text match?", and SQL is held to it (migration 0019).
 *
 * Nothing here produces markup from book text: callers get plain segments and
 * render them as React nodes. `highlightHtml` is the single exception, and it
 * only ever inserts <mark> into HTML that markdown-it generated.
 */
import { ug_normalize_client } from "@/lib/reader/normalize";

/** One occurrence, in ORIGINAL-text coordinates. */
export type Occurrence = { start: number; end: number };

/** A run of text, and which occurrence (if any) it belongs to. */
export type Segment = { text: string; match: boolean; occurrence: number };

/** Shared by both renderers so a mark looks the same wherever it is drawn. */
export const MATCH_CLASS = "rounded bg-ab2 px-0.5 text-ink";
export const ACTIVE_MATCH_CLASS = "match-active px-0.5";

/**
 * Find every occurrence of the entire `query` inside `text`.
 *
 * Normalization is the whole difficulty. `ug_normalize` strips diacritics and
 * unifies alif variants, so an offset measured on the normalized string points
 * at the wrong character in the original — and the more vocalised Arabic a page
 * carries, the further it drifts, until a naive slice lands on characters that
 * do not match and nothing gets highlighted at all.
 *
 * The fix is to normalize and keep a map at the same time: every character of
 * the normalized haystack remembers which original character it came from, so a
 * position found in normalized coordinates translates back exactly. Characters
 * that normalize away (diacritics, tatweel) are skipped in the comparison while
 * their position is still accounted for.
 */
export function findOccurrences(text: string, query: string): Occurrence[] {
  const needle = ug_normalize_client(query).replace(/\s+/g, " ").trim();
  if (!text || !needle) return [];

  // Normalized haystack + the map back to original indices.
  let haystack = "";
  const indexMap: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const normalized = ug_normalize_client(text[i]);
    for (const char of normalized) {
      haystack += char;
      indexMap.push(i);
    }
  }

  // Collapse whitespace runs the same way the needle was collapsed, so a phrase
  // still matches across a line break in the middle of it.
  let collapsed = "";
  const collapsedMap: number[] = [];
  let previousWasSpace = false;
  for (let i = 0; i < haystack.length; i++) {
    const char = haystack[i];
    if (/\s/.test(char)) {
      if (previousWasSpace) continue;
      collapsed += " ";
      collapsedMap.push(indexMap[i]);
      previousWasSpace = true;
    } else {
      collapsed += char;
      collapsedMap.push(indexMap[i]);
      previousWasSpace = false;
    }
  }

  const found: Occurrence[] = [];
  let from = 0;
  for (;;) {
    const at = collapsed.indexOf(needle, from);
    if (at === -1) break;
    const start = collapsedMap[at];
    let end = (collapsedMap[at + needle.length - 1] ?? start) + 1;
    // Carry any combining marks sitting on the final letter into the match — a
    // highlight that stops before a verse's last kasra looks broken.
    while (end < text.length && ug_normalize_client(text[end]) === "") end++;
    found.push({ start, end });
    // Non-overlapping, so one logical occurrence is never highlighted twice.
    from = at + needle.length;
  }
  return found;
}

/**
 * Split `text` into alternating plain and matched segments, each matched one
 * carrying its ordinal within this text — that number is what the reader's
 * ↑ ↓ navigator addresses.
 */
export function toSegments(text: string, query: string): Segment[] {
  const found = findOccurrences(text, query);
  if (found.length === 0) return [{ text, match: false, occurrence: -1 }];

  const segments: Segment[] = [];
  let cursor = 0;
  for (const [ordinal, occurrence] of found.entries()) {
    if (occurrence.start > cursor) {
      segments.push({ text: text.slice(cursor, occurrence.start), match: false, occurrence: -1 });
    }
    segments.push({
      text: text.slice(occurrence.start, occurrence.end),
      match: true,
      occurrence: ordinal,
    });
    cursor = occurrence.end;
  }
  if (cursor < text.length) {
    segments.push({ text: text.slice(cursor), match: false, occurrence: -1 });
  }
  return segments;
}

/** How many times the phrase occurs — the per-page number the counter sums. */
export function countOccurrences(text: string, query: string): number {
  return findOccurrences(text, query).length;
}

// ── Highlighting inside rendered Markdown ───────────────────────────────────
// A Markdown book is HTML by the time it reaches the screen, so its matches
// cannot be React segments. Until now that meant Markdown books — two thirds of
// this library — were not highlighted at all: following a search result opened
// the right page with nothing marked on it.

const ENTITY = /&(?:#(\d+)|#[xX]([0-9a-fA-F]+)|([a-zA-Z][a-zA-Z0-9]*));/g;
const NAMED: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

type Mapped = {
  /** The visible text, entities decoded and tags removed. */
  text: string;
  /** For each character of `text`, the span of `html` it came from. */
  from: number[];
  to: number[];
  /** Which text run (gap between tags) each character belongs to. */
  run: number[];
};

/**
 * Reduce generated HTML to the text a reader actually sees, remembering where
 * every character came from. Tags are skipped; entities decode to the character
 * they stand for while still pointing at the whole `&…;` they were written as.
 */
function mapHtmlText(html: string): Mapped {
  const mapped: Mapped = { text: "", from: [], to: [], run: [] };
  let index = 0;
  let run = 0;

  const push = (value: string, start: number, end: number) => {
    for (const unit of value) {
      mapped.text += unit;
      for (let k = 0; k < unit.length; k++) {
        mapped.from.push(start);
        mapped.to.push(end);
        mapped.run.push(run);
      }
    }
  };

  while (index < html.length) {
    const char = html[index];
    if (char === "<") {
      const close = html.indexOf(">", index);
      if (close === -1) break;
      index = close + 1;
      // Text either side of a tag can never be one match without a break in the
      // markup, so each gap is its own run.
      run++;
      continue;
    }
    if (char === "&") {
      ENTITY.lastIndex = index;
      const found = ENTITY.exec(html);
      if (found && found.index === index) {
        const [raw, decimal, hex, name] = found;
        const decoded = decimal
          ? String.fromCodePoint(Number(decimal))
          : hex
            ? String.fromCodePoint(Number.parseInt(hex, 16))
            : (NAMED[name] ?? raw);
        push(decoded, index, index + raw.length);
        index += raw.length;
        continue;
      }
    }
    push(char, index, index + 1);
    index += 1;
  }

  return mapped;
}

/**
 * Wrap every occurrence of `query` in generated Markdown HTML with <mark>.
 *
 * The input is always markdown-it output (inline HTML disabled), so the only
 * tags present are ones the renderer produced — this never sees a book's own
 * markup. A match that straddles a tag boundary, «نامازغا **چا**قىرىش» say, is
 * wrapped once per side so the nesting stays valid; both halves carry the same
 * `data-match` number, so the navigator still treats them as one occurrence.
 */
export function highlightHtml(html: string, query: string, activeOccurrence = -1): string {
  if (!html || !query.trim()) return html;

  const mapped = mapHtmlText(html);
  const found = findOccurrences(mapped.text, query);
  if (found.length === 0) return html;

  type Insert = { at: number; text: string; opening: boolean };
  const inserts: Insert[] = [];

  for (const [ordinal, occurrence] of found.entries()) {
    const className = ordinal === activeOccurrence ? ACTIVE_MATCH_CLASS : MATCH_CLASS;
    const open = `<mark data-match="${ordinal}" class="${className}">`;

    let pieceStart = occurrence.start;
    for (let i = occurrence.start; i < occurrence.end; i++) {
      const last = i + 1 === occurrence.end;
      if (last || mapped.run[i + 1] !== mapped.run[i]) {
        inserts.push({ at: mapped.from[pieceStart], text: open, opening: true });
        inserts.push({ at: mapped.to[i], text: "</mark>", opening: false });
        pieceStart = i + 1;
      }
    }
  }

  // Rebuild once, in order. A close always precedes an open at the same offset
  // so two adjacent pieces never nest into each other.
  inserts.sort((a, b) => a.at - b.at || Number(a.opening) - Number(b.opening));
  let out = "";
  let cursor = 0;
  for (const insert of inserts) {
    out += html.slice(cursor, insert.at) + insert.text;
    cursor = insert.at;
  }
  return out + html.slice(cursor);
}
