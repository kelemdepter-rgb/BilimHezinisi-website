import { parseMarkedSnippet } from "@/lib/reader/highlight";

/**
 * Render the `<mark>`-highlighted snippet from search_quran as React nodes.
 *
 * Deliberately does NOT run the book pipeline's stripMarkdown: Quran text is
 * not Markdown, and those rules would eat a leading dash or a table pipe out
 * of a real verse. ts_headline emits only <mark>/</mark>, and the parser
 * treats everything else as literal text, so no verse can inject markup.
 */
export function AyaSnippet({ snippet }: { snippet: string }) {
  return (
    <>
      {parseMarkedSnippet(snippet).map((segment, index) =>
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
