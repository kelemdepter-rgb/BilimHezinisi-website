// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  canonicalColor,
  captureFormat,
  formatAt,
  paint,
  rangeFormat,
  type PaintDeps,
  type PaintFormat,
  type Toggle,
} from "@/lib/notes/painter";

/**
 * «فورمات سۈپۈرگىسى» (PROMPT-49): what the painter takes from the start of a
 * selection, and which commands it runs to make another selection match.
 * The commands themselves are the browser's; tests/notes-links.spec.ts runs
 * them in all three engines.
 */
function noteWith(html: string): HTMLDivElement {
  const editor = document.createElement("div");
  editor.innerHTML = html;
  document.body.replaceChildren(editor);
  return editor;
}

/** A range over `text` inside the first element matching `selector`. */
function rangeOver(editor: HTMLElement, text: string): Range {
  const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const at = (node as Text).data.indexOf(text);
    if (at >= 0) {
      const range = document.createRange();
      range.setStart(node, at);
      range.setEnd(node, at + text.length);
      return range;
    }
  }
  throw new Error(`no «${text}» in the note`);
}

const PLAIN: PaintFormat = { bold: false, italic: false, underline: false, color: null };

describe("canonicalColor", () => {
  it("spells one colour one way", () => {
    expect(canonicalColor("#c0392b")).toBe("rgb(192, 57, 43)");
    expect(canonicalColor("#C0392B")).toBe("rgb(192, 57, 43)");
    expect(canonicalColor("#f00")).toBe("rgb(255, 0, 0)");
    expect(canonicalColor("rgb(192,57,43)")).toBe("rgb(192, 57, 43)");
    expect(canonicalColor("rgba(192, 57, 43, 1)")).toBe("rgb(192, 57, 43)");
    expect(canonicalColor(" Red ")).toBe("red");
  });

  it("is null for no colour of the text's own", () => {
    for (const none of ["", "  ", "inherit", "initial", "unset", "currentColor", "transparent", null, undefined]) {
      expect(canonicalColor(none), String(none)).toBeNull();
    }
  });
});

describe("captureFormat", () => {
  it("takes bold and an explicit colour", () => {
    const editor = noteWith('<div><b><font color="#c0392b">مەنبە سۆز</font></b> قالغىنى</div>');
    expect(captureFormat(editor, rangeOver(editor, "مەنبە"))).toEqual({
      bold: true,
      italic: false,
      underline: false,
      color: "rgb(192, 57, 43)",
    });
  });

  it("takes italic and underline, from tags or from styles", () => {
    const editor = noteWith(
      '<div><i><u>يانتۇ ئاستى</u></i> <em>تەكىت</em> <span style="font-style: italic; text-decoration: underline">ئۇسلۇب</span></div>',
    );
    expect(captureFormat(editor, rangeOver(editor, "يانتۇ"))).toEqual({ ...PLAIN, italic: true, underline: true });
    expect(captureFormat(editor, rangeOver(editor, "تەكىت"))).toEqual({ ...PLAIN, italic: true });
    expect(captureFormat(editor, rangeOver(editor, "ئۇسلۇب"))).toEqual({ ...PLAIN, italic: true, underline: true });
  });

  it("has no colour when the text has none of its own — the theme's ink is never taken", () => {
    const editor = noteWith('<div>ئاددىي <span style="color: inherit">ۋارىس</span></div>');
    expect(captureFormat(editor, rangeOver(editor, "ئاددىي"))).toEqual(PLAIN);
    expect(captureFormat(editor, rangeOver(editor, "ۋارىس"))).toEqual(PLAIN);
  });

  it("takes a colour from a style as well as from <font>, the nearest one winning", () => {
    const editor = noteWith(
      '<p style="color: #8a8a8a">كۈلرەڭ <span style="color: rgb(0, 128, 0)">يېشىل</span></p>',
    );
    expect(captureFormat(editor, rangeOver(editor, "كۈلرەڭ"))?.color).toBe("rgb(138, 138, 138)");
    expect(captureFormat(editor, rangeOver(editor, "يېشىل"))?.color).toBe("rgb(0, 128, 0)");
  });

  it("lets the nearest weight decide, and counts a heading as bold", () => {
    const editor = noteWith(
      '<div><b>توم <span style="font-weight: normal">ئادەتتىكى</span></b></div><h2>ماۋزۇ</h2><div><span style="font-weight: 700">يەتتەيۈز</span></div>',
    );
    expect(captureFormat(editor, rangeOver(editor, "توم"))?.bold).toBe(true);
    expect(captureFormat(editor, rangeOver(editor, "ئادەتتىكى"))?.bold).toBe(false);
    expect(captureFormat(editor, rangeOver(editor, "ماۋزۇ"))?.bold).toBe(true);
    expect(captureFormat(editor, rangeOver(editor, "يەتتەيۈز"))?.bold).toBe(true);
  });

  it("reads the first character that is not a space, even from a boundary between elements", () => {
    const editor = noteWith('<div>بىرىنچى </div><div><b>ئىككىنچى</b> ئۈچىنچى</div>');
    const range = document.createRange();
    // From the end of the first block's text (its trailing space) into the second.
    const first = editor.querySelector("div")!.firstChild as Text;
    range.setStart(first, first.data.length - 1);
    range.setEnd(editor.querySelectorAll("div")[1].lastChild!, 3);
    expect(captureFormat(editor, range)?.bold).toBe(true);

    // A range starting on an element boundary, before the <b>.
    const second = document.createRange();
    second.setStart(editor.querySelectorAll("div")[1], 0);
    second.setEnd(editor.querySelectorAll("div")[1], 1);
    expect(captureFormat(editor, second)?.bold).toBe(true);
  });

  it("is null when only space is selected", () => {
    const editor = noteWith("<div>a   b</div>");
    const text = editor.querySelector("div")!.firstChild as Text;
    const range = document.createRange();
    range.setStart(text, 1);
    range.setEnd(text, 4);
    expect(captureFormat(editor, range)).toBeNull();
  });
});

