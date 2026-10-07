// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { findInEditor, replacedHtml } from "@/lib/notes/find";
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

describe("replacing in a note", () => {
  it("replaces every occurrence and leaves the markup alone", () => {
    const editor = editorWith("<p>كىتاب <b>كىتاب</b></p><p>كىتاب</p>");
    const { html, count } = replacedHtml(editor, "كىتاب", "دەپتەر", -1);
    expect(count).toBe(3);
    expect(html).toBe("<p>دەپتەر <b>دەپتەر</b></p><p>دەپتەر</p>");
  });

  it("replaces only the hit that was asked for", () => {
    const editor = editorWith("<p>كىتاب</p><p>كىتاب</p>");
    const { html, count } = replacedHtml(editor, "كىتاب", "دەپتەر", 1);
    expect(count).toBe(1);
    expect(html).toBe("<p>كىتاب</p><p>دەپتەر</p>");
  });

  it("does not touch the editor it was given", () => {
    const editor = editorWith("<p>كىتاب</p>");
    replacedHtml(editor, "كىتاب", "دەپتەر", -1);
    // The caller writes the result back itself, in one undoable command.
    expect(editor.innerHTML).toBe("<p>كىتاب</p>");
  });

  it("replaces the ORIGINAL spelling when the query was written without tashkil", () => {
    const editor = editorWith("<p>ٱلۡحَمۡدُ للە</p>");
    const { html, count } = replacedHtml(editor, "الحمد", "شۈكۈر", -1);
    expect(count).toBe(1);
    expect(html).toBe("<p>شۈكۈر للە</p>");
  });
});
