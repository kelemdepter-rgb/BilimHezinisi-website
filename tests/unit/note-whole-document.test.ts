import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The notebook never rewrites a whole note through the editing commands.
 *
 * `selectAll` + `insertHTML` with the whole document was how find-and-replace
 * wrote its result back, and it merged the note's first block into whatever
 * came after it: a note starting with a heading became one long heading, one
 * starting with a citation ended up entirely inside the quote, and autosave
 * stored the damage 1.2 s later (N7, PROMPT-45). Selecting a Range around
 * every child instead, or deleting first, still corrupted a list.
 *
 * So: a whole document goes on screen only through the editor's own
 * `putDocument` (a direct, sanitized write), and the editing commands only
 * ever work at the caret or on one hit. This test fails if `selectAll` comes
 * back anywhere in the notebook's code, or if an `insertHTML` appears beyond
 * the two that insert at the caret — a citation and a paste. A new one has to
 * be added here on purpose, by someone who has checked it is not a document.
 */

const ROOT = process.cwd();
const SCANNED = ["components/notes", "lib/notes"];

/** Every caret-level insertHTML the notebook has, by file. */
const INSERT_HTML_AT_CARET: Record<string, number> = {
  // insertAtCaret (a citation or a verse) and onPaste.
  "components/notes/note-editor.tsx": 2,
};

function sourceFiles(): string[] {
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.tsx?$/.test(entry)) found.push(path);
    }
  };
  for (const dir of SCANNED) walk(join(ROOT, dir));
  return found;
}

/** The code without its comments, so prose explaining the rule does not trip it. */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

/** Assembled at runtime so this file never matches its own scan. */
const SELECT_ALL = new RegExp(`["'\`]${["select", "All"].join("")}["'\`]`);
const INSERT_HTML = new RegExp(`["'\`]${["insert", "HTML"].join("")}["'\`]`, "g");

describe("no whole-document rewrite through the editing commands", () => {
  it("scans the notebook's code", () => {
    // A path typo would make every other assertion here pass vacuously.
    expect(sourceFiles().map((path) => relative(ROOT, path).replaceAll("\\", "/"))).toEqual(
      expect.arrayContaining(["components/notes/note-editor.tsx", "components/notes/find-bar.tsx"]),
    );
  });

  it("never selects the whole note to write over it", () => {
    const offenders = sourceFiles()
      .filter((path) => SELECT_ALL.test(code(readFileSync(path, "utf8"))))
      .map((path) => relative(ROOT, path).replaceAll("\\", "/"));
    expect(offenders).toEqual([]);
  });

  it("uses insertHTML only at the caret, in the places listed here", () => {
    const found: Record<string, number> = {};
    for (const path of sourceFiles()) {
      const count = code(readFileSync(path, "utf8")).match(INSERT_HTML)?.length ?? 0;
      if (count > 0) found[relative(ROOT, path).replaceAll("\\", "/")] = count;
    }
    expect(found).toEqual(INSERT_HTML_AT_CARET);
  });
});
