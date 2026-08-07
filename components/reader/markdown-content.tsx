"use client";

import { useMemo } from "react";
import { renderMarkdown } from "@/lib/books/render-markdown";

/**
 * Render a Markdown book page.
 *
 * The HTML is produced with inline HTML disabled and then run through the
 * shared DOMPurify allow-list, so nothing a book contains can become markup.
 * Styling lives in the `.md-body` rules in globals.css, which use the
 * manuscript tokens and inherit the reader's font controls.
 */
export function MarkdownContent({ source, className }: { source: string; className?: string }) {
  const html = useMemo(() => renderMarkdown(source), [source]);
  return (
    <div
      className={className ? `md-body ${className}` : "md-body"}
      // Sanitized above; markdown-it never emits the book's own HTML.
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
