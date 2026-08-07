import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";

/**
 * HTML → Markdown for the upload pipeline.
 *
 * Markdown keeps the structure that matters in scholarly books (headings,
 * emphasis, lists, quotes, tables) at a fraction of the storage HTML costs,
 * which is what keeps the library inside the Supabase free tier.
 */
export function createTurndown(): TurndownService {
  const turndown = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
    bulletListMarker: "-",
    emDelimiter: "*",
  });

  // GFM adds tables, strikethrough and task lists.
  turndown.use(gfm);

  // Images are dropped rather than inlined: CLAUDE.md forbids base64 blobs in
  // Postgres, and a book's figures would dwarf its text.
  turndown.addRule("dropImages", {
    filter: "img",
    replacement: () => "",
  });

  // Anything non-content that survived sanitizing contributes no book text.
  turndown.addRule("dropNonContent", {
    filter: ["script", "style", "noscript", "iframe", "form", "input", "button"],
    replacement: () => "",
  });

  return turndown;
}

export function htmlToMarkdown(html: string): string {
  return createTurndown().turndown(html);
}
