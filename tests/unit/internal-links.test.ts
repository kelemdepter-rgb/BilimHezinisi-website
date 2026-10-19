import { describe, expect, it } from "vitest";
import { extractFromFile } from "@/lib/books/extract";
import { chunkIntoPages } from "@/lib/books/chunk";
import { outlineFromPages, type BookOutline, type OutlineEntry } from "@/lib/reader/outline";
import {
  buildLinkIndex,
  fragmentKey,
  headingKey,
  labelPhrase,
  resolveInternalLink,
  type LinkTarget,
} from "@/lib/reader/internal-links";
import { LINKED_ENDNOTE, LINKED_FOOTNOTE, LINKED_TOC, linkedBookRows } from "../fixtures/linked-book";
import { TOC_DOCX_CHAPTERS, buildTocDocx } from "../fixtures/docx";

/**
 * The in-book link resolver (PROMPT-51): where a table-of-contents entry or a
 * note link goes, worked out from the stored text alone. Every text here is
 * invented.
 */

function outlineOf(pages: string[]): BookOutline {
  return outlineFromPages(pages.map((content, index) => ({ page_no: index + 1, content })));
}

/** Resolve a fragment as a click on its first link would. */
function resolver(pages: string[] | BookOutline) {
  const outline = Array.isArray(pages) ? outlineOf(pages) : pages;
  const index = buildLinkIndex(outline);
  return (fragment: string, label = "", page = 1) => resolveInternalLink(index, { fragment, label, page });
}

const heading = (page: number, text: string, nth = 0): LinkTarget => ({
  kind: "heading",
  page,
  text: headingKey(text),
  nth,
});

describe("the reported shape", () => {
  const resolve = resolver(linkedBookRows().map((row) => row.content));

  it("sends every contents entry with a heading to that heading, the repeated title in order", () => {
    for (const entry of LINKED_TOC.filter((item) => item.heading)) {
      const nth = 0;
      expect(resolve(entry.fragment), entry.label).toEqual(heading(entry.page!, entry.heading!, nth));
    }
    // Two entries read «خۇلاسە»; the second goes to the second chapter of that name.
    expect(resolve("QBH3")).toEqual(heading(12, "خۇلاسە"));
    expect(resolve("QBH5")).toEqual(heading(24, "خۇلاسە"));
  });

  it("joins an entry to the heading that begins it", () => {
    expect(resolve("QBH6")).toEqual(heading(27, "باھار كەلگەندە"));
  });

  it("finds the first chapter on the contents' own last page, below its last link", () => {
    expect(resolve("QBH1")).toEqual(heading(2, "تاغ باغرىدىكى يېزا"));
  });

  it("returns null for a target that is only body text, and for one that is nowhere", () => {
    expect(resolve("QBH8")).toBeNull();
    expect(resolve("QBH9")).toBeNull();
  });

  it("follows a footnote and an endnote both ways", () => {
    expect(resolve(LINKED_FOOTNOTE.mark)).toEqual({ kind: "note", page: LINKED_FOOTNOTE.notePage, fragment: LINKED_FOOTNOTE.back, nth: 0 });
    expect(resolve(LINKED_FOOTNOTE.back)).toEqual({ kind: "note", page: LINKED_FOOTNOTE.textPage, fragment: LINKED_FOOTNOTE.mark, nth: 0 });
    expect(resolve(LINKED_ENDNOTE.mark)).toEqual({ kind: "note", page: LINKED_ENDNOTE.notePage, fragment: LINKED_ENDNOTE.back, nth: 0 });
    expect(resolve(LINKED_ENDNOTE.back)).toEqual({ kind: "note", page: LINKED_ENDNOTE.textPage, fragment: LINKED_ENDNOTE.mark, nth: 0 });
  });
});

