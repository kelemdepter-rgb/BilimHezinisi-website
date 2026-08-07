"use client";

import { useMemo } from "react";
import { renderMarkdown } from "@/lib/books/render-markdown";

/**
 * Render a Markdown book page.
 *
 * renderMarkdown runs markdown-it with inline HTML disabled, so a book's own
 * text can never become markup — the only tags present are ones the renderer
 * generated. See lib/books/render-markdown.ts for why that, rather than
 * DOMPurify, is the guarantee on this path.
 *
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
