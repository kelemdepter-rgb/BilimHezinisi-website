// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { outlineHeadings, outlineOf, sameOutline } from "@/lib/notes/outline";

/**
 * «مۇندەرىجە» (PROMPT-49): which headings a note's outline lists, and how far
 * each is indented. The panel itself is tests/notes-links.spec.ts.
 */
function noteWith(html: string): HTMLDivElement {
  const editor = document.createElement("div");
  editor.innerHTML = html;
  return editor;
}

describe("outlineOf", () => {
  it("lists h1–h4 in document order, wherever they are nested, with their levels", () => {
    const editor = noteWith(
      "<h1>بىرىنچى</h1>" +
        "<div><p>تېكىست</p><h2>ئىككىنچى <b>قىسىم</b></h2></div>" +
        "<blockquote><h3>ئۈچىنچى</h3></blockquote>" +
        "<ul><li><h4>تۆتىنچى</h4></li></ul>" +
        "<h5>بەشىنچى</h5><h6>ئالتىنچى</h6>",
    );
    expect(outlineOf(editor)).toEqual([
      { level: 1, text: "بىرىنچى", depth: 0 },
      { level: 2, text: "ئىككىنچى قىسىم", depth: 1 },
      { level: 3, text: "ئۈچىنچى", depth: 2 },
      { level: 4, text: "تۆتىنچى", depth: 3 },
    ]);
  });

  it("indents from the note's highest heading, so h2s alone are a flat list", () => {
    const editor = noteWith("<h2>بىر</h2><div>x</div><h2>ئىككى</h2><h3>ئىچىدە</h3><h2>ئۈچ</h2>");
    expect(outlineOf(editor).map((entry) => entry.depth)).toEqual([0, 0, 1, 0]);
  });

  it("leaves out a heading with no text, and puts a heading's lines on one", () => {
    const editor = noteWith("<h2>  </h2><h2><br></h2><h2>بىرىنچى\n   قۇر<br>ئىككىنچى</h2>");
    expect(outlineOf(editor)).toEqual([{ level: 2, text: "بىرىنچى قۇرئىككىنچى", depth: 0 }]);
    expect(outlineHeadings(editor)).toHaveLength(1);
  });

  it("is empty for a note without headings", () => {
    expect(outlineOf(noteWith("<div>ماۋزۇسىز خاتىرە</div><p><b>توم</b></p>"))).toEqual([]);
  });

  it("matches its headings one to one, for the jump", () => {
    const editor = noteWith("<h2>a</h2><h3></h3><h3>b</h3>");
    const headings = outlineHeadings(editor);
    expect(headings.map((heading) => heading.textContent)).toEqual(["a", "b"]);
    expect(outlineOf(editor).map((entry) => entry.text)).toEqual(["a", "b"]);
  });
});

describe("sameOutline", () => {
  it("is true only for the same headings at the same levels", () => {
    const a = outlineOf(noteWith("<h2>a</h2><h3>b</h3>"));
    expect(sameOutline(a, outlineOf(noteWith("<h2>a</h2><div>x</div><h3>b</h3>")))).toBe(true);
    expect(sameOutline(a, outlineOf(noteWith("<h2>a</h2><h2>b</h2>")))).toBe(false);
    expect(sameOutline(a, outlineOf(noteWith("<h2>a</h2>")))).toBe(false);
  });
});
