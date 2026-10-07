// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { isSingleToken, tokenize } from "@/lib/spellcheck/dictionary";
import {
  LINE_SEPARATOR,
  offsetOf,
  rangeFor,
  readTextMap,
  wordAtOffset,
  wordRange,
  type MarkedWord,
} from "@/lib/spellcheck/marks";

/**
 * The spellchecker's text map, on a real DOM.
 *
 * What is pinned down here is the owner's report of 2026-10-07 (N1): a word at
 * the end of one line and the first word of the next were read as ONE word,
 * underlined as one wrong word, and taking a suggestion deleted the second
 * word together with the line break. Every fixture is invented text.
 */
function editorWith(html: string): HTMLDivElement {
  const editor = document.createElement("div");
  editor.innerHTML = html;
  document.body.appendChild(editor);
  return editor;
}

const words = (html: string) => tokenize(readTextMap(editorWith(html)).text).map((t) => t.word);

describe("a line end is a word boundary", () => {
  // The table from PROMPT-42, prototyped in Chromium 141 before this was built.
  const table: [html: string, text: string, tokens: string[]][] = [
    [
      "ئۇسۇلى بىلەن سىلىشتۇرسۇ<div>كىشىلەر ياخشى</div>",
      "ئۇسۇلى بىلەن سىلىشتۇرسۇ\nكىشىلەر ياخشى",
      ["ئۇسۇلى", "بىلەن", "سىلىشتۇرسۇ", "كىشىلەر", "ياخشى"],
    ],
    ["سىلىشتۇرسۇ<br>كىشىلەر", "سىلىشتۇرسۇ\nكىشىلەر", ["سىلىشتۇرسۇ", "كىشىلەر"]],
    ["<h2>كىرىش سۆز</h2><div>بىرىنچى</div>", "كىرىش سۆز\nبىرىنچى", ["كىرىش", "سۆز", "بىرىنچى"]],
    ["<div>سى<b>لىش</b>تۇر</div>", "سىلىشتۇر", ["سىلىشتۇر"]],
    [
      "<ul><li>بىر</li><li>ئىككى<ul><li>ئۈچ</li></ul></li></ul>تۆت",
      "بىر\nئىككى\nئۈچ\nتۆت",
      ["بىر", "ئىككى", "ئۈچ", "تۆت"],
    ],
    ["<div>ئالما</div>ئۆرۈك", "ئالما\nئۆرۈك", ["ئالما", "ئۆرۈك"]],
  ];

  for (const [html, text, tokens] of table) {
    it(`reads ${html} as ${tokens.length} word(s)`, () => {
      const map = readTextMap(editorWith(html));
      expect(map.text).toBe(text);
      expect(tokenize(map.text).map((t) => t.word)).toEqual(tokens);
    });
  }

  it("separates table cells and rows", () => {
    const html =
      "<table><tbody><tr><td>ئالما</td><td>ئۆرۈك</td></tr><tr><th>شاپتۇل</th><td>ئۈزۈم</td></tr></tbody></table>";
    expect(readTextMap(editorWith(html)).text).toBe("ئالما\nئۆرۈك\nشاپتۇل\nئۈزۈم");
  });

  it("puts one separator across empty blocks, never two in a row", () => {
    expect(readTextMap(editorWith("<div>ئالما</div><div><br></div><div>ئۆرۈك</div>")).text).toBe(
      "ئالما\nئۆرۈك",
    );
    expect(readTextMap(editorWith("ئالما<br><br><br>ئۆرۈك")).text).toBe("ئالما\nئۆرۈك");
    expect(readTextMap(editorWith("<p>ئالما</p><hr><p>ئۆرۈك</p>")).text).toBe("ئالما\nئۆرۈك");
  });

  it("never starts or ends with a separator", () => {
    expect(readTextMap(editorWith("<div><br></div><div>ئالما</div>")).text).toBe("ئالما");
    expect(readTextMap(editorWith("<br>ئالما<br>")).text).toBe("ئالما");
    expect(readTextMap(editorWith("<div><br></div>")).text).toBe("");
  });

  it("breaks at an empty block between two runs of text in the same block", () => {
    // The browser draws a line break there, so the map must too.
    expect(readTextMap(editorWith("<div>ئالما<div></div>ئۆرۈك</div>")).text).toBe("ئالما\nئۆرۈك");
  });

  it("keeps a word split across inline formatting as one word", () => {
    for (const tag of ["b", "strong", "i", "em", "u", "s", "sub", "sup", "code", "span", "font"]) {
      expect(words(`<div>سى<${tag}>لىش</${tag}>تۇر</div>`), tag).toEqual(["سىلىشتۇر"]);
    }
    expect(words('<p>سى<a href="/books/1/read">لىش</a>تۇر</p>')).toEqual(["سىلىشتۇر"]);
    expect(words("<p>سى<b><i>لى</i>ش</b>تۇر</p>")).toEqual(["سىلىشتۇر"]);
  });

  it("leaves empty text nodes out of the map", () => {
    const editor = editorWith("<div>ئالما</div>");
    editor.appendChild(document.createTextNode(""));
    editor.insertAdjacentHTML("beforeend", "<div>ئۆرۈك</div>");
    const map = readTextMap(editor);
    expect(map.text).toBe("ئالما\nئۆرۈك");
    expect(map.nodes.map((node) => node.data)).toEqual(["ئالما", "ئۆرۈك"]);
  });
});

