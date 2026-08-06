/**
 * Text matching and highlight helpers shared by the in-book search and the
 * global search results.
 *
 * Nothing here produces HTML — callers get plain segments and render them as
 * React nodes, so a book's own text can never be injected as markup.
 */
import { ug_normalize_client } from "@/lib/reader/normalize";

export type Segment = { text: string; match: boolean };

export type Match = {
  /** Index into the ORIGINAL text (not the normalized form). */
  start: number;
  end: number;
};

/**
 * Find every occurrence of `query` in `text`, comparing normalized forms so a
 * search for «بىلىم» still matches text carrying Arabic diacritics.
 *
 * Normalization must not shift character offsets, so it is applied per
 * character: each source character maps to itself normalized, and characters
 * that normalize away (diacritics) are skipped in the comparison while their
 * position is still tracked.
 */
export function findMatches(text: string, query: string): Match[] {
  const needle = ug_normalize_client(query).replace(/\s+/g, " ").trim();
  if (!text || !needle) return [];

  // Build a normalized haystack plus a map back to original indices.
  let haystack = "";
  const indexMap: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const normalized = ug_normalize_client(text[i]);
    for (const char of normalized) {
      haystack += char;
      indexMap.push(i);
    }
  }
  // Collapse whitespace runs the same way the needle was collapsed.
  let collapsed = "";
  const collapsedMap: number[] = [];
  let previousWasSpace = false;
  for (let i = 0; i < haystack.length; i++) {
    const char = haystack[i];
    const isSpace = /\s/.test(char);
    if (isSpace) {
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

  const matches: Match[] = [];
  let from = 0;
  for (;;) {
    const at = collapsed.indexOf(needle, from);
    if (at === -1) break;
    const start = collapsedMap[at];
    const lastIndex = at + needle.length - 1;
    const end = (collapsedMap[lastIndex] ?? start) + 1;
    matches.push({ start, end });
    from = at + needle.length;
  }
  return matches;
}

/** Split `text` into alternating plain/match segments for rendering. */
export function toSegments(text: string, query: string): Segment[] {
  const matches = findMatches(text, query);
  if (matches.length === 0) return [{ text, match: false }];

  const segments: Segment[] = [];
  let cursor = 0;
  for (const match of matches) {
    if (match.start > cursor) {
      segments.push({ text: text.slice(cursor, match.start), match: false });
    }
    segments.push({ text: text.slice(match.start, match.end), match: true });
    cursor = match.end;
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor), match: false });
  return segments;
}

/**
 * Parse the `<mark>`-wrapped snippet produced by the search_books RPC into
 * segments. ts_headline emits only <mark>/</mark>, so this deliberately does
 * not accept arbitrary HTML — anything else is treated as literal text.
 */
export function parseMarkedSnippet(snippet: string): Segment[] {
  if (!snippet) return [];
  const segments: Segment[] = [];
  const pattern = /<mark>([\s\S]*?)<\/mark>/g;
  let cursor = 0;
  let found: RegExpExecArray | null;
  while ((found = pattern.exec(snippet)) !== null) {
    if (found.index > cursor) {
      segments.push({ text: snippet.slice(cursor, found.index), match: false });
    }
    segments.push({ text: found[1], match: true });
    cursor = found.index + found[0].length;
  }
  if (cursor < snippet.length) segments.push({ text: snippet.slice(cursor), match: false });
  return segments.filter((segment) => segment.text.length > 0);
}

/** Strip the operators the RPC understands, for highlighting inside the reader. */
export function highlightTermsFromQuery(query: string): string {
  const phrases = [...query.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
  if (phrases.length > 0) return phrases[0];
  return query
    .split(/\s+/)
    .filter((token) => token && token.toUpperCase() !== "OR" && !token.startsWith("-"))
    .join(" ");
}
