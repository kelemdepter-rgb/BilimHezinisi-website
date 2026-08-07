import { describe, expect, it } from "vitest";
import { JSDOM } from "jsdom";
import { htmlToMarkdown } from "@/lib/books/markdown";
import { chunkIntoPages } from "@/lib/books/chunk";
import { renderMarkdown, stripMarkdown } from "@/lib/books/render-markdown";

// turndown needs a DOM; jsdom is already a dependency for the URL importer.
const dom = new JSDOM("");
const globals = globalThis as unknown as {
  window?: unknown;
  document?: unknown;
  DOMParser?: unknown;
  Node?: unknown;
};
globals.window = dom.window;
globals.document = dom.window.document;
globals.DOMParser = dom.window.DOMParser;
globals.Node = dom.window.Node;

describe("htmlToMarkdown (what mammoth hands us from a .docx)", () => {
  it("keeps headings", () => {
    const markdown = htmlToMarkdown("<h1>بىرىنچى باب</h1><h2>بۆلۈم</h2>");
    expect(markdown).toContain("# بىرىنچى باب");
    expect(markdown).toContain("## بۆلۈم");
  });

  it("keeps bold and italic", () => {
    const markdown = htmlToMarkdown("<p><strong>مۇھىم</strong> ۋە <em>يانتۇ</em></p>");
    expect(markdown).toContain("**مۇھىم**");
    expect(markdown).toContain("*يانتۇ*");
  });

  it("keeps ordered and unordered lists", () => {
    // turndown pads list markers ("-   item"), which is still valid Markdown.
    const bullets = htmlToMarkdown("<ul><li>بىر</li><li>ئىككى</li></ul>");
    expect(bullets).toMatch(/^-\s+بىر$/m);
    expect(bullets).toMatch(/^-\s+ئىككى$/m);

    const numbered = htmlToMarkdown("<ol><li>بىر</li><li>ئىككى</li></ol>");
    expect(numbered).toMatch(/^1\.\s+بىر$/m);
    expect(numbered).toMatch(/^2\.\s+ئىككى$/m);
  });

  it("keeps blockquotes and links", () => {
    expect(htmlToMarkdown("<blockquote><p>نەقىل</p></blockquote>")).toContain("> نەقىل");
    expect(htmlToMarkdown('<p><a href="https://a.example">سىلتەم</a></p>')).toContain(
      "[سىلتەم](https://a.example)",
    );
  });

  it("keeps tables as GFM pipe tables", () => {
    const markdown = htmlToMarkdown(
      "<table><thead><tr><th>ئىسىم</th><th>سان</th></tr></thead><tbody><tr><td>بىر</td><td>1</td></tr></tbody></table>",
    );
    expect(markdown).toContain("| ئىسىم |");
    expect(markdown).toContain("| بىر |");
    expect(markdown).toMatch(/\| *---/);
  });

  it("keeps a header-less table, which is what Word actually produces", () => {
    // mammoth emits <table><tr><td> with no <thead>; the GFM plugin alone
    // drops such tables, so real documents would silently lose them.
    const markdown = htmlToMarkdown(
      "<table><tr><td>ئىسىم</td><td>سان</td></tr><tr><td>بىرىنچى</td><td>1</td></tr></table>",
    );
    expect(markdown).toContain("| ئىسىم | سان |");
    expect(markdown).toMatch(/\| *--- *\| *--- *\|/);
    expect(markdown).toContain("| بىرىنچى | 1 |");
  });

  it("escapes pipes inside table cells", () => {
    const markdown = htmlToMarkdown("<table><tr><td>a|b</td><td>c</td></tr></table>");
    expect(markdown).toContain("a\\|b");
  });

  it("drops embedded images rather than inlining base64 blobs", () => {
    const markdown = htmlToMarkdown(
      '<p>ئالدى<img src="data:image/png;base64,AAAABBBBCCCC" alt="رەسىم">كەينى</p>',
    );
    expect(markdown).not.toContain("base64");
    expect(markdown).not.toContain("!");
    expect(markdown).toContain("ئالدى");
    expect(markdown).toContain("كەينى");
  });

  it("drops script and style content", () => {
    const markdown = htmlToMarkdown("<p>تېكىست</p><script>alert(1)</script><style>p{}</style>");
    expect(markdown).toContain("تېكىست");
    expect(markdown).not.toContain("alert");
    expect(markdown).not.toContain("p{}");
  });
});

