/**
 * Markdown syntax removed, leaving the prose.
 *
 * In its own module, away from the renderer, for one reason: the renderer
 * constructs a markdown-it instance at import time, and three CLIENT bundles
 * need only this function — the search results, the notebook's source panel
 * and the batch importer. Importing it from the renderer dragged the whole
 * parser into each of them for a handful of regular expressions.
 *
 * Snippets arrive as plain book text — the RPC stopped pre-marking them in
 * migration 0019, because only the shared matcher decides what is a match. So
 * there is nothing to protect here any more, and the placeholder scheme that
 * used to park <mark> tags is gone with it. That scheme also swallowed any bare
 * number it happened to land on («بۇخارى: 567» lost its 567), which the same
 * removal fixes.
 */
export function stripMarkdown(input: string): string {
  if (!input) return "";

  return input
    // fenced code blocks → their contents
    .replace(/```[^\n]*\n?([\s\S]*?)```/g, "$1")
    .replace(/~~~[^\n]*\n?([\s\S]*?)~~~/g, "$1")
    // images (dropped at import, but a .md source may still carry them)
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    // links → their label
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    // headings, blockquotes and list markers at line start
    .replace(/^[ \t]{0,3}#{1,6}[ \t]+/gm, "")
    .replace(/^[ \t]{0,3}>[ \t]?/gm, "")
    .replace(/^[ \t]{0,3}([-*+]|\d+[.)])[ \t]+/gm, "")
    // horizontal rules and table pipes/alignment rows
    .replace(/^[ \t]{0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/gm, "")
    .replace(/^[ \t]*\|?[ \t]*:?-{2,}:?[ \t]*(\|[ \t]*:?-{2,}:?[ \t]*)*\|?[ \t]*$/gm, "")
    .replace(/[ \t]*\|[ \t]*/g, " ")
    // emphasis, strikethrough and inline code
    .replace(/(\*\*\*|___)(.*?)\1/g, "$2")
    .replace(/(\*\*|__)(.*?)\1/g, "$2")
    .replace(/(\*|_)(.*?)\1/g, "$2")
    .replace(/~~(.*?)~~/g, "$1")
    .replace(/`([^`]*)`/g, "$1")
    // leftover escapes
    .replace(/\\([\\`*_{}[\]()#+\-.!|>~])/g, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{2,}/g, "\n")
    .trim();
}
