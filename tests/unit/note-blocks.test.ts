// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { blockStyleAt, listStyleAt, quoteToNormalCommand } from "@/lib/notes/blocks";

/**
 * Which block style the toolbar shows, and which command takes a quote away.
 * The commands themselves are the browser's; what they do in each engine is
 * asserted in tests/notes-editing.spec.ts.
 */
function editorWith(html: string): HTMLDivElement {
  const editor = document.createElement("div");
  editor.innerHTML = html;
  document.body.appendChild(editor);
  return editor;
}

function textIn(editor: HTMLElement, selector: string): Node {
  return editor.querySelector(selector)!.firstChild!;
}

describe("the block the caret is in", () => {
  it("is a heading inside any heading level", () => {
    const editor = editorWith("<h2>ماۋزۇ</h2><h3>كىچىك</h3><div>تېكىست</div>");
    expect(blockStyleAt(editor, textIn(editor, "h2")).style).toBe("heading");
    expect(blockStyleAt(editor, textIn(editor, "h3")).style).toBe("heading");
    expect(blockStyleAt(editor, textIn(editor, "h2")).element?.tagName).toBe("H2");
  });

  it("is a quote inside a quote, through inline markup and inner blocks", () => {
    const editor = editorWith("<blockquote><div><b>نەقىل</b></div></blockquote>");
    const found = blockStyleAt(editor, textIn(editor, "b"));
    expect(found.style).toBe("quote");
    expect(found.element?.tagName).toBe("BLOCKQUOTE");
  });

  it("names the innermost one: a heading inside a quote is a heading", () => {
    const editor = editorWith("<blockquote><h2>ماۋزۇ</h2></blockquote>");
    expect(blockStyleAt(editor, textIn(editor, "h2")).style).toBe("heading");
  });

  it("is normal text anywhere else, the note's first bare line included", () => {
    const editor = editorWith("بىرىنچى قۇر<div>ئىككىنچى</div><ul><li>تىزىم</li></ul>");
    expect(blockStyleAt(editor, editor.firstChild).style).toBe("normal");
    expect(blockStyleAt(editor, textIn(editor, "div")).style).toBe("normal");
    expect(blockStyleAt(editor, textIn(editor, "li")).element).toBeNull();
    expect(blockStyleAt(editor, null).style).toBe("normal");
  });

  it("never looks past the editor", () => {
    const outer = document.createElement("blockquote");
    const editor = document.createElement("div");
    editor.innerHTML = "<div>ئىچىدە</div>";
    outer.appendChild(editor);
    document.body.appendChild(outer);
    expect(blockStyleAt(editor, textIn(editor, "div")).style).toBe("normal");
  });
});

describe("the list the caret is in", () => {
  it("tells a bulleted list from a numbered one, innermost first", () => {
    const editor = editorWith(
      "<ul><li>بىر</li></ul><ol><li>ئىككى<ul><li>ئىچكى</li></ul></li></ol><div>يوق</div>",
    );
    expect(listStyleAt(editor, textIn(editor, "ul > li"))).toBe("bulleted");
    expect(listStyleAt(editor, textIn(editor, "ol > li"))).toBe("numbered");
    expect(listStyleAt(editor, textIn(editor, "ol ul li"))).toBe("bulleted");
    expect(listStyleAt(editor, textIn(editor, "div"))).toBeNull();
  });
});

describe("taking a quote away", () => {
  it("re-formats a quote of text and line breaks as one normal block", () => {
    for (const html of [
      "<blockquote>نەقىل</blockquote>",
      "<blockquote>بىر قۇر<br>ئىككى قۇر</blockquote>",
      '<blockquote dir="rtl">نەقىل <b>توم</b> <a href="/books/1/read">«كىتاب»</a></blockquote>',
    ]) {
      const quote = editorWith(html).querySelector("blockquote")!;
      expect(quoteToNormalCommand(quote), html).toEqual({ command: "formatBlock", value: "<div>" });
    }
  });

  it("outdents a quote that holds blocks, which formatBlock leaves alone", () => {
    for (const html of [
      "<blockquote><div>بىر</div><div>ئىككى</div></blockquote>",
      "<blockquote><p>بىر</p><p>ئىككى</p></blockquote>",
      "<blockquote>بىر<div>ئىككى</div></blockquote>",
    ]) {
      const quote = editorWith(html).querySelector("blockquote")!;
      expect(quoteToNormalCommand(quote), html).toEqual({ command: "outdent" });
    }
  });
});
