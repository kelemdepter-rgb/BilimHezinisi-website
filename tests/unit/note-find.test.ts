// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { findInEditor, replacedHtml } from "@/lib/notes/find";

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
