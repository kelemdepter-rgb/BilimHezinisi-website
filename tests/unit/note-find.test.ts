// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { findInEditor, replaceHits } from "@/lib/notes/find";
import { rangeFor } from "@/lib/spellcheck/marks";

/**
 * Find and replace in the notebook, tested on a real DOM.
 *
 * The two behaviours worth pinning down are the ones a naive implementation
 * gets wrong: a phrase must never join two paragraphs into one match, and a
 * replacement must leave the markup around it exactly as it was.
 */
function editorWith(html: string): HTMLDivElement {
  const editor = document.createElement("div");
  editor.innerHTML = html;
  document.body.appendChild(editor);
  return editor;
}

describe("finding in a note", () => {
  it("finds every occurrence, in reading order", () => {
    const editor = editorWith("<p>كىتاب ئوقۇش</p><p>يەنە كىتاب</p>");
    const { hits } = findInEditor(editor, "كىتاب");
    expect(hits).toHaveLength(2);
    expect(hits[0].start).toBeLessThan(hits[1].start);
  });

  it("ignores diacritics, like the rest of the site", () => {
    // The same word with and without tashkil has to be one word to the finder.
    const editor = editorWith("<p>ٱلۡحَمۡدُ</p>");
    expect(findInEditor(editor, "الحمد").hits).toHaveLength(1);
  });

  it("never joins two paragraphs into one match", () => {
    const editor = editorWith("<p>ياخشى</p><p>كۈن</p>");
    expect(findInEditor(editor, "ياخشى كۈن").hits).toHaveLength(0);
  });

  it("finds nothing for an empty query", () => {
    const editor = editorWith("<p>مەزمۇن</p>");
    expect(findInEditor(editor, "   ").hits).toHaveLength(0);
  });

  it("never joins two lines into one match, whatever ends the line", () => {
    for (const html of [
      "ياخشى<br>كۈن",
      "<div>ياخشى</div>كۈن",
      "ياخشى<div>كۈن</div>",
      "<h2>ياخشى</h2><p>كۈن</p>",
      "<ul><li>ياخشى</li><li>كۈن</li></ul>",
      "<table><tbody><tr><td>ياخشى</td><td>كۈن</td></tr></tbody></table>",
    ]) {
      expect(findInEditor(editorWith(html), "ياخشى كۈن").hits, html).toHaveLength(0);
    }
    // And the same phrase on one line is still found.
    expect(findInEditor(editorWith("<p>ياخشى كۈن</p>"), "ياخشى كۈن").hits).toHaveLength(1);
  });
});

/**
 * Where each hit lands in the document: which text node it starts in, the
 * offset there, and the text it covers.
 *
 * The spellchecker's text map gained line-end separators (PROMPT-42), which
 * moved the FLATTENED offsets of everything after the first line. The hits
 * themselves must not move, and these are what the find bar paints and steps
 * through. The expected values were recorded from the map before that change
 * and are identical after it.
 */
function landings(html: string, query: string): [node: number, at: number, text: string][] {
  const editor = editorWith(html);
  // Every text node, counted independently of the map under test.
  const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
  const all: Node[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) all.push(node);

  const { map, hits } = findInEditor(editor, query);
  return hits.map((hit) => {
    const range = rangeFor(map, hit.start, hit.end)!;
    return [all.indexOf(range.startContainer), range.startOffset, range.toString()];
  });
}

