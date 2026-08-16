import { describe, expect, it } from "vitest";
import { JSDOM } from "jsdom";
import { sanitizeNoteHtml } from "@/lib/notes/sanitize";

/** The server sanitizes with jsdom; give the tests the same window. */
const clean = (html: string) => sanitizeNoteHtml(html, new JSDOM("").window);

describe("note sanitizer", () => {
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
});