describe("offsets across separators", () => {
  const html =
    "<h2>كىرىش سۆز</h2>بىرىنچى قۇر<br>ئىككىنچى <b>قۇر</b><div>ئۈچىنچى</div><ul><li>تۆتىنچى</li></ul>";

  it("starts every node where its own text begins", () => {
    const map = readTextMap(editorWith(html));
    map.nodes.forEach((node, index) => {
      expect(map.text.slice(map.starts[index], map.starts[index] + node.data.length)).toBe(node.data);
    });
  });

  it("round-trips every position through offsetOf and rangeFor", () => {
    const map = readTextMap(editorWith(html));
    map.nodes.forEach((node, index) => {
      const nextStart = map.starts[index + 1];
      for (let within = 0; within <= node.data.length; within += 1) {
        const flat = offsetOf(map, node, within)!;
        // The end of a node that is followed straight away by another (no line
        // end between) belongs to the next one, by design; everything else
        // comes back exactly where it started.
        if (within === node.data.length && nextStart === flat) continue;
        const range = rangeFor(map, flat, flat)!;
        expect(range.startContainer).toBe(node);
        expect(range.startOffset).toBe(within);
      }
    });
  });

  it("resolves an offset on a separator to the end of the line before it", () => {
    const map = readTextMap(editorWith("سىلىشتۇرسۇ<div>كىشىلەر</div>"));
    const separator = map.text.indexOf(LINE_SEPARATOR);
    const range = rangeFor(map, separator, separator)!;
    expect(range.startContainer).toBe(map.nodes[0]);
    expect(range.startOffset).toBe(map.nodes[0].data.length);
  });

  it("gives every word a range that reads back as that word", () => {
    const map = readTextMap(editorWith(html));
    for (const token of tokenize(map.text)) {
      expect(rangeFor(map, token.start, token.end)!.toString(), token.word).toBe(token.word);
    }
  });

  it("does not open the previous line's last word from the next line's first letter", () => {
    const map = readTextMap(editorWith("بىرىنچى سىلىشتۇرسۇ<div>كىشىلەر</div>"));
    const misspelled = tokenize(map.text).find((token) => token.word === "سىلىشتۇرسۇ")!;
    const nextLine = map.starts[1];
    expect(wordAtOffset([misspelled], nextLine)).toBeNull();
    // The end of the word itself still opens it — a finger lands where it lands.
    expect(wordAtOffset([misspelled], misspelled.end)).toBe(misspelled);
  });
});

describe("taking a suggestion", () => {
  it("refuses the glued word the old map produced, so nothing is deleted", () => {
    const editor = editorWith("ئۇسۇلى بىلەن سىلىشتۇرسۇ<div>كىشىلەر ياخشى</div>");
    const before = editor.innerHTML;
    // Offsets as the old map — no separator — would have reported them.
    const glued: MarkedWord = { word: "سىلىشتۇرسۇكىشىلەر", start: 13, end: 30 };
    expect(wordRange(readTextMap(editor), glued)).toBeNull();
    expect(editor.innerHTML).toBe(before);
  });

  it("refuses a mark that spans two blocks, though the Range would read as the word", () => {
    const editor = editorWith("<div>ئال</div><div>ما</div>");
    const map = readTextMap(editor);
    // Range.toString() over these offsets is «ئالما» — exactly the trap N1
    // fell into. A hand-made mark spanning the separator is still refused.
    expect(rangeFor(map, 0, 6)!.toString()).toBe("ئالما");
    expect(wordRange(map, { word: "ئالما", start: 0, end: 6 })).toBeNull();
  });

  it("refuses once the word under the mark has changed", () => {
    const editor = editorWith("<div>بۇ ئۇيغۇر سۆز</div>");
    const map = readTextMap(editor);
    const [, mark] = tokenize(map.text);
    // Two letters typed before it shift it out from under its offsets.
    map.nodes[0].data = `ab${map.nodes[0].data}`;
    expect(wordRange(readTextMap(editor), mark)).toBeNull();
  });

  it("accepts every word that is still there, whatever surrounds it", () => {
    const map = readTextMap(
      editorWith(
        "<h2>كىرىش سۆز</h2>بىرىنچى قۇر<br>ئىككىنچى <b>قۇر</b><div>ئۈ<i>چى</i>نچى</div><ul><li>تۆتىنچى</li></ul>",
      ),
    );
    for (const token of tokenize(map.text)) {
      expect(wordRange(map, token)?.toString(), token.word).toBe(token.word);
    }
  });
});

describe("what the personal dictionary admits", () => {
  it("takes exactly one word", () => {
    expect(isSingleToken("ئۇيغۇر")).toBe(true);
    expect(isSingleToken("ئاق-قارا")).toBe(true);
  });

  it("refuses anything glued, padded or split", () => {
    for (const text of ["", "ئۇيغۇر سۆز", "سىلىشتۇرسۇ\nكىشىلەر", " ئۇيغۇر", "ئۇيغۇر.", "abc"]) {
      expect(isSingleToken(text), JSON.stringify(text)).toBe(false);
    }
  });
});
