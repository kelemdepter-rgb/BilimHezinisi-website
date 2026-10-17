/**
 * A link in a note: where it goes, in words, and whether it may be opened
 * (PROMPT-49, N10).
 *
 * A citation inserted from the library or the Qur'an ends with a link back to
 * the exact place (lib/notes/insert.ts) — but inside the editor nothing
 * follows a link: in Chromium neither a click nor a Ctrl+click on one in a
 * contentEditable did anything. So a tap on a link opens a small card that
 * says where it goes and offers to open it in a new tab.
 *
 * Only two kinds of destination are ever opened: an http or https address,
 * and a path on this site. Everything else a note can hold — `mailto:`,
 * `tel:`, any other scheme the sanitizer let through, an address with a user
 * name in front of its host — is shown as written and never opened. The
 * address is read by the browser's own URL parser, the same one that would
 * follow it, so `java\tscript:` and friends are seen for what they are.
 */

export type LinkKind = "book" | "quran" | "site" | "external" | "blocked";

export type LinkDescription = {
  kind: LinkKind;
  /**
   * Where it goes, in words: «كىتاب: «ماۋزۇ» — 3-بەت», «قۇرئان: 2:255», a
   * host name — or, for a link that is never opened, the address as written.
   */
  label: string;
  /** The absolute address to open, or null when it must not be opened. */
  url: string | null;
};

const BOOK_PATH = /^\/books\/(\d+)\/read\/?$/;
const QURAN_PATH = /^\/quran\/(\d+)\/?$/;
const NUMBER = /^[1-9]\d{0,5}$/;
/** A blocked address is shown, not opened — but a page of it helps nobody. */
const SHOWN_CHARS = 200;

function blocked(href: string): LinkDescription {
  const shown = href.length > SHOWN_CHARS ? `${href.slice(0, SHOWN_CHARS)}…` : href;
  return { kind: "blocked", label: shown, url: null };
}

/**
 * The book's title as the citation line names it: the first «…» in the
 * link's text (lib/notes/insert.ts `citationLabel`).
 */
function citedTitle(text: string): string | null {
  const found = /«([^«»]+)»/.exec(text);
  const title = found?.[1].trim();
  return title ? title : null;
}

/**
 * Describe the link `href` whose text is `text`, as found on the page at
 * `base` (the note's own address, which a relative link is resolved against
 * exactly as the browser would).
 */
export function describeLink(href: string, text: string, base: string): LinkDescription {
  const written = href.trim();
  if (!written) return blocked(written);

  let url: URL;
  let home: URL;
  try {
    home = new URL(base);
    url = new URL(written, home);
  } catch {
    return blocked(written);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return blocked(written);
  // `https://bilimhezinisi.com@elsewhere.example/` goes to elsewhere.example.
  if (url.username || url.password) return blocked(written);

  if (url.origin !== home.origin) return { kind: "external", label: url.hostname, url: url.href };

  const book = BOOK_PATH.exec(url.pathname);
  if (book) {
    const title = citedTitle(text);
    const page = url.searchParams.get("page") ?? "";
    let label = title ? `كىتاب: «${title}»` : "كىتاب";
    if (NUMBER.test(page)) label += ` — ${page}-بەت`;
    return { kind: "book", label, url: url.href };
  }

  const quran = QURAN_PATH.exec(url.pathname);
  if (quran) {
    const aya = url.searchParams.get("aya") ?? "";
    const label = NUMBER.test(aya) ? `قۇرئان: ${quran[1]}:${aya}` : `قۇرئان: ${quran[1]}-سۈرە`;
    return { kind: "quran", label, url: url.href };
  }

  return { kind: "site", label: url.hostname, url: url.href };
}

/** The link a tap inside `root` landed on, if it landed on one. */
export function linkAt(root: HTMLElement, target: EventTarget | null): HTMLAnchorElement | null {
  if (!target || !(target instanceof Element)) return null;
  const link = target.closest("a[href]");
  return link instanceof HTMLAnchorElement && root.contains(link) && link !== root ? link : null;
}

/**
 * Open a described link: in a new tab, never with the note as its opener or
 * its referrer — and only if `describeLink` gave it an address to open.
 */
export function openLink(where: LinkDescription): boolean {
  if (!where.url) return false;
  window.open(where.url, "_blank", "noopener,noreferrer");
  return true;
}