describe("labels", () => {
  it("drops a printed page number inside the label: a tab, dot leaders, Arabic-Indic digits", () => {
    const resolve = resolver([
      "[1\\. بىرىنچى\t12](#a)\n\n[2\\. ئىككىنچى ..... 15](#b)\n\n[٣. ئۈچىنچى … ١٨](#c)\n\n[4\\. تۆتىنچى 21](#d)",
      "# بىرىنچى\n\n# ئىككىنچى\n\n# ئۈچىنچى\n\n# تۆتىنچى",
    ]);
    expect(resolve("a")).toEqual(heading(2, "بىرىنچى"));
    expect(resolve("b")).toEqual(heading(2, "ئىككىنچى"));
    expect(resolve("c")).toEqual(heading(2, "ئۈچىنچى"));
    expect(resolve("d")).toEqual(heading(2, "تۆتىنچى"));
  });

  it("keeps a number that belongs to the title", () => {
    const resolve = resolver(["[سۈرە 2](#a)\n\n[1-باب](#b)", "# سۈرە 1\n\n# سۈرە 2\n\n# 2-باب\n\n# 1-باب"]);
    expect(resolve("a")).toEqual(heading(2, "سۈرە 2"));
    expect(resolve("b")).toEqual(heading(2, "1-باب"));
  });

  it("matches a heading written with an escaped enumeration, with or without one in the label", () => {
    const resolve = resolver(["[1\\. كىرىش](#a)\n\n[ئاخىرى](#b)", "# 1\\. كىرىش\n\n## 2\\. ئاخىرى"]);
    expect(resolve("a")).toEqual(heading(2, "1. كىرىش"));
    expect(resolve("b")).toEqual(heading(2, "2. ئاخىرى"));
  });

  it("ignores diacritics, alif forms, tatweel, zero-width and bidi marks", () => {
    const resolve = resolver([
      "[قُرْآن](#a)\n\n[\u200Fإيمان\u200C](#b)\n\n[كــىتاب](#c)",
      "# قرئان\n\n# ايمان\n\n# \u200Eكىتاب",
    ]);
    // «آ» unifies with «ا», not with «ئا» — so «قُرْآن» is not «قرئان».
    expect(resolve("a")).toBeNull();
    expect(resolve("b")).toEqual(heading(2, "ايمان"));
    expect(resolve("c")).toEqual(heading(2, "كىتاب"));
    const resolveAlif = resolver(["[قُرْآن](#a)", "# قران"]);
    expect(resolveAlif("a")).toEqual(heading(2, "قران"));
  });

  it("reads emphasis, inline code and entities in a heading the way the page shows them", () => {
    const resolve = resolver(["[بىرىنچى باب: كىرىش](#a)\n\n[A & B](#b)", "# **بىرىنچى باب**: `كىرىش` ##\n\n# A &amp; B"]);
    expect(resolve("a")).toEqual(heading(2, "بىرىنچى باب: كىرىش"));
    expect(resolve("b")).toEqual(heading(2, "A & B"));
  });
});

