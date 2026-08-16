import { toSegments, MATCH_CLASS } from "@/lib/search/occurrences";

/**
 * A verse in a search result, with the query highlighted.
 *
 * Highlighting happens here rather than in Postgres on purpose. ts_headline
 * tokenizes the text it is given, so it can only mark up the normalized form —
 * and the normalized form of an aya has had its tashkil stripped and its alif
 * variants folded, which is not how the Quran is written. Matching against the
 * ORIGINAL text client-side keeps the Uthmani spelling intact: findOccurrences
 * works per character, so a match found on the normalized form maps straight
 * back to real offsets in the verse.
 *
 * It is also the same function the books use, so a phrase is one phrase
 * everywhere — the query is never split into words that could light up on their
 * own.
 *
 * The verse is rendered as text segments, never as HTML.
 */
export function AyaText({ text, query }: { text: string; query: string }) {
  return (
    <>
      {toSegments(text, query).map((segment, index) =>
        segment.match ? (
          <mark key={index} className={`${MATCH_CLASS} font-semibold`}>
            {segment.text}
          </mark>
        ) : (
          <span key={index}>{segment.text}</span>
        ),
      )}
    </>
  );
}
