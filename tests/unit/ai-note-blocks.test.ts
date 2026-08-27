/**
 * What gets sent for correction, and what gets written back.
 *
 * Two bugs were caught here rather than by eye, and both would have damaged
 * somebody's writing silently:
 *
 *   - Typing into an empty note leaves a BARE TEXT NODE, and pressing Enter
 *     adds a <div> beside it. Collecting only elements skipped the writer's
 *     first line entirely — it was never checked, and they would never know.
 *   - A <br> inside a block is a line the writer typed. Sending the block as
 *     one string and writing the reply back with textContent merged those
 *     lines into one, which is a change to the shape of their document that
 *     has nothing to do with spelling.
 */
import { JSDOM } from "jsdom";
import { beforeEach, describe, expect, it } from "vitest";
import {
  applyUnitLines,
  collectUnits,
  countQuoted,
  sendableLines,
} from "@/lib/ai/note-blocks";

let dom: JSDOM;

/**
 * jsdom has no layout, so innerText is undefined there; note-blocks falls back
 * to textContent, which loses <br> boundaries. Defining innerText to render
 * <br> as a newline is what a browser does, and it is what these tests are
 * about.
 */
function editorWith(html: string): HTMLElement {
  dom = new JSDOM(`<div id="editor">${html}</div>`);
  const { window } = dom;
  Object.defineProperty(window.HTMLElement.prototype, "innerText", {
    configurable: true,
    get(this: HTMLElement) {
      return this.innerHTML
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<[^>]+>/g, "")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">");
    },
  });
  // The module reads Node.TEXT_NODE and instanceof HTMLElement off globals.
  globalThis.Node = window.Node;
  globalThis.HTMLElement = window.HTMLElement;
  return window.document.getElementById("editor")!;
}

beforeEach(() => {
  // Each test builds its own document; nothing carries over.
});

describe("what a note is made of", () => {
  it("collects text typed straight into the editor, with no block around it", () => {
    const editor = editorWith("بىرىنچى قۇر<div>ئىككىنچى قۇر</div>");
    const units = collectUnits(editor);
    expect(units).toHaveLength(2);
    expect(sendableLines(units).map((line) => line.text)).toEqual(["بىرىنچى قۇر", "ئىككىنچى قۇر"]);
  });

  it("treats a <br> as a line of its own", () => {
    const editor = editorWith("<div>بىرىنچى<br>ئىككىنچى</div>");
    const units = collectUnits(editor);
    expect(units).toHaveLength(1);
    expect(units[0].lines).toEqual(["بىرىنچى", "ئىككىنچى"]);
    expect(sendableLines(units)).toHaveLength(2);
  });

  it("counts a nested block once, not twice", () => {
    const editor = editorWith("<div><p>ئىچكى ئابزاس</p></div>");
    expect(collectUnits(editor)).toHaveLength(1);
  });

  it("skips blank lines rather than sending empty segments", () => {
    const editor = editorWith("<div>بار<br><br>يەنە بار</div>");
    expect(sendableLines(collectUnits(editor)).map((line) => line.text)).toEqual(["بار", "يەنە بار"]);
  });
});

describe("quoted material is never sent", () => {
  it("leaves a cited passage alone", () => {
    const editor = editorWith(
      "<div>ئادەتتىكى ئابزاس</div>" +
        '<p dir="rtl"><a href="/books/1/read?page=2">«كىتاب» — 2-بەت</a></p>',
    );
    const units = collectUnits(editor);
    expect(countQuoted(units)).toBe(1);
    const sent = sendableLines(units).map((line) => line.text);
    expect(sent).toEqual(["ئادەتتىكى ئابزاس"]);
    expect(sent.join(" ")).not.toContain("كىتاب");
  });

  it("leaves a Qur'an verse alone", () => {
    // "Correcting" the orthography of an aya would be an error, not a fix.
    const editor = editorWith(
      '<div>ئىزاھات</div><p style="font-family:Uthmanic Hafs">بِسْمِ ٱللَّهِ</p>',
    );
    const units = collectUnits(editor);
    expect(countQuoted(units)).toBe(1);
    expect(sendableLines(units).map((line) => line.text)).toEqual(["ئىزاھات"]);
  });
});

describe("writing a correction back", () => {
  it("replaces a single line without disturbing the element", () => {
    const editor = editorWith('<h2 id="keep">سەرلەۋھە</h2>');
    const units = collectUnits(editor);
    applyUnitLines(units[0], ["سەرلەۋھە."]);
    expect(editor.innerHTML).toBe('<h2 id="keep">سەرلەۋھە.</h2>');
  });

  it("keeps the writer's line breaks when a unit has several", () => {
    const editor = editorWith("<div>بىرىنچى<br>ئىككىنچى</div>");
    const units = collectUnits(editor);
    applyUnitLines(units[0], ["بىرىنچى.", "ئىككىنچى."]);
    expect(editor.innerHTML).toBe("<div>بىرىنچى.<br>ئىككىنچى.</div>");
  });

  it("writes a bare text node back as text", () => {
    const editor = editorWith("خام تېكىست<div>ئابزاس</div>");
    const units = collectUnits(editor);
    applyUnitLines(units[0], ["خام تېكىست."]);
    expect(editor.innerHTML).toBe("خام تېكىست.<div>ئابزاس</div>");
  });

  it("escapes what it writes, so a correction can never become markup", () => {
    const editor = editorWith("<div>سىناق</div>");
    const units = collectUnits(editor);
    applyUnitLines(units[0], ['<img src=x onerror="alert(1)">']);
    expect(editor.innerHTML).not.toContain("<img");
    expect(editor.querySelector("img")).toBeNull();
  });

  it("escapes across a multi-line unit too", () => {
    const editor = editorWith("<div>بىر<br>ئىككى</div>");
    const units = collectUnits(editor);
    applyUnitLines(units[0], ["<b>بىر</b>", "ئىككى"]);
    expect(editor.querySelector("b")).toBeNull();
    expect(editor.innerHTML).toContain("&lt;b&gt;");
  });
});
