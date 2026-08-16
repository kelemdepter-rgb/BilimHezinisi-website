"use client";

import { useMemo } from "react";
import { renderMarkdown } from "@/lib/books/render-markdown";
import { highlightHtml } from "@/lib/search/occurrences";

/**
 * Render a Markdown book page, with the searched phrase marked.
 *
 * renderMarkdown runs markdown-it with inline HTML disabled, so a book's own
 * text can never become markup — the only tags present are ones the renderer
 * generated. See lib/books/render-markdown.ts for why that, rather than
 * DOMPurify, is the guarantee on this path. highlightHtml then inserts <mark>
 * into that generated HTML, and inserts nothing else.
 *
 * The marking is not cosmetic. Two thirds of this library is stored as
 * Markdown, and this path used to render no marks at all: following a search
 * result opened the right page and left the reader to find the phrase by eye.
 *
 * Styling lives in the `.md-body` rules in globals.css, which use the
 * manuscript tokens and inherit the reader's font controls.
 */
export function MarkdownContent({
  source,
  className,
  query = "",
  activeOccurrence = -1,
}: {
  source: string;
  className?: string;
  /** The phrase to mark. Empty means "render the page as it is". */
  query?: string;
  /** Which occurrence on THIS page the navigator is sitting on. */
  activeOccurrence?: number;
}) {
  const html = useMemo(
    () => highlightHtml(renderMarkdown(source), query, activeOccurrence),
    [source, query, activeOccurrence],
  );
  return (
    <div
      className={className ? `md-body ${className}` : "md-body"}
      // markdown-it never emits the book's own HTML, and highlightHtml only
      // adds <mark> to what markdown-it produced.
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
