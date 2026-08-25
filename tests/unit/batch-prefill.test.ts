import { describe, expect, it } from "vitest";
import {
  batchSize,
  firstHeading,
  importableRows,
  openingParagraph,
  projectBudget,
  readyToImport,
  rowKey,
  sortRows,
  suggestMetadata,
  titleFromCleanFileName,
  type BatchRow,
} from "@/lib/books/batch";

/**
 * The batch importer's pre-fill.
 *
 * The rule under test throughout: a suggestion is only ever made from
 * something the file actually contains. A library of religious and historical
 * texts is exactly the wrong place for a plausible-looking guess at an author,
 * so an unnamed author stays empty and is not marked as a suggestion either.
 */

function row(overrides: Partial<BatchRow> = {}): BatchRow {
  return {
    id: "a::1",
    fileName: "a.docx",
    size: 1,
    format: "DOCX",
    contentFormat: "markdown",
    status: "ready",
    error: "",
    pages: ["بەت"],
    textBytes: 10,
    fileHash: "h",
    duplicate: null,
    skipDuplicate: false,
    selected: false,
    meta: { title: "ماۋزۇ", author: "", description: "", categoryId: "3", status: "draft" },
    suggested: { title: false, author: false, description: false },
    bookId: null,
    ...overrides,
  };
}

describe("cleaning up a filename", () => {
  it("drops the extension, the numbering and the separators", () => {
    expect(titleFromCleanFileName("03_قۇتادغۇ-بىلىك.docx")).toBe("قۇتادغۇ بىلىك");
    expect(titleFromCleanFileName("1 - دىۋان.txt")).toBe("دىۋان");
    expect(titleFromCleanFileName("12) تارىخ.md")).toBe("تارىخ");
    expect(titleFromCleanFileName("تەپسىر.docx")).toBe("تەپسىر");
  });

  it("leaves a number that is part of the title alone", () => {
    // Only a LEADING index is numbering; a year in the middle is the title.
    expect(titleFromCleanFileName("تارىخ 1949 يىلى.docx")).toBe("تارىخ 1949 يىلى");
  });
});

describe("reading the document's own first heading", () => {
  it("takes a Markdown heading", () => {
    expect(firstHeading("# قۇتادغۇ بىلىك\n\nبىرىنچى ئابزاس.")).toBe("قۇتادغۇ بىلىك");
    expect(firstHeading("مۇقەددىمە\n\n## ئىككىنچى باب\n")).toBe("ئىككىنچى باب");
  });

  it("refuses a heading that is really a paragraph", () => {
    expect(firstHeading(`# ${"سۆز ".repeat(60)}`)).toBe("");
  });

  it("returns nothing when the file has no heading", () => {
    expect(firstHeading("ئاددىي تېكىست.\n\nيەنە بىر ئابزاس.")).toBe("");
  });
});

describe("reading an opening paragraph", () => {
  it("skips the heading and takes the first real paragraph", () => {
    const text = "# ماۋزۇ\n\n" + "بۇ كىتاب ئۇيغۇر تىلىنىڭ تارىخى ھەققىدە يېزىلغان بىر ئەسەردۇر.";
    expect(openingParagraph(text)).toBe(
      "بۇ كىتاب ئۇيغۇر تىلىنىڭ تارىخى ھەققىدە يېزىلغان بىر ئەسەردۇر.",
    );
  });

  it("trims a long paragraph on a word boundary", () => {
    const long = "ئۇيغۇر تىلى ھەققىدە ".repeat(40);
    const description = openingParagraph(long);
    expect(description.endsWith("…")).toBe(true);
    expect(description.length).toBeLessThanOrEqual(230);

    // The cut landed where a space was, so no word is left cut in half.
    const body = description.slice(0, -1);
    expect(long.trim().startsWith(body)).toBe(true);
    expect(long.trim()[body.length]).toBe(" ");
  });

  it("ignores a paragraph too short to describe anything", () => {
    expect(openingParagraph("قىسقا.\n\nيەنە.")).toBe("");
  });
});

describe("suggesting metadata", () => {
  it("prefers the document's own heading over its filename", () => {
    const suggestion = suggestMetadata({
      fileName: "01_kitab.docx",
      text: "# قۇتادغۇ بىلىك\n\n" + "ئۇيغۇر ئەدەبىياتىنىڭ ئەڭ مۇھىم ئەسەرلىرىدىن بىرى بولۇپ ھېسابلىنىدۇ.",
    });
    expect(suggestion.meta.title).toBe("قۇتادغۇ بىلىك");
    expect(suggestion.suggested.title).toBe(true);
  });

  it("uses the file's own author, and NEVER invents one", () => {
    const named = suggestMetadata({
      fileName: "a.docx",
      text: "تېكىست",
      embeddedAuthor: "يۈسۈپ خاس ھاجىپ",
    });
    expect(named.meta.author).toBe("يۈسۈپ خاس ھاجىپ");
    expect(named.suggested.author).toBe(true);

    const anonymous = suggestMetadata({ fileName: "a.docx", text: "تېكىست" });
    expect(anonymous.meta.author).toBe("");
    expect(anonymous.suggested.author).toBe(false);
  });

  it("ignores the junk Word leaves in the title property", () => {
    const suggestion = suggestMetadata({
      fileName: "دىۋان.docx",
      text: "ئاددىي تېكىست",
      embeddedTitle: "Microsoft Word - report.doc",
    });
    expect(suggestion.meta.title).toBe("دىۋان");
  });

  it("still marks the filename fallback as a suggestion", () => {
    const suggestion = suggestMetadata({ fileName: "تارىخ.txt", text: "قىسقا" });
    expect(suggestion.meta.title).toBe("تارىخ");
    expect(suggestion.suggested.title).toBe(true);
    expect(suggestion.suggested.description).toBe(false);
  });
});

