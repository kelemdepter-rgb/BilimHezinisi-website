import { describe, expect, it } from "vitest";
import { JSDOM } from "jsdom";
import { sanitizeNoteHtml } from "@/lib/notes/sanitize";
import { sanitizeNoteHtmlServer } from "@/lib/notes/sanitize-server";
import { ayaInsertHtml, citationLabel, readerHref, sourceInsertHtml } from "@/lib/notes/insert";
import {
  keepAllowedDeclarations,
  safeFontFamily,
  safeFontSize,
  safeLineHeight,
} from "@/lib/notes/style-allow";
import type { Aya } from "@/lib/quran/types";

/**
 * A citation is worth nothing if it does not survive being saved.
 *
 * Everything the notebook inserts goes through the same sanitizer as a
 * stranger's paste — that is the point of having one allow-list — so the
 * markup in lib/notes/insert.ts has to be built out of what that list admits.
 * These run through BOTH sanitizers, because the server's is the authoritative
 * one and the browser's is what the writer sees.
 */
const browser = (html: string) => sanitizeNoteHtml(html, new JSDOM("").window);
const server = (html: string) => sanitizeNoteHtmlServer(html);
const both: [string, (html: string) => string][] = [
  ["browser", browser],
  ["server", server],
];

const AYA: Aya = {
  sura: 2,
  aya: 255,
  text_ar: "ٱللَّهُ لَآ إِلَٰهَ إِلَّا هُوَ ٱلۡحَىُّ ٱلۡقَيُّومُ",
  text_ug: "اﷲ دىن باشقا ھېچ ئىلاھ يوقتۇر، ئۇ ھەمىشە تىرىكتۇر",
};

const CITATION = {
  bookId: 12,
  title: "قۇتادغۇ بىلىك",
  author: "يۈسۈپ خاس ھاجىپ",
  pageNo: 3,
  passage: "بىلىم بىلەن بىلىنۇر بارچە ئىش.",
  query: "بىلىم",
};

describe("citation markup", () => {
  it("addresses the exact page, and drops the page when there is not one", () => {
    expect(readerHref({ bookId: 12, pageNo: 3, query: "بىلىم" })).toBe(
      "/books/12/read?page=3&q=%D8%A8%D9%89%D9%84%D9%89%D9%85",
    );
    expect(readerHref({ bookId: 12, pageNo: 0, query: "" })).toBe("/books/12/read");
  });

  it("names the book, the author and the page, and skips what is missing", () => {
    expect(citationLabel(CITATION)).toBe("«قۇتادغۇ بىلىك» — يۈسۈپ خاس ھاجىپ — 3-بەت");
    expect(citationLabel({ ...CITATION, author: "", pageNo: 0 })).toBe("«قۇتادغۇ بىلىك»");
  });
});

describe.each(both)("the note sanitizer keeps an inserted source (%s)", (_name, clean) => {
  it("keeps the blockquote, the citation and the working link", () => {
    const out = clean(sourceInsertHtml(CITATION));
    expect(out).toContain("<blockquote");
    expect(out).toContain("بىلىم بىلەن بىلىنۇر بارچە ئىش.");
    expect(out).toContain("«قۇتادغۇ بىلىك» — يۈسۈپ خاس ھاجىپ — 3-بەت");
    expect(out).toContain('href="/books/12/read?page=3');
  });

  it("still refuses a script or a handler smuggled through a passage", () => {
    const out = clean(
      sourceInsertHtml({
        ...CITATION,
        passage: `<img src=x onerror="alert(1)"><script>fetch("//evil")</script>ئوقۇش`,
      }),
    );

    /**
     * Parsed rather than grepped. The passage is escaped when the citation is
     * built, so the string "onerror" is still THERE — as text a reader sees,
     * not as an attribute a browser acts on. Only a parser can tell those two
     * apart, and only the second one matters.
     */
    const parsed = new JSDOM(`<body>${out}</body>`).window.document.body;
    expect(parsed.querySelectorAll("img, script")).toHaveLength(0);
    for (const element of parsed.querySelectorAll("*")) {
      for (const attribute of element.getAttributeNames()) {
        expect(attribute.toLowerCase().startsWith("on")).toBe(false);
      }
    }
    // The passage is escaped at build time, so its text is still readable.
    expect(parsed.textContent).toContain("ئوقۇش");
    expect(parsed.textContent).toContain("<img src=x");
  });
});

