import { toSegments, MATCH_CLASS } from "@/lib/search/occurrences";
import { stripMarkdown } from "@/lib/books/render-markdown";

/**
 * Render a search-result snippet with the query highlighted.
 *
 * The RPC used to return the snippet pre-marked by `ts_headline`, which
 * highlighted whatever LEXEMES it had matched — searching «نامازغا چا» lit up a
 * bare «چالايلى» sitting on its own, because ts_headline had matched the prefix
 * «چا» as a word of its own. So the RPC now returns a plain excerpt and the
 * marking is done here, by the one matcher the whole site shares.
 *
 * Markdown syntax is stripped first so results read as clean prose. The snippet
 * is book text, so it is split into plain segments and rendered as text — never
 * injected as HTML.
 */
/**
 * Until migration 0019 is applied the RPC still returns ts_headline's own
 * `<mark>` tags. Dropping them means the code and the migration can be deployed
 * in either order: with the old function the marks are discarded and the phrase
 * is highlighted correctly anyway, and with the new one there is nothing here to
 * drop. Book text can never contain a real tag — it is stored as Markdown and
 * rendered with inline HTML disabled.
 */
const LEGACY_MARK = /<\/?mark>/g;

export function Snippet({ snippet, query }: { snippet: string; query: string }) {
  const segments = toSegments(stripMarkdown(snippet.replace(LEGACY_MARK, "")), query);
  return (
    <>
      {segments.map((segment, index) =>
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