describe("what the batch will write", () => {
  it("counts only the rows that will actually be imported", () => {
    const rows = [
      row({ id: "a::1", pages: ["x", "y"], textBytes: 100 }),
      row({ id: "b::2", status: "failed", pages: ["z"], textBytes: 50 }),
      row({
        id: "c::3",
        pages: ["z"],
        textBytes: 50,
        duplicate: { id: 4, title: "بار", status: "published" },
        skipDuplicate: true,
      }),
    ];
    expect(importableRows(rows).map((item) => item.id)).toEqual(["a::1"]);
    expect(batchSize(rows)).toEqual({ pages: 2, bytes: 100 });
  });

  it("imports a duplicate when the admin says so", () => {
    const rows = [
      row({ duplicate: { id: 4, title: "بار", status: "published" }, skipDuplicate: false }),
    ];
    expect(importableRows(rows)).toHaveLength(1);
  });

  it("refuses to start until every row has a title and a category", () => {
    expect(readyToImport([row()])).toBe(true);
    expect(readyToImport([row({ meta: { ...row().meta, title: "  " } })])).toBe(false);
    expect(readyToImport([row({ meta: { ...row().meta, categoryId: "" } })])).toBe(false);
    expect(readyToImport([])).toBe(false);
    // A row that failed to extract does not block the ones that did.
    expect(readyToImport([row(), row({ id: "b::2", status: "failed" })])).toBe(true);
  });
});

describe("sorting the review list", () => {
  const rows = [
    row({ id: "b::2", fileName: "b.docx", size: 10, pages: ["1"] }),
    row({ id: "a::1", fileName: "a.docx", size: 30, pages: ["1", "2", "3"] }),
  ];

  it("leaves the picked order alone by default", () => {
    expect(sortRows(rows, "picked").map((item) => item.id)).toEqual(["b::2", "a::1"]);
  });

  it("sorts by name, size and page count", () => {
    expect(sortRows(rows, "name").map((item) => item.fileName)).toEqual(["a.docx", "b.docx"]);
    expect(sortRows(rows, "size").map((item) => item.size)).toEqual([30, 10]);
    expect(sortRows(rows, "pages").map((item) => item.pages.length)).toEqual([3, 1]);
  });
});

describe("the row key", () => {
  it("identifies a file by name and size, which survives a reload", () => {
    expect(rowKey({ name: "a.docx", size: 42 })).toBe("a.docx::42");
  });
});

describe("the free-tier budget", () => {
  const base = {
    dbBytes: 400 * 1024 * 1024,
    safeBytes: 425 * 1024 * 1024,
    bytesPerPage: 5000,
    available: true,
  };

  it("estimates from the measured cost of a stored page", () => {
    const budget = projectBudget({ ...base, pages: 1000, textBytes: 1 });
    expect(budget.estimatedBytes).toBe(5_000_000);
    expect(budget.projectedBytes).toBe(base.dbBytes + 5_000_000);
  });

  it("falls back to the text size when nothing has been measured yet", () => {
    const budget = projectBudget({ ...base, bytesPerPage: 0, pages: 10, textBytes: 1000 });
    expect(budget.estimatedBytes).toBe(2600);
  });

  it("warns exactly when the batch would cross the safe line", () => {
    // 25 MB of room. 5,000 pages at 5,000 bytes each is just under it.
    const under = projectBudget({ ...base, pages: 5000, textBytes: 0 });
    expect(under.projectedBytes).toBeLessThanOrEqual(base.safeBytes);
    expect(under.overBudget).toBe(false);

    const over = projectBudget({ ...base, pages: 5400, textBytes: 0 });
    expect(over.projectedBytes).toBeGreaterThan(base.safeBytes);
    expect(over.overBudget).toBe(true);
  });

  it("never invents a warning it cannot justify", () => {
    // Nothing measured: a warning here would teach the admin to ignore them.
    const budget = projectBudget({
      ...base,
      available: false,
      pages: 1_000_000,
      textBytes: 0,
    });
    expect(budget.overBudget).toBe(false);
  });
});