describe("rangeFormat", () => {
  it("says whether all, none or some of a selection has each property", () => {
    const editor = noteWith('<div>aa <b>bb</b> <i>cc</i></div><h2>dd</h2>');
    const range = document.createRange();
    range.setStart(editor.querySelector("div")!.firstChild!, 0);
    range.setEnd(editor.querySelector("i")!.firstChild!, 2);
    expect(rangeFormat(editor, range)).toMatchObject({ bold: "some", italic: "some", underline: "none", inHeading: false });
    expect(rangeFormat(editor, rangeOver(editor, "bb")).bold).toBe("all");
    expect(rangeFormat(editor, rangeOver(editor, "dd"))).toMatchObject({ bold: "all", inHeading: true });
  });

  it("has a colour only when every part has that one", () => {
    const editor = noteWith('<div><font color="#ff0000">aa</font> <span style="color: red">bb</span> <font color="#ff0000">cc</font></div>');
    const range = document.createRange();
    range.setStart(editor.querySelector("font")!.firstChild!, 0);
    range.setEnd(editor.querySelectorAll("font")[1].firstChild!, 2);
    // `red` and #ff0000 are spelled differently; the painter then just paints again.
    expect(rangeFormat(editor, range).color).toBeNull();
    expect(rangeFormat(editor, rangeOver(editor, "aa")).color).toBe("rgb(255, 0, 0)");
  });
});

/**
 * The engines' commands as measured in Chromium 151, Firefox 153 and WebKit
 * 26.5 (lib/notes/painter.ts): a toggle over a selection that wholly has the
 * property takes it away, over any other gives all of it the property;
 * foreColor colours it. Each selected text node is wrapped or unwrapped.
 */