describe("find lands where it always did", () => {
  const cases: [html: string, query: string, expected: ReturnType<typeof landings>][] = [
    ["<p>كىتاب ئوقۇش</p><p>يەنە كىتاب</p>", "كىتاب", [[0, 0, "كىتاب"], [1, 5, "كىتاب"]]],
    ["<p>ٱلۡحَمۡدُ</p>", "الحمد", [[0, 0, "ٱلۡحَمۡدُ"]]],
    ["<p>ياخشى</p><p>كۈن</p>", "ياخشى كۈن", []],
    ["<p>مەزمۇن</p>", "   ", []],
    [
      "<p>كىتاب <b>كىتاب</b></p><p>كىتاب</p>",
      "كىتاب",
      [[0, 0, "كىتاب"], [1, 0, "كىتاب"], [2, 0, "كىتاب"]],
    ],
    ["<p>كىتاب</p><p>كىتاب</p>", "كىتاب", [[0, 0, "كىتاب"], [1, 0, "كىتاب"]]],
    ["<p>ٱلۡحَمۡدُ للە</p>", "الحمد", [[0, 0, "ٱلۡحَمۡدُ"]]],
    [
      // The shape the find-and-replace spec types: a bare first line, then divs.
      "كىتاب بىر<div>كىتاب ئىككى</div><div>كىتاب ئۈچ</div>",
      "كىتاب",
      [[0, 0, "كىتاب"], [1, 0, "كىتاب"], [2, 0, "كىتاب"]],
    ],
    ["<p>كىتاب ئوقۇش</p>", "كىتاب", [[0, 0, "كىتاب"]]],
  ];

  for (const [html, query, expected] of cases) {
    it(`${html} — ${JSON.stringify(query)}`, () => {
      expect(landings(html, query)).toEqual(expected);
    });
  }
});

/**
 * Replacing, hit by hit (PROMPT-45).
 *
 * The notebook writes each replacement with one `insertText` command on that
 * hit's own Range — jsdom has no execCommand, so these tests write by
 * splicing the text node, which is what the three engines were measured to
 * do. What is pinned down here is everything around the write: which Ranges
 * are handed over, in which order, and that the markup around them is never
 * touched. The same four notes go through the real engines in
 * tests/notes-editing.spec.ts.
 */
const OLD = "ئالما";
const NEW = "ئۆرۈك";

/** The note shapes that a whole-document rewrite used to corrupt (N7). */
const SHAPES: [label: string, html: string][] = [
  [
    "a heading",
    '<h2>ئالما باغچىسى</h2><div>بۇ يىل ئالما كۆپ.</div><div style="text-align: center;">ئالما ۋە ئۆرۈك</div>',
  ],
  [
    "a citation",
    '<blockquote dir="rtl">ئالما دەرىخى ئېگىز.</blockquote><p dir="rtl" style="font-size:13px;color:#8a8a8a"><a href="/books/1/read?page=2">«ئالما» — 2-بەت</a></p><p><br></p>',
  ],
  ["a list", "<ul><li>ئالما</li><li>نەشپۈت ۋە ئالما</li></ul><div>ئالما يېگىنىم.</div>"],
  ["plain text", "ئالما بىر<div>ئالما ئىككى</div><div>ئالما ئۈچ</div>"],
];

/** Write over a Range the way the engines do: inside its own text node. */
function splice(text: string) {
  return (range: Range) => {
    const node = range.startContainer as Text;
    node.replaceData(range.startOffset, range.endOffset - range.startOffset, text);
  };
}

/** `html` with only its `ordinal`-th occurrence of `word` replaced. */
function replaceNth(html: string, word: string, ordinal: number, replacement: string): string {
  let at = -1;
  for (let seen = 0; seen <= ordinal; seen += 1) at = html.indexOf(word, at + 1);
  return html.slice(0, at) + replacement + html.slice(at + word.length);
}