describe("order", () => {
  it("maps repeated chapter titles in order, nth counted on the page", () => {
    const resolve = resolver([
      "[1\\. خۇلاسە](#a)\n\n[2\\. خۇلاسە](#b)\n\n[3\\. خۇلاسە](#c)",
      "# خۇلاسە\n\nتېكىست\n\n# خۇلاسە",
      "# خۇلاسە",
    ]);
    expect(resolve("a")).toEqual(heading(2, "خۇلاسە", 0));
    expect(resolve("b")).toEqual(heading(2, "خۇلاسە", 1));
    expect(resolve("c")).toEqual(heading(3, "خۇلاسە", 0));
  });

  it("handles contents printed at the end of the book", () => {
    const resolve = resolver([
      "# خۇلاسە\n\nتېكىست",
      "# باشلىنىش\n\nتېكىست",
      "# خۇلاسە\n\nتېكىست",
      "# مۇندەرىجە\n\n[1\\. خۇلاسە](#a) 1\n\n[2\\. باشلىنىش](#b) 2\n\n[3\\. خۇلاسە](#c) 3",
    ]);
    expect(resolve("a")).toEqual(heading(1, "خۇلاسە"));
    expect(resolve("b")).toEqual(heading(2, "باشلىنىش"));
    expect(resolve("c")).toEqual(heading(3, "خۇلاسە"));
  });

  it("follows a reference back to an earlier chapter", () => {
    const resolve = resolver([
      "# بىرىنچى باب\n\nتېكىست",
      "# ئىككىنچى باب\n\nتېكىست",
      "# ئۈچىنچى باب\n\n[ئىككىنچى باب](#back2) ۋە [بىرىنچى باب](#back1) دا دېيىلگەندەك.",
    ]);
    expect(resolve("back2")).toEqual(heading(2, "ئىككىنچى باب"));
    expect(resolve("back1")).toEqual(heading(1, "بىرىنچى باب"));
  });

  it("prefers a heading after the link to an earlier one of the same name", () => {
    const resolve = resolver(["# خۇلاسە\n\n[خۇلاسە](#a)", "# خۇلاسە"]);
    expect(resolve("a")).toEqual(heading(2, "خۇلاسە"));
  });

  it("does not move the cursor on a prefix match", () => {
    const resolve = resolver([
      "[1\\. باھار كەلگەندە ۋە يېڭى ئۈمىدلەر](#a)\n\n[2\\. قىش](#b)",
      "# قىش\n\n# باھار كەلگەندە",
    ]);
    // «a» only joins «باھار كەلگەندە» by its beginning, after «قىش»: «b» must
    // still find «قىش», which comes before it.
    expect(resolve("a")).toEqual(heading(2, "باھار كەلگەندە"));
    expect(resolve("b")).toEqual(heading(2, "قىش"));
  });

  it("needs at least 8 characters to call a prefix a match", () => {
    const resolve = resolver(["[قىش كېچىسى](#a)", "# قىش"]);
    expect(resolve("a")).toBeNull();
  });
});

describe("fragments", () => {
  it("resolves GitHub-style slugs, repeats numbered", () => {
    const resolve = resolver([
      "[بىرىنچى](#بىرىنچى-باب) [ئىككىنچى](#getting-started-1) [ئۈچىنچى](#Getting-Started)",
      "# بىرىنچى باب\n\n## Getting Started!\n\n## Getting Started",
    ]);
    expect(resolve("بىرىنچى-باب")).toEqual(heading(2, "بىرىنچى باب"));
    // Both read «getting started» once punctuation is gone: the second on its page.
    expect(resolve("getting-started-1")).toEqual(heading(2, "Getting Started", 1));
    expect(resolve("Getting-Started")).toEqual(heading(2, "Getting Started!"));
  });

  it("compares the DOM's percent-encoded fragment with the stored one", () => {
    const resolve = resolver(["[باب](#بىرىنچى-باب)", "# بىرىنچى باب"]);
    expect(resolve(encodeURIComponent("بىرىنچى-باب"))).toEqual(heading(2, "بىرىنچى باب"));
    expect(fragmentKey("%E2%86%91%zz")).toBe("%E2%86%91%zz");
    expect(fragmentKey("a%20b")).toBe("a b");
  });

  it("reads escaped characters in a stored fragment", () => {
    const resolve = resolver(["[x](#QBH\\(2\\))", "# x"]);
    expect(resolve("QBH(2)")).toEqual(heading(2, "x"));
  });

  it("ignores a heading inside a code block", () => {
    const resolve = resolver(["[1\\. باشلىنىش](#a)\n\n```\n# باشلىنىش\n```", "~~~\n# باشلىنىش\n~~~\n\n# باشلىنىش"]);
    expect(resolve("a")).toEqual(heading(2, "باشلىنىش"));
  });

  it("ends a code block left open at the end of its page, as the renderer does", () => {
    const resolve = resolver(["[x](#a)\n\n```\n# يوق", "# باشلىنىش"]);
    expect(resolve("a", "باشلىنىش")).toBeNull();
    const resolveLabel = resolver(["[باشلىنىش](#a)\n\n```\n# باشلىنىش", "# باشلىنىش"]);
    expect(resolveLabel("a")).toEqual(heading(2, "باشلىنىش"));
  });

  it("resolves an unknown fragment from the clicked label, forward from its page first", () => {
    const resolve = resolver(["# خۇلاسە", "تېكىست", "# خۇلاسە"]);
    expect(resolve("_Toc999", "5. خۇلاسە", 2)).toEqual(heading(3, "خۇلاسە"));
    expect(resolve("_Toc999", "خۇلاسە", 3)).toEqual(heading(3, "خۇلاسە"));
    expect(resolve("_Toc998", "يوق نەرسە", 1)).toBeNull();
  });

  it("still resolves what a capped outline holds", () => {
    const full = outlineOf(["[1\\. بىرىنچى](#a)\n\n[2\\. ئىككىنچى](#b)", "# بىرىنچى\n\n# ئىككىنچى"]);
    // Keep the first link and the first heading only, as if the cap fell there.
    const capped: BookOutline = {
      v: 1,
      capped: true,
      entries: full.entries.filter((entry: OutlineEntry) => entry[3] !== "ئىككىنچى" && entry[3] !== "b"),
    };
    const resolve = resolver(capped);
    expect(resolve("a")).toEqual(heading(2, "بىرىنچى"));
    // Not in the outline: worked out from the label, and the heading is not there either.
    expect(resolve("b", "2. ئىككىنچى", 1)).toBeNull();
  });
});

