import { toSegmentsForTerms } from "@/lib/reader/highlight";

/**
 * A verse in a search result, with the query highlighted.
 *
 * Highlighting happens here rather than in Postgres on purpose. ts_headline
 * tokenizes the text it is given, so it can only mark up the normalized form —
 * and the normalized form of an aya has had its tashkil stripped and its alif
 * variants folded, which is not how the Quran is written. Matching the terms
 * against the ORIGINAL text client-side keeps the Uthmani spelling intact:
 * ug_normalize_client works per character, so a match found on the normalized
 * form maps straight back to real offsets in the verse.
 *
 * The verse is rendered as text segments, never as HTML.
 */
export function AyaText({ text, terms }: { text: string; terms: string[] }) {
  return (
    <>
      {toSegmentsForTerms(text, terms).map((segment, index) =>
        segment.match ? (
          <mark key={index} className="rounded bg-ab2 px-0.5 font-semibold text-ink">
            {segment.text}
          </mark>
        ) : (
          <span key={index}>{segment.text}</span>
        ),
      )}
    </>
  );
}