function engine(editor: HTMLElement, texts: Text[]) {
  const commands: string[] = [];
  const tags: Record<Toggle, string> = { bold: "b", italic: "i", underline: "u" };
  const selection = () => {
    const range = document.createRange();
    range.setStartBefore(texts[0]);
    range.setEndAfter(texts[texts.length - 1]);
    return range;
  };
  const wrap = (text: Text, tag: string, color?: string) => {
    const element = document.createElement(tag);
    if (color) element.setAttribute("color", color);
    text.replaceWith(element);
    element.append(text);
  };
  const deps: PaintDeps = {
    selection,
    exec(command, value) {
      commands.push(value ? `${command} ${value}` : command);
      if (command === "foreColor") {
        for (const text of texts) wrap(text, "font", value);
        return;
      }
      const property = command as Toggle;
      const tag = tags[property];
      const wholly = rangeFormat(editor, selection())[property] === "all";
      for (const text of texts) {
        if (wholly) {
          const element = text.parentElement?.closest(tag);
          if (element && editor.contains(element)) element.replaceWith(...element.childNodes);
        } else if (!formatAt(editor, text)[property]) {
          wrap(text, tag);
        }
      }
    },
  };
  return { commands, deps };
}

describe("paint", () => {
  it("bold and coloured onto plain text: two commands, one «يېنىۋېلىش» each", () => {
    const editor = noteWith("<div>نىشان تېكىست</div>");
    const target = editor.querySelector("div")!.firstChild as Text;
    const { commands, deps } = engine(editor, [target]);
    const format = { ...PLAIN, bold: true, color: "rgb(192, 57, 43)" };
    expect(paint(editor, format, deps)).toBe(2);
    expect(commands).toEqual(["bold", "foreColor rgb(192, 57, 43)"]);
    expect(formatAt(editor, target)).toEqual(format);
  });

  it("a source with no colour leaves the target's colour alone", () => {
    const editor = noteWith('<div><font color="#2e86c1">كۆك تېكىست</font></div>');
    const target = editor.querySelector("font")!.firstChild as Text;
    const { commands, deps } = engine(editor, [target]);
    expect(paint(editor, { ...PLAIN, italic: true }, deps)).toBe(1);
    expect(commands).toEqual(["italic"]);
    expect(formatAt(editor, target).color).toBe("rgb(46, 134, 193)");
  });

  it("takes away what the source does not have", () => {
    const editor = noteWith("<div><b><u>توم ئاستى</u></b></div>");
    const target = editor.querySelector("u")!.firstChild as Text;
    const { commands, deps } = engine(editor, [target]);
    expect(paint(editor, PLAIN, deps)).toBe(2);
    expect(commands).toEqual(["bold", "underline"]);
    expect(formatAt(editor, target)).toEqual(PLAIN);
  });

  it("runs nothing when the target already matches", () => {
    const editor = noteWith('<div><i><font color="#c0392b">تەييار</font></i></div>');
    const { commands, deps } = engine(editor, [editor.querySelector("font")!.firstChild as Text]);
    expect(paint(editor, { ...PLAIN, italic: true, color: "rgb(192, 57, 43)" }, deps)).toBe(0);
    expect(commands).toEqual([]);
  });

  it("a part-bold target made not bold takes two commands: all, then none", () => {
    const editor = noteWith("<div>ئاددىي <b>توم</b></div>");
    const texts = [editor.querySelector("div")!.firstChild as Text, editor.querySelector("b")!.firstChild as Text];
    const { commands, deps } = engine(editor, texts);
    expect(paint(editor, PLAIN, deps)).toBe(2);
    expect(commands).toEqual(["bold", "bold"]);
    for (const text of texts) expect(formatAt(editor, text).bold).toBe(false);
  });

  it("never tries to make a heading not bold", () => {
    const editor = noteWith("<h2>ماۋزۇ</h2>");
    const { commands, deps } = engine(editor, [editor.querySelector("h2")!.firstChild as Text]);
    expect(paint(editor, { ...PLAIN, italic: true }, deps)).toBe(1);
    expect(commands).toEqual(["italic"]);
  });

  it("does nothing to a selection of spaces", () => {
    const editor = noteWith("<div>   </div>");
    const { commands, deps } = engine(editor, [editor.querySelector("div")!.firstChild as Text]);
    expect(paint(editor, { ...PLAIN, bold: true, color: "rgb(1, 2, 3)" }, deps)).toBe(0);
    expect(commands).toEqual([]);
  });
});
