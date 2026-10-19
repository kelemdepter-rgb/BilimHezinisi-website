/**
 * A book shaped like the one the owner reported (PROMPT-51), in invented
 * Uyghur: a Word table of contents on its first two pages — enumerated
 * labels, the printed page number after each link as plain text, the first
 * chapter on the contents' last page below its last link — then chapters as
 * headings, a repeated chapter title, an entry whose label joins a heading and
 * the subtitle after it, footnotes and an endnote with their back-links, a
 * link whose target is only body text, and one that leads nowhere.
 *
 * Shared by the resolver's unit tests, the SQL test and the e2e seed, so all
 * three look at the same book. Nothing here is a real book's text.
 */

export const LINKED_PAGE_COUNT = 32;

export type TocEntry = {
  /** The fragment the entry links to. */
  fragment: string;
  /** The label as the reader sees it. */
  label: string;
  /** The heading it names, or null when the book has none. */
  heading: string | null;
  /** The page that heading is on. */
  page: number | null;
};

/** In document order, as the contents page lists them. */
export const LINKED_TOC: TocEntry[] = [
  { fragment: "QBH1", label: "1. تاغ باغرىدىكى يېزا", heading: "تاغ باغرىدىكى يېزا", page: 2 },
  { fragment: "QBH2", label: "2. دەريا بويىدىكى ئۆي", heading: "دەريا بويىدىكى ئۆي", page: 6 },
  { fragment: "QBH3", label: "3. خۇلاسە", heading: "خۇلاسە", page: 12 },
  // The page number inside the label, after dot leaders.
  { fragment: "_Toc104", label: "4. قىش كېچىلىرى ..... 18", heading: "قىش كېچىلىرى", page: 18 },
  // The same title again: it must land on the SECOND «خۇلاسە».
  { fragment: "QBH5", label: "5. خۇلاسە", heading: "خۇلاسە", page: 24 },
  // The heading plus the subtitle after it.
  { fragment: "QBH6", label: "6. باھار كەلگەندە ۋە يېڭى ئۈمىدلەر", heading: "باھار كەلگەندە", page: 27 },
  // Arabic-Indic enumeration, the chapter far outside the first window.
  { fragment: "QBH7", label: "٧. يىراقتىكى شەھەر", heading: "يىراقتىكى شەھەر", page: 30 },
  // Only body text carries it: the phrase search finds it.
  { fragment: "QBH8", label: "8. ئالتۇن قۇملۇق ھېكايىسى", heading: null, page: 20 },
  // Nowhere in the book.
  { fragment: "QBH9", label: "9. ھېچ يەردە يوق بىر باب", heading: null, page: null },
];

/** Where the body-only phrase is written, and the phrase itself. */
export const LINKED_BODY_PHRASE = "ئالتۇن قۇملۇق ھېكايىسى";
export const LINKED_BODY_PHRASE_PAGE = 20;

/** The footnote: its mark in the text and its note at the end. */
export const LINKED_FOOTNOTE = { mark: "footnote-1", back: "footnote-ref-1", textPage: 7, notePage: 32 };
/** The endnote, the same way. */
export const LINKED_ENDNOTE = { mark: "endnote-1", back: "endnote-ref-1", textPage: 15, notePage: 32 };

/**
 * Pages of a line or two. They sit just above the far chapter (page 30), so
 * the window loaded for it starts close enough to the screen that the reader
 * goes on to load the pages before it — WHILE the landing is being held. That
 * is the movement a landing must survive.
 */
export const LINKED_SHORT_PAGES = [25, 26, 27, 28, 29];

/** How many TOC entries go on the first page; the rest are on page 2. */
const FIRST_PAGE_ENTRIES = 5;

function filler(pageNo: number, paragraphs: number): string {
  const sentence = `${pageNo}-بەتتىكى ئويدۇرما تېكىست. بۇ جۈملە پەقەت سىناق ئۈچۈن يېزىلغان، ھېچقانداق كىتابتىن ئېلىنمىغان.`;
  return Array.from({ length: paragraphs }, () => `${sentence} ${sentence} ${sentence}`).join("\n\n");
}

function tocLine(entry: TocEntry): string {
  // turndown escapes «1.» at the start of a label; the printed page number
  // follows the link as plain text, unless the label carries it itself.
  const label = entry.label.replace(/^(\d+)\./, "$1\\.");
  const printed = entry.page !== null && !/\d+$/.test(entry.label) ? ` ${entry.page}` : "";
  return `[${label}](#${entry.fragment})${printed}`;
}

/** The book's pages, page 1 first. */
export function linkedBookPages(): string[] {
  const headingsOn = new Map<number, string>();
  for (const entry of LINKED_TOC) {
    if (entry.heading && entry.page !== null) headingsOn.set(entry.page, entry.heading);
  }

  return Array.from({ length: LINKED_PAGE_COUNT }, (_, index) => {
    const pageNo = index + 1;
    const parts: string[] = [];

    if (pageNo === 1) {
      parts.push("# مۇندەرىجە");
      parts.push(...LINKED_TOC.slice(0, FIRST_PAGE_ENTRIES).map(tocLine));
    }
    if (pageNo === 2) {
      parts.push(...LINKED_TOC.slice(FIRST_PAGE_ENTRIES).map(tocLine));
    }

    const short = LINKED_SHORT_PAGES.includes(pageNo);
    const heading = headingsOn.get(pageNo);
    if (heading) {
      // A chapter starts a little way down its page, after the end of the last
      // — except straight after the short pages, so its window starts near it.
      if (pageNo !== 2 && !short && !LINKED_SHORT_PAGES.includes(pageNo - 1)) parts.push(filler(pageNo, 2));
      parts.push(`# ${heading}`);
    }

    if (pageNo === LINKED_FOOTNOTE.textPage) {
      parts.push(`ئۇ كەچتە يېزىغا قايتىپ كەلدى[\\[1\\]](#${LINKED_FOOTNOTE.mark}). ${filler(pageNo, 1)}`);
    }
    if (pageNo === LINKED_ENDNOTE.textPage) {
      parts.push(`قار ئۈچ كۈن توختىماي ياغدى[\\[2\\]](#${LINKED_ENDNOTE.mark}). ${filler(pageNo, 1)}`);
    }
    if (pageNo === LINKED_BODY_PHRASE_PAGE) {
      parts.push(`بوۋاي بىزگە ${LINKED_BODY_PHRASE} دەپ ئاتالغان بىر قىسسىنى سۆزلەپ بەردى.`);
    }

    parts.push(short ? `${pageNo}-بەتتىكى قىسقا ئويدۇرما جۈملە.` : filler(pageNo, pageNo <= 2 ? 3 : 6));

    if (pageNo === LINKED_FOOTNOTE.notePage) {
      parts.push(
        `1. بۇ بىرىنچى ئىزاھات، يېزىنىڭ ئىسمى توغرىسىدا. [↑](#${LINKED_FOOTNOTE.back})`,
        `1. بۇ ئاخىرقى ئىزاھات، قار توغرىسىدا. [↑](#${LINKED_ENDNOTE.back})`,
      );
    }
    return parts.join("\n\n");
  });
}

/** The pages as rows, the shape book_pages and the outline take them in. */
export function linkedBookRows(): { page_no: number; content: string }[] {
  return linkedBookPages().map((content, index) => ({ page_no: index + 1, content }));
}
