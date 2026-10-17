// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { describeLink, linkAt, openLink } from "@/lib/notes/links";
import { ayaHref, citationLabel, readerHref } from "@/lib/notes/insert";

/**
 * What the link card says about a link in a note, and which links it will
 * ever open (PROMPT-49). The card itself is tests/notes-links.spec.ts.
 */
const NOTE = "https://bilimhezinisi.com/notes/12";

describe("describeLink", () => {
  it("names the book and the page of a library citation, from the citation's own label", () => {
    const citation = { bookId: 34, title: "تارىخى رەشىدى", author: "مىرزا ھەيدەر", pageNo: 3, passage: "", query: "خان" };
    const where = describeLink(readerHref(citation), citationLabel(citation), NOTE);
    expect(where).toEqual({
      kind: "book",
      label: "كىتاب: «تارىخى رەشىدى» — 3-بەت",
      url: "https://bilimhezinisi.com/books/34/read?page=3&q=%D8%AE%D8%A7%D9%86",
    });
  });

  it("leaves out the page of a title match, which has none", () => {
    const citation = { bookId: 7, title: "قۇتادغۇبىلىك", author: "", pageNo: 0, passage: "", query: "بىلىك" };
    expect(describeLink(readerHref(citation), citationLabel(citation), NOTE).label).toBe("كىتاب: «قۇتادغۇبىلىك»");
  });

  it("still says it is a book when the link's text names no title", () => {
    expect(describeLink("/books/5/read?page=12", "بۇ يەردە", NOTE).label).toBe("كىتاب — 12-بەت");
  });

  it("names the verse of a Qur'an citation", () => {
    const where = describeLink(ayaHref(2, 255), "قۇرئان كەرىم — بەقەرە — 2:255", NOTE);
    expect(where).toEqual({ kind: "quran", label: "قۇرئان: 2:255", url: "https://bilimhezinisi.com/quran/2?aya=255" });
    expect(describeLink("/quran/36", "ياسىن", NOTE).label).toBe("قۇرئان: 36-سۈرە");
  });

  it("gives the host name of an address elsewhere, and of another page here", () => {
    expect(describeLink("https://example.org/a/b?c=1", "بىر مەنبە", NOTE)).toEqual({
      kind: "external",
      label: "example.org",
      url: "https://example.org/a/b?c=1",
    });
    expect(describeLink("http://example.org", "x", NOTE).url).toBe("http://example.org/");
    expect(describeLink("/about", "ھەققىدە", NOTE)).toEqual({
      kind: "site",
      label: "bilimhezinisi.com",
      url: "https://bilimhezinisi.com/about",
    });
  });

  it("resolves a relative link against the note, as the browser would", () => {
    const where = describeLink("../books/9/read?page=1", "«ئاتا»", NOTE);
    expect(where.kind).toBe("book");
    expect(where.url).toBe("https://bilimhezinisi.com/books/9/read?page=1");
  });

  it("an absolute address on this site is this site's", () => {
    expect(describeLink("https://bilimhezinisi.com/books/9/read?page=4", "«ئاتا»", NOTE).kind).toBe("book");
    // Same name, other scheme: another origin, so only a host name.
    expect(describeLink("http://bilimhezinisi.com/books/9/read", "«ئاتا»", NOTE).kind).toBe("external");
  });

  it("never opens anything but http(s) and this site's paths", () => {
    const unsafe = [
      "javascript:alert(1)",
      "  JaVaScRiPt:alert(1)",
      "java\tscript:alert(1)",
      "java\nscript:alert(1)",
      "\u0001javascript:alert(1)",
      "vbscript:msgbox(1)",
      "data:text/html,<script>alert(1)</script>",
      "mailto:someone@example.com",
      "tel:+10000000000",
      "ftp://example.org/file",
      "file:///C:/Windows/win.ini",
      "blob:https://bilimhezinisi.com/1234",
      "about:blank",
      // A user name in front of the host: it goes to the host after the @.
      "https://bilimhezinisi.com@example.org/",
      "https://user:secret@example.org/",
      "",
      "   ",
      "http://[::1",
    ];
    for (const href of unsafe) {
      const where = describeLink(href, "x", NOTE);
      expect(where.url, JSON.stringify(href)).toBeNull();
      expect(where.kind, JSON.stringify(href)).toBe("blocked");
    }
  });

  it("shows a blocked address as written, cut short when it is long", () => {
    expect(describeLink("mailto:someone@example.com", "x", NOTE).label).toBe("mailto:someone@example.com");
    const long = `data:text/plain,${"a".repeat(500)}`;
    const label = describeLink(long, "x", NOTE).label;
    expect(label.length).toBe(201);
    expect(label.endsWith("…")).toBe(true);
  });

  it("takes only a plain number for a page or a verse", () => {
    expect(describeLink("/books/5/read?page=3x", "«ب»", NOTE).label).toBe("كىتاب: «ب»");
    expect(describeLink("/books/5/read?page=0", "«ب»", NOTE).label).toBe("كىتاب: «ب»");
    expect(describeLink("/quran/2?aya=-1", "", NOTE).label).toBe("قۇرئان: 2-سۈرە");
    // Not the reader: another page of the site, by its host.
    expect(describeLink("/books/5", "«ب»", NOTE).kind).toBe("site");
  });
});

describe("linkAt", () => {
  it("finds the link a tap landed in, and only inside the note", () => {
    const outside = document.createElement("a");
    outside.href = "/elsewhere";
    outside.innerHTML = "<span>x</span>";
    const editor = document.createElement("div");
    editor.innerHTML = `<p>متن <a href="/books/1/read?page=2"><b>«ئاتا»</b></a> <a name="x">بەلگە</a></p>`;
    document.body.append(editor, outside);

    const bold = editor.querySelector("b")!;
    expect(linkAt(editor, bold)).toBe(editor.querySelector("a"));
    expect(linkAt(editor, editor.querySelector("p"))).toBeNull();
    // An anchor with no href is not a link.
    expect(linkAt(editor, editor.querySelector("a[name]"))).toBeNull();
    expect(linkAt(editor, outside.firstChild)).toBeNull();
    expect(linkAt(editor, null)).toBeNull();
  });
});

describe("openLink", () => {
  afterEach(() => vi.restoreAllMocks());

  it("opens a new tab without an opener or a referrer, and nothing it may not open", () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    expect(openLink(describeLink("/quran/1?aya=2", "", NOTE))).toBe(true);
    expect(open).toHaveBeenCalledWith("https://bilimhezinisi.com/quran/1?aya=2", "_blank", "noopener,noreferrer");
    expect(openLink(describeLink("javascript:alert(1)", "", NOTE))).toBe(false);
    expect(open).toHaveBeenCalledTimes(1);
  });
});