describe.each(both)("the note sanitizer keeps an inserted aya (%s)", (_name, clean) => {
  it("keeps the Uthmani face, the brackets and the reference", () => {
    const out = clean(ayaInsertHtml(AYA, "both", "بەقەرە"));
    expect(out).toContain("Uthmanic Hafs");
    expect(out).toContain("﴿");
    expect(out).toContain("﴾");
    expect(out).toContain("قۇرئان كەرىم — بەقەرە — 2:255");
    expect(out).toContain('href="/quran/2?aya=255"');
    expect(out).toContain(AYA.text_ug);
  });

  it("renders Arabic only, translation only, or both, on request", () => {
    expect(clean(ayaInsertHtml(AYA, "ar", "بەقەرە"))).not.toContain(AYA.text_ug);
    const uyghurOnly = clean(ayaInsertHtml(AYA, "ug", "بەقەرە"));
    expect(uyghurOnly).toContain(AYA.text_ug);
    expect(uyghurOnly).not.toContain("﴿");
  });

  it("falls back to the Arabic when a verse carries no translation", () => {
    const out = clean(ayaInsertHtml({ ...AYA, text_ug: "" }, "both", "بەقەرە"));
    expect(out).toContain("﴿");
    expect(out).not.toContain("«»");
  });
});

describe("the style allow-list", () => {
  it("accepts the faces this site may serve and refuses anything else", () => {
    expect(safeFontFamily("'UKIJ Ekran', serif")).toBe("'UKIJ Ekran', serif");
    expect(safeFontFamily("'Uthmanic Hafs','Traditional Arabic',serif")).toBe(
      "'Uthmanic Hafs', 'Traditional Arabic', serif",
    );
    // Not ours, and never served — a whole stack is refused for one bad name.
    expect(safeFontFamily("'Bahij Nazanin', serif")).toBeNull();
    expect(safeFontFamily("url(//evil/f.woff2)")).toBeNull();
  });

  it("bounds the size and the line height", () => {
    expect(safeFontSize("20pt")).toBe("20pt");
    expect(safeFontSize("13px")).toBe("13px");
    expect(safeFontSize("900pt")).toBeNull();
    expect(safeFontSize("2pt")).toBeNull();
    expect(safeFontSize("calc(100px)")).toBeNull();
    expect(safeLineHeight("1.9")).toBe("1.9");
    expect(safeLineHeight("9")).toBeNull();
    expect(safeLineHeight("1.9em")).toBeNull();
  });

  it("drops every property outside the list", () => {
    const kept = keepAllowedDeclarations(
      "color:#333;position:fixed;background:url(//evil);text-align:right;font-size:14pt",
    );
    // Declarations keep the order they were written in.
    expect(kept).toEqual(["color: #333", "text-align: right", "font-size: 14pt"]);
  });
});

describe.each(both)("styles a note may carry (%s)", (_name, clean) => {
  it("keeps a checked face and drops an unchecked one", () => {
    const out = clean(
      `<p style="font-family:'UKIJ Tuz';font-size:18px;line-height:2">ياخشى</p>` +
        `<p style="font-family:'Evil Face';position:fixed">يامان</p>`,
    );
    expect(out).toContain("UKIJ Tuz");
    expect(out).toContain("font-size: 18px");
    expect(out).toContain("line-height: 2");
    expect(out).not.toContain("Evil Face");
    expect(out).not.toContain("position");
  });

  it("folds a legacy <font face> into a checked font-family", () => {
    const out = clean(`<font face="UKIJ Tuz Kitab">خەت</font>`);
    expect(out).toContain("UKIJ Tuz Kitab");
    expect(out).not.toContain("<font");
    expect(out).not.toContain("face=");
  });
});
