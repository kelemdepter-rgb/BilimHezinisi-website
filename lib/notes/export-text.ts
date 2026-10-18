import { QURAN_ATTRIBUTION } from "@/lib/notes/attribution";
import { exportFileName, exportUrl, holdsVerse, parseNote, saveFile } from "@/lib/notes/export-shared";
import { normalizeTitle } from "@/lib/notes/save-protocol";
import { BLOCK_TAGS } from "@/lib/spellcheck/marks";

/**
 * A note as plain text, in the browser (PROMPT-50).
 *
 * Lines end where the spellchecker's line map ends them
 * (lib/spellcheck/marks.ts): on entering or leaving any block in BLOCK_TAGS,
 * and at every `<br>`. That map flattens text nodes for a tokenizer, so it
 * cannot hold what a reader of the file needs on top — an empty line the
 * writer left (`<div><br></div>` has no text node at all), the blank line
 * that sets a paragraph off from the next, a list's bullets — so this walk
 * applies the same rule and keeps those too:
 *
 *  - a `<div>` — what Enter makes — is a line, as on screen;
 *  - a paragraph, heading, quote, list, table or rule is set off by a blank
 *    line, as `.md-body` sets them off with a margin;
 *  - list items get «•» or their number, indented by depth;
 *  - table cells are joined with « | », one row a line;
 *  - a link keeps its address in brackets, absolute, when it has one.
 *
 * The title is the first line and the Qur'an's credit the last when a verse
 * is quoted. Saved as UTF-8 with a byte-order mark and Windows line ends:
 * older Windows editors show Uyghur as mojibake without the mark, and run
 * every line together without the CR.
 */

/** Blocks a blank line sets off from their neighbours. */
const SET_OFF: ReadonlySet<string> = new Set([
  "p",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "blockquote",
  "ul",
  "ol",
  "table",
  "pre",
  "hr",
]);

/** The width of «1. », so an item's later lines start under its first word. */
const ITEM_INDENT = "   ";

class Lines {
  readonly done: string[] = [];
  /** What leads the next line opened: an item's marker once, then its indent. */
  marker: string | null = null;
  indent = "";
  private current: string | null = null;
  private fresh = false;
  private gapWanted = false;

  private open() {
    if (this.gapWanted && this.done.length > 0 && this.done.at(-1) !== "") this.done.push("");
    this.gapWanted = false;
    this.current = this.marker ?? this.indent;
    this.marker = null;
    this.fresh = true;
  }

  write(text: string) {
    if (!text) return;
    if (this.current === null) this.open();
    const piece = this.fresh ? text.trimStart() : text;
    if (piece) this.fresh = false;
    this.current += piece;
  }

  /** A block ends: the line ends if one was started. */
  end() {
    if (this.current === null) return;
    this.done.push(this.current.trimEnd());
    this.current = null;
  }

  /** A `<br>`: the line ends even if nothing was written on it. */
  lineBreak() {
    if (this.current === null) this.open();
    this.end();
  }

  /** A paragraph's edge: what comes next starts after a blank line. */
  gap() {
    this.end();
    this.gapWanted = true;
  }
}

function isElement(node: Node): node is HTMLElement {
  return node.nodeType === 1;
}

/** Whitespace as the browser draws it: runs of it are one space; a no-break space stays a space. */
function collapse(text: string): string {
  return text.replace(/[ \t\n\r\f]+/g, " ").replace(/ /g, " ");
}

class TextWalk {
  readonly lines = new Lines();

  constructor(private readonly base: string) {}

  walk(parent: Node, pre = false, inList = false): void {
    for (const child of Array.from(parent.childNodes)) {
      if (child.nodeType === 3) {
        const text = child.textContent ?? "";
        if (!pre) this.lines.write(collapse(text));
        else {
          text.split("\n").forEach((line, index) => {
            if (index > 0) this.lines.lineBreak();
            this.lines.write(line);
          });
        }
      } else if (isElement(child)) {
        const tag = child.localName;
        if (tag === "br") this.lines.lineBreak();
        else if (BLOCK_TAGS.has(tag)) this.block(child, pre, inList);
        else if (tag === "a") {
          this.walk(child, pre, inList);
          const url = exportUrl(child, this.base);
          if (url && url !== (child.textContent ?? "").trim()) this.lines.write(` (${url})`);
        } else this.walk(child, pre, inList);
      }
    }
  }

  private block(element: HTMLElement, pre: boolean, inList: boolean): void {
    const tag = element.localName;
    // A list inside a list item is part of that item, not a paragraph of its own.
    const setOff = SET_OFF.has(tag) && !(inList && (tag === "ul" || tag === "ol"));
    if (setOff) this.lines.gap();
    else this.lines.end();

    if (tag === "ul" || tag === "ol") this.list(element);
    else if (tag === "table") this.table(element as HTMLTableElement);
    else if (tag === "hr") this.lines.write("* * *");
    else this.walk(element, pre || tag === "pre", inList);

    if (setOff) this.lines.gap();
    else this.lines.end();
  }

  private list(element: HTMLElement): void {
    const outer = this.lines.indent;
    let number = 0;
    for (const child of Array.from(element.childNodes)) {
      if (!isElement(child)) continue;
      const tag = child.localName;
      if (tag === "li") {
        number += 1;
        this.lines.end();
        this.lines.marker = outer + (element.localName === "ol" ? `${number}. ` : "• ");
        this.lines.indent = outer + ITEM_INDENT;
        this.walk(child, false, true);
        this.lines.end();
        this.lines.marker = null;
        this.lines.indent = outer;
      } else if (tag === "ul" || tag === "ol") {
        // Written straight into the list by the indent command: one level deeper.
        this.lines.indent = outer + ITEM_INDENT;
        this.list(child);
        this.lines.indent = outer;
      }
    }
  }

  private table(element: HTMLTableElement): void {
    for (const row of Array.from(element.rows)) {
      const cells = Array.from(row.cells).map((cell) => {
        const inner = new TextWalk(this.base);
        inner.walk(cell);
        inner.lines.end();
        return inner.lines.done.filter(Boolean).join(" ");
      });
      this.lines.write(cells.join(" | "));
      this.lines.end();
    }
  }
}

export function noteText(title: string, html: string): string {
  const root = parseNote(html);
  const walk = new TextWalk(window.location.href);
  walk.walk(root);
  walk.lines.end();

  const body = [...walk.lines.done];
  while (body[0] === "") body.shift();
  while (body.at(-1) === "") body.pop();

  const lines = [normalizeTitle(title), ""];
  lines.push(...body);
  if (holdsVerse(root)) lines.push("", QURAN_ATTRIBUTION);
  return `﻿${lines.join("\r\n")}\r\n`;
}

export function downloadText(title: string, html: string): void {
  saveFile(new Blob([noteText(title, html)], { type: "text/plain;charset=utf-8" }), exportFileName(title, "txt"));
}