describe("the phrase to search for when nothing resolves", () => {
  it("is the label without its enumeration and page number", () => {
    expect(labelPhrase("8. ئالتۇن قۇملۇق ھېكايىسى")).toBe("ئالتۇن قۇملۇق ھېكايىسى");
    expect(labelPhrase("\u200F١٢- قىش كېچىلىرى ..... ٤٥")).toBe("قىش كېچىلىرى");
    expect(labelPhrase("كىرىش\t3")).toBe("كىرىش");
    expect(labelPhrase("2024")).toBe("2024");
  });
});

describe("speed", () => {
  it("resolves 2,000 headings and 2,000 links in under 50 ms", () => {
    const entries: OutlineEntry[] = [];
    const titles = Array.from({ length: 2000 }, (_, index) => `${index % 7 === 0 ? "خۇلاسە" : "باب"} ${index}`);
    for (const [index, title] of titles.entries()) entries.push([1 + Math.floor(index / 20), "l", `${index + 1}\\. ${title}`, `_Toc${index}`]);
    for (const [index, title] of titles.entries()) entries.push([200 + Math.floor(index / 5), "h", 1, title]);
    const outline: BookOutline = { v: 1, capped: false, entries };

    // The best of three: the unit files run in parallel, PGlite among them, and
    // a moment of someone else's CPU is not this code being slow.
    let fastest = Number.POSITIVE_INFINITY;
    for (let run = 0; run < 3; run++) {
      const started = performance.now();
      const index = buildLinkIndex(outline);
      const last = resolveInternalLink(index, { fragment: "_Toc1999", label: "", page: 1 });
      fastest = Math.min(fastest, performance.now() - started);
      expect(last).toEqual(heading(200 + Math.floor(1999 / 5), titles[1999], 0));
    }
    expect(fastest).toBeLessThan(50);
  });
});

describe("a Word file, through the real import", () => {
  it("lands every contents entry and the footnote on the right page", async () => {
    const file = new File([new Uint8Array(buildTocDocx())], "مۇندەرىجە.docx", {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
    const extracted = await extractFromFile(file);
    expect(extracted.contentFormat).toBe("markdown");
    const pages = chunkIntoPages(extracted.text);
    expect(pages.length).toBeGreaterThan(3);

    const pageOf = (needle: string) => pages.findIndex((page) => page.includes(needle)) + 1;
    const resolve = resolver(pages);

    for (const chapter of TOC_DOCX_CHAPTERS) {
      const target = resolve(chapter.anchor);
      expect(target, chapter.entry).toEqual(heading(pageOf(`# ${chapter.heading}`), chapter.heading));
    }
    // Chapters on different pages, or the test would prove less than it says.
    expect(new Set(TOC_DOCX_CHAPTERS.map((chapter) => pageOf(`# ${chapter.heading}`))).size).toBe(3);

    expect(resolve("footnote-1")).toEqual({ kind: "note", page: pageOf("(#footnote-ref-1)"), fragment: "footnote-ref-1", nth: 0 });
    expect(resolve("footnote-ref-1")).toEqual({ kind: "note", page: pageOf("(#footnote-1)"), fragment: "footnote-1", nth: 0 });
  });
});
