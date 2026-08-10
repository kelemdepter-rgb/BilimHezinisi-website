import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { chunkIntoPages, normalizeText } from "@/lib/books/chunk";

/**
 * The desktop migration must page a book exactly the way the upload wizard
 * does, or the same book would read differently depending on how it arrived.
 *
 * The strongest available guarantee is that there is only ONE implementation:
 * scripts/migrate-from-desktop.mjs imports lib/books/chunk.ts directly rather
 * than carrying its own copy. That is asserted here, because a future edit
 * "to avoid the TypeScript import" is exactly how the two would drift apart.
 */
const migrationSource = readFileSync(
  join(process.cwd(), "scripts", "migrate-from-desktop.mjs"),
  "utf8",
);

describe("migration chunking", () => {
  it("imports the wizard's chunker instead of reimplementing it", () => {
    expect(migrationSource).toMatch(
      /import\s*\{\s*chunkIntoPages\s*\}\s*from\s*["']\.\.\/lib\/books\/chunk\.ts["']/,
    );
    // No second implementation hiding in the script.
    expect(migrationSource).not.toMatch(/function\s+chunkIntoPages/);
    expect(migrationSource).not.toMatch(/MIN_PAGE_CHARS\s*=/);
  });

  it("produces identical pages for text shaped like a desktop book", () => {
    // Desktop content is one long plain-text blob: no Markdown, hard-wrapped
    // paragraphs separated by blank lines.
    const paragraph = (seed: number) =>
      `${seed}-باب. ` + "ئۇيغۇر تىلىدىكى جۈملە بولۇپ ھېسابلىنىدۇ. ".repeat(12);
    const book = Array.from({ length: 40 }, (_, index) => paragraph(index + 1)).join("\n\n");

    const wizardPages = chunkIntoPages(book);
    const migrationPages = chunkIntoPages(book);

    expect(migrationPages).toEqual(wizardPages);
    expect(wizardPages.length).toBeGreaterThan(1);
  });

  it("loses no content when paging a desktop-shaped book", () => {
    const book = Array.from(
      { length: 30 },
      (_, index) => `${index}. ` + "ھەدىس مەتنى ".repeat(40),
    ).join("\n\n");

    const rejoined = chunkIntoPages(book).join("\n\n");
    const strip = (value: string) => value.replace(/\s+/g, "");
    expect(strip(rejoined)).toBe(strip(normalizeText(book)));
  });

  it("returns nothing for an empty desktop record", () => {
    expect(chunkIntoPages("")).toEqual([]);
    expect(chunkIntoPages("   \n\n  ")).toEqual([]);
  });
});
