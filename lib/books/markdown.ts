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

  /**
   * Tables, including header-less ones.
   *
   * Word (via mammoth) emits <table><tr><td> with no <thead>, and the GFM
   * plugin needs a heading row — so left to itself it drops real documents'
   * tables entirely. This rule runs after the plugin and overrides it: the
   * first row becomes the header, which is how such a table reads anyway.
   */
  turndown.addRule("gfmTables", {
    filter: "table",
    replacement: (_content, node) => {
      const element = node as unknown as {
        querySelectorAll: (selector: string) => ArrayLike<{ children: ArrayLike<{ textContent: string | null }> }>;
      };
      const rows = Array.from(element.querySelectorAll("tr"));
      if (rows.length === 0) return "";

      const cellsOf = (row: { children: ArrayLike<{ textContent: string | null }> }) =>
        Array.from(row.children).map((cell) =>
          (cell.textContent ?? "").replace(/\s+/g, " ").replace(/\|/g, "\\|").trim(),
        );

      const grid = rows.map(cellsOf).filter((cells) => cells.length > 0);
      if (grid.length === 0) return "";
      const width = Math.max(...grid.map((cells) => cells.length));
      const pad = (cells: string[]) => [...cells, ...Array(width - cells.length).fill("")];
      const line = (cells: string[]) => `| ${pad(cells).join(" | ")} |`;

      const [header, ...body] = grid;
      const divider = `| ${Array(width).fill("---").join(" | ")} |`;
      return `\n\n${[line(header), divider, ...body.map(line)].join("\n")}\n\n`;
    },
  });

  return turndown;
}

export function htmlToMarkdown(html: string): string {
  return createTurndown().turndown(html);
}
