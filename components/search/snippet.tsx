import { parseMarkedSnippet } from "@/lib/reader/highlight";

/**
 * Render the RPC's `<mark>`-highlighted snippet as React nodes.
 *
 * The snippet contains book text, so it is parsed into plain segments and
 * rendered as text — never injected as HTML.
 */
export function Snippet({ snippet }: { snippet: string }) {
  const segments = parseMarkedSnippet(snippet);
  return (
    <>
      {segments.map((segment, index) =>
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
