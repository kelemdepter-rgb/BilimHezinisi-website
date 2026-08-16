import { describe, expect, it } from "vitest";
import { JSDOM } from "jsdom";
import { sanitizeNoteHtml } from "@/lib/notes/sanitize";
import { noteHtmlToText, sanitizeNoteHtmlServer } from "@/lib/notes/sanitize-server";

/**
 * Two sanitizers, one allow-list.
 *
 * The browser keeps DOMPurify for what the editor pastes. The server cannot:
 * DOMPurify needs a DOM, jsdom supplied it, and jsdom cannot be loaded in
 * Vercel's function runtime — importing it threw while app/notes/actions.ts was
 * still being evaluated, so «يېڭى خاتىرە» answered 500 in production while
 * passing every local test. The server now parses with parse5 and walks the
 * tree itself.
 *
 * Which means the two have to be held to the same standard, so the cases below
 * run through BOTH. The server one is authoritative — it is the pass a stranger
 * posting straight at the Server Action cannot skip.
 */
const browser = (html: string) => sanitizeNoteHtml(html, new JSDOM("").window);
const server = (html: string) => sanitizeNoteHtmlServer(html);
const both: [string, (html: string) => string][] = [
  ["browser", browser],
  ["server", server],
];

describe.each(both)("note sanitizer (%s)", (_name, clean) => {
  it("drops scripts and event handlers from pasted markup", () => {
    const out = clean(
      `<p onclick="steal()">ياخشى</p><script>fetch("//evil")</script>` +
        `<img src=x onerror="alert(1)">`,
    );
    expect(out).toContain("ياخشى");
    expect(out.toLowerCase()).not.toContain("script");
    expect(out.toLowerCase()).not.toContain("onclick");
    expect(out.toLowerCase()).not.toContain("onerror");
    expect(out.toLowerCase()).not.toContain("<img");
  });

  it("refuses javascript: links but keeps ordinary ones", () => {
    const out = clean(`<a href="javascript:alert(1)">a</a><a href="https://x.test">b</a>`);
    expect(out).not.toContain("javascript:");
    expect(out).toContain("https://x.test");
  });

  it("strips iframes, forms and inputs whole", () => {
    const out = clean(`<iframe src="//evil"></iframe><form><input name="p"></form><p>مەزمۇن</p>`);
    expect(out).toBe("<p>مەزمۇن</p>");
  });

  it("keeps the formatting the toolbar produces", () => {
    const out = clean(
      `<h2>ماۋزۇ</h2><p><b>توم</b> <i>يانتۇ</i> <u>سىزىق</u></p>` +
        `<ul><li>بىر</li></ul><blockquote>نەقىل</blockquote>`,
    );
    for (const tag of ["<h2>", "<b>", "<i>", "<u>", "<ul>", "<li>", "<blockquote>"]) {
      expect(out).toContain(tag);
    }
  });

  it("keeps alignment and colour, which the book sanitizer would have erased", () => {
    const out = clean(`<p style="text-align: center; color: #C9A24B">ئوتتۇرا</p>`);
    expect(out).toContain("text-align: center");
    expect(out).toContain("color: #C9A24B");
  });

  it("throws away every other declaration in a style attribute", () => {
    const out = clean(
      `<p style="text-align:right;position:fixed;background:url(//evil);width:9999px">ئوڭ</p>`,
    );
    expect(out).toContain("text-align: right");
    expect(out).not.toContain("position");
    expect(out).not.toContain("url(");
    expect(out).not.toContain("width");
  });

  it("rejects an alignment value that is not one of the six", () => {
    const out = clean(`<p style="text-align: expression(evil)">x</p>`);
    expect(out).not.toContain("text-align");
  });

  it("folds legacy font and align markup into styles", () => {
    const out = clean(`<p align="center"><font color="#ff0000">قىزىل</font></p>`);
    expect(out).toContain("text-align: center");
    expect(out).toContain("color: #ff0000");
    expect(out).not.toContain("<font");
    expect(out).not.toContain('align="center"');
  });

  it("leaves nothing behind for an empty or hostile-only paste", () => {
    expect(clean("")).toBe("");
    expect(clean("<script>x()</script>")).toBe("");
  });

  it("keeps the text of a tag it does not allow, and loses the tag", () => {
    const out = clean("<section><p>مەزمۇن</p></section>");
    expect(out).toContain("مەزمۇن");
    expect(out).not.toContain("<section");
  });

  it("neutralises an entity-encoded javascript URL", () => {
    // A browser decodes the entity before acting on the scheme, so the
    // sanitizer has to judge the decoded value, not the written one.
    const out = clean(`<a href="&#106;avascript:alert(1)">a</a>`);
    expect(out.toLowerCase()).not.toContain("javascript:");
  });

  it("does not let a data: URL through", () => {
    const out = clean(`<a href="data:text/html,<script>alert(1)</script>">a</a>`);
    expect(out).not.toContain("data:text/html");
  });
});

describe("server sanitizer — the pass a stranger cannot skip", () => {
  it("escapes text so the output cannot re-parse into markup", () => {
    const out = server("<p>a &lt; b &amp; c > d</p>");
    expect(out).toBe("<p>a &lt; b &amp; c &gt; d</p>");
  });

  it("survives markup a browser would have to repair", () => {
    expect(() => server("<p><b>ئوچۇق<p>يېپىلمىغان")).not.toThrow();
    expect(() => server("<<<>>><p")).not.toThrow();
    expect(() => server("<table><td>a")).not.toThrow();
  });

  it("drops comments and doctypes rather than echoing them", () => {
    const out = server("<!-- gizli --><p>ئوچۇق</p>");
    expect(out).toBe("<p>ئوچۇق</p>");
  });

  it("strips the contents of a style block instead of spilling CSS into the note", () => {
    const out = server("<style>p{color:red}</style><p>مەزمۇن</p>");
    expect(out).toBe("<p>مەزمۇن</p>");
  });

  it("keeps a relative link, which is not a scheme at all", () => {
    expect(server('<a href="/books/12">كىتاب</a>')).toContain('href="/books/12"');
  });
});

describe("noteHtmlToText", () => {
  it("turns blocks into line breaks so paragraphs do not run together", () => {
    expect(noteHtmlToText("<p>بىرىنچى</p><p>ئىككىنچى</p>")).toBe("بىرىنچى\nئىككىنچى");
    expect(noteHtmlToText("<ul><li>بىر</li><li>ئىككى</li></ul>")).toBe("بىر\nئىككى");
  });

  it("counts what the writer sees, not the markup around it", () => {
    expect(noteHtmlToText("<p><b>توم</b> خەت</p>")).toBe("توم خەت");
  });

  it("decodes entities, so &amp; counts as one character", () => {
    expect(noteHtmlToText("<p>a &amp; b</p>")).toBe("a & b");
  });

  it("is empty for empty input", () => {
    expect(noteHtmlToText("")).toBe("");
    expect(noteHtmlToText("<p></p>")).toBe("");
  });
});