describe("chunkIntoPages keeps Markdown blocks whole", () => {
  const filler = (seed: string, times: number) =>
    Array.from({ length: times }, (_, i) => `${seed}${i} پاراگراف مەزمۇنى. `.repeat(12)).join(
      "\n\n",
    );

  it("never splits a table across pages", () => {
    const rows = Array.from({ length: 30 }, (_, i) => `| قۇر${i} | ${i} |`).join("\n");
    const table = `| ئىسىم | سان |\n| --- | --- |\n${rows}`;
    const pages = chunkIntoPages(`${filler("a", 8)}\n\n${table}\n\n${filler("b", 8)}`);

    const withDelimiter = pages.filter((page) => /\| *--- *\|/.test(page));
    expect(withDelimiter).toHaveLength(1);
    // The whole table — header, delimiter and every row — lands on one page.
    const tablePage = withDelimiter[0];
    expect(tablePage).toContain("| ئىسىم | سان |");
    for (let i = 0; i < 30; i++) expect(tablePage).toContain(`| قۇر${i} |`);
  });

  it("never splits a fenced code block", () => {
    const code = ["```", ...Array.from({ length: 40 }, (_, i) => `line ${i}`), "```"].join("\n");
    const pages = chunkIntoPages(`${filler("c", 8)}\n\n${code}\n\n${filler("d", 8)}`);

    const withFence = pages.filter((page) => page.includes("```"));
    expect(withFence).toHaveLength(1);
    // Both fences on the same page means it was never torn in half.
    expect(withFence[0].match(/```/g)).toHaveLength(2);
    expect(withFence[0]).toContain("line 0");
    expect(withFence[0]).toContain("line 39");
  });

  it("never leaves a heading stranded at the end of a page", () => {
    const source = Array.from(
      { length: 14 },
      (_, i) => `## ماۋزۇ ${i}\n\n${`ئۇيغۇرچە جۈملە ${i}. `.repeat(60)}`,
    ).join("\n\n");
    const pages = chunkIntoPages(source);

    expect(pages.length).toBeGreaterThan(1);
    for (const page of pages) {
      const lines = page.split("\n").filter((line) => line.trim());
      const last = lines[lines.length - 1] ?? "";
      expect(/^#{1,6}\s/.test(last), `page ended on a heading: ${last}`).toBe(false);
    }
  });

  it("still loses no content with Markdown in the mix", () => {
    const source = `# ماۋزۇ\n\n${filler("e", 6)}\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n\n${filler("f", 6)}`;
    const pages = chunkIntoPages(source);
    const strip = (value: string) => value.replace(/\s+/g, "");
    expect(strip(pages.join(""))).toBe(strip(source));
  });
});

describe("renderMarkdown never lets book text become markup", () => {
  // The guarantee is that no ELEMENT is created from book text. Dangerous
  // strings may still appear, but only escaped, as visible characters.
  it("escapes raw HTML instead of passing it through", () => {
    const html = renderMarkdown('<script>alert(1)</script>\n\n<img src=x onerror="alert(1)">');
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/<img/i);
    expect(html).toContain("&lt;script&gt;");
  });

  it("escapes inline HTML mixed into a paragraph", () => {
    const html = renderMarkdown("سالام <b onmouseover='x()'>dünya</b>");
    // No <b> element, so the handler is inert text rather than an attribute.
    expect(html).not.toMatch(/<b[\s>]/i);
    expect(html).toContain("&lt;b");
  });

  it("refuses javascript: links", () => {
    const html = renderMarkdown("[بېسىڭ](javascript:alert(1))");
    // markdown-it declines to build the anchor at all, leaving plain text.
    expect(html).not.toMatch(/<a\s/i);
    expect(html).toContain("<p>");
  });

  it("does build ordinary links", () => {
    const html = renderMarkdown("[سىلتەم](https://example.org/a)");
    expect(html).toContain('<a href="https://example.org/a"');
  });

  it("still renders ordinary Markdown structure", () => {
    const html = renderMarkdown("# ماۋزۇ\n\n**توم** ۋە *يانتۇ*\n\n- بىر\n- ئىككى");
    expect(html).toContain("<h1>");
    expect(html).toContain("<strong>");
    expect(html).toContain("<em>");
    expect(html).toContain("<li>");
  });

  it("renders GFM tables", () => {
    const html = renderMarkdown("| a | b |\n| --- | --- |\n| 1 | 2 |");
    expect(html).toContain("<table>");
    expect(html).toContain("<th>");
    expect(html).toContain("<td>");
  });
});

describe("stripMarkdown for search snippets", () => {
  it("removes emphasis but keeps the words", () => {
    expect(stripMarkdown("بۇ **سۆز** مۇھىم")).toBe("بۇ سۆز مۇھىم");
    expect(stripMarkdown("بۇ *سۆز* مۇھىم")).toBe("بۇ سۆز مۇھىم");
    expect(stripMarkdown("بۇ ~~سۆز~~ مۇھىم")).toBe("بۇ سۆز مۇھىم");
  });

  it("removes heading, quote and list markers", () => {
    expect(stripMarkdown("## ماۋزۇ")).toBe("ماۋزۇ");
    expect(stripMarkdown("> نەقىل")).toBe("نەقىل");
    expect(stripMarkdown("- بىرىنچى")).toBe("بىرىنچى");
    expect(stripMarkdown("1. بىرىنچى")).toBe("بىرىنچى");
  });

  it("keeps link labels and drops the target", () => {
    expect(stripMarkdown("[سىلتەم](https://a.example) بار")).toBe("سىلتەم بار");
  });

  it("flattens table syntax", () => {
    expect(stripMarkdown("| ئىسىم | سان |\n| --- | --- |\n| بىر | 1 |")).toContain("ئىسىم");
    expect(stripMarkdown("| ئىسىم | سان |\n| --- | --- |\n| بىر | 1 |")).not.toContain("|");
    expect(stripMarkdown("| ئىسىم | سان |\n| --- | --- |\n| بىر | 1 |")).not.toContain("---");
  });

  it("preserves mark tags exactly", () => {
    expect(stripMarkdown("بۇ **<mark>سۆز</mark>** مۇھىم")).toBe("بۇ <mark>سۆز</mark> مۇھىم");
    expect(stripMarkdown("## <mark>ماۋزۇ</mark>")).toBe("<mark>ماۋزۇ</mark>");
  });

  it("leaves plain prose untouched", () => {
    expect(stripMarkdown("ئاددىي جۈملە.")).toBe("ئاددىي جۈملە.");
  });
});