describe("replacing in a note", () => {
  for (const [label, html] of SHAPES) {
    it(`replace-all keeps the shape of a note that starts with ${label}`, () => {
      const editor = editorWith(html);
      const before = editor.innerHTML;
      const count = replaceHits(editor, OLD, "all", splice(NEW));
      expect(count).toBe(before.split(OLD).length - 1);
      expect(editor.innerHTML).toBe(before.split(OLD).join(NEW));
    });

    it(`replace-one keeps the shape of a note that starts with ${label}`, () => {
      const editor = editorWith(html);
      const before = editor.innerHTML;
      expect(replaceHits(editor, OLD, 1, splice(NEW))).toBe(1);
      expect(editor.innerHTML).toBe(replaceNth(before, OLD, 1, NEW));
    });
  }

  it("hands the hits over from the last to the first", () => {
    const editor = editorWith("<p>كىتاب <b>كىتاب</b></p><p>كىتاب</p>");
    const order: number[] = [];
    replaceHits(editor, "كىتاب", "all", (range, ordinal) => {
      order.push(ordinal);
      splice("دەپتەر")(range);
    });
    expect(order).toEqual([2, 1, 0]);
    expect(editor.innerHTML).toBe("<p>دەپتەر <b>دەپتەر</b></p><p>دەپتەر</p>");
  });

  it("hands over Ranges that never leave one text node", () => {
    const editor = editorWith("<p>كىتاب <b>كىتاب</b> كىتاب</p>");
    replaceHits(editor, "كىتاب", "all", (range) => {
      expect(range.startContainer).toBe(range.endContainer);
      expect(range.startContainer.nodeType).toBe(Node.TEXT_NODE);
      expect(range.toString()).toBe("كىتاب");
      splice("دەپتەر")(range);
    });
  });

  it("finds its place again when an engine rebuilds a text node instead of editing it", () => {
    const editor = editorWith("<p>كىتاب ۋە كىتاب</p><p>كىتاب</p>");
    replaceHits(editor, "كىتاب", "all", (range) => {
      const node = range.startContainer as Text;
      const data = node.data;
      node.replaceWith(
        document.createTextNode(data.slice(0, range.startOffset) + "دەپتەر" + data.slice(range.endOffset)),
      );
    });
    expect(editor.innerHTML).toBe("<p>دەپتەر ۋە دەپتەر</p><p>دەپتەر</p>");
  });

  it("replaces the same hit the find bar numbered", () => {
    const html = "كىتاب بىر<div>كىتاب ئىككى</div><div>كىتاب ئۈچ</div>";
    for (const ordinal of [0, 1, 2]) {
      const editor = editorWith(html);
      const { map, hits } = findInEditor(editor, "كىتاب");
      const shown = rangeFor(map, hits[ordinal].start, hits[ordinal].end)!;
      let written: Range | null = null;
      replaceHits(editor, "كىتاب", ordinal, (range) => {
        written = range;
      });
      expect(written!.startContainer).toBe(shown.startContainer);
      expect(written!.startOffset).toBe(shown.startOffset);
    }
  });

  it("writes nothing for a hit that is not there, or an empty query", () => {
    const editor = editorWith("<p>كىتاب</p>");
    const write = () => {
      throw new Error("must not be called");
    };
    expect(replaceHits(editor, "كىتاب", 3, write)).toBe(0);
    expect(replaceHits(editor, "كىتاب", -1, write)).toBe(0);
    expect(replaceHits(editor, "   ", "all", write)).toBe(0);
    expect(replaceHits(editor, "دەپتەر", "all", write)).toBe(0);
    expect(editor.innerHTML).toBe("<p>كىتاب</p>");
  });

  it("replaces the ORIGINAL spelling when the query was written without tashkil", () => {
    const editor = editorWith("<p>ٱلۡحَمۡدُ للە</p>");
    expect(replaceHits(editor, "الحمد", "all", splice("شۈكۈر"))).toBe(1);
    expect(editor.innerHTML).toBe("<p>شۈكۈر للە</p>");
  });

  it("survives a replacement that contains what was searched for", () => {
    const editor = editorWith("<p>ئالما ۋە ئالما</p>");
    expect(replaceHits(editor, OLD, "all", splice(`${OLD} شېكەر`))).toBe(2);
    expect(editor.innerHTML).toBe("<p>ئالما شېكەر ۋە ئالما شېكەر</p>");
  });
});
