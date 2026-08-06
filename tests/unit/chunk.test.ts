import { describe, expect, it } from "vitest";
import {
  MAX_PAGE_CHARS,
  MIN_PAGE_CHARS,
  chunkIntoPages,
  normalizeText,
} from "@/lib/books/chunk";

/** Content-preservation check: no character of real content lost or duplicated. */
const stripped = (s: string) => s.replace(/\s+/g, "");

function makeParagraph(chars: number, seed: string): string {
  const word = `${seed}ئۇيغۇر`;
  let out = "";
  while (out.length < chars) out += `${word} `;
  return out.trim();
}

describe("normalizeText", () => {
  it("normalizes line endings and collapses blank-line runs", () => {
    expect(normalizeText("a\r\n\r\n\r\n\r\nb")).toBe("a\n\nb");
    expect(normalizeText("  \n\n hello \n\n  ")).toBe("hello");
  });
});

describe("chunkIntoPages", () => {
  it("returns no pages for empty or whitespace-only input", () => {
    expect(chunkIntoPages("")).toEqual([]);
    expect(chunkIntoPages("   \n\n  \t ")).toEqual([]);
  });

  it("keeps a short book as a single page", () => {
    const text = "بىرىنچى پاراگراف.\n\nئىككىنچى پاراگراف.";
    expect(chunkIntoPages(text)).toEqual([text]);
  });

  it("splits on paragraph boundaries and respects the size range", () => {
    const paragraphs = Array.from({ length: 40 }, (_, i) => makeParagraph(400, `p${i}`));
    const pages = chunkIntoPages(paragraphs.join("\n\n"));

    expect(pages.length).toBeGreaterThan(1);
    for (const page of pages) {
      expect(page.length).toBeLessThanOrEqual(MAX_PAGE_CHARS);
    }
    // Every page except the last should have reached the minimum.
    for (const page of pages.slice(0, -1)) {
      expect(page.length).toBeGreaterThanOrEqual(MIN_PAGE_CHARS);
    }
  });

  it("never breaks a word", () => {
    const paragraphs = Array.from({ length: 30 }, (_, i) => makeParagraph(500, `w${i}`));
    const pages = chunkIntoPages(paragraphs.join("\n\n"));
    for (const page of pages) {
      expect(page.startsWith(" ")).toBe(false);
      expect(page.endsWith(" ")).toBe(false);
      // Pages are built from whole words, so no page may begin or end mid-token.
      expect(/^\S/.test(page)).toBe(true);
      expect(/\S$/.test(page)).toBe(true);
    }
  });

  it("loses no content when chunking many paragraphs", () => {
    const paragraphs = Array.from({ length: 60 }, (_, i) => makeParagraph(350, `c${i}`));
    const text = paragraphs.join("\n\n");
    const pages = chunkIntoPages(text);
    expect(stripped(pages.join(""))).toBe(stripped(text));
  });

  it("splits a single oversized paragraph on sentence boundaries", () => {
    const sentence = `${makeParagraph(200, "s")}.`;
    const huge = Array.from({ length: 40 }, () => sentence).join(" ");
    const pages = chunkIntoPages(huge);

    expect(pages.length).toBeGreaterThan(1);
    for (const page of pages) {
      expect(page.length).toBeLessThanOrEqual(MAX_PAGE_CHARS);
    }
    expect(stripped(pages.join(""))).toBe(stripped(huge));
    // Each page but the last should end at a sentence terminator.
    for (const page of pages.slice(0, -1)) {
      expect(/[.!?۔؟]$/.test(page)).toBe(true);
    }
  });

  it("loses no content when one sentence exceeds a whole page", () => {
    const monster = makeParagraph(MAX_PAGE_CHARS * 3, "m");
    const pages = chunkIntoPages(monster);
    expect(pages.length).toBeGreaterThan(1);
    for (const page of pages) {
      expect(page.length).toBeLessThanOrEqual(MAX_PAGE_CHARS);
    }
    expect(stripped(pages.join(""))).toBe(stripped(monster));
  });

  it("honours custom bounds", () => {
    const paragraphs = Array.from({ length: 20 }, (_, i) => makeParagraph(120, `x${i}`));
    const pages = chunkIntoPages(paragraphs.join("\n\n"), { min: 300, max: 500 });
    for (const page of pages) expect(page.length).toBeLessThanOrEqual(500);
    expect(stripped(pages.join(""))).toBe(stripped(paragraphs.join("\n\n")));
  });
});
