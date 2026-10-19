import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { createSupabasePublicClient } from "@/lib/supabase/public-client";
import { outlineFromPages, parseOutline } from "@/lib/reader/outline";
import {
  buildLinkIndex,
  fragmentKey,
  headingKey,
  labelPhrase,
  resolveInternalLink,
  type LinkIndex,
  type LinkTarget,
} from "@/lib/reader/internal-links";
import type { Occurrence } from "@/lib/reader/matches";
import type { BookPage, MatchPage } from "@/lib/reader/pages";
import {
  LINK_NOT_FOUND_TEXT,
  LINK_OFFLINE_TEXT,
  PAGE_FAILED_TEXT,
  SEARCH_FAILED_TEXT,
} from "@/lib/reader/link-messages";

/**
 * Following a link inside a book (PROMPT-51) — everything but the React state,
 * so the reader's own bundle carries only the click and the status line.
 * Loaded the first time a reader touches an in-book link.
 *
 * A link is resolved from the book's outline (migration 0032, resolved by
 * lib/reader/internal-links.ts) and landed on in one settled movement: the
 * target's page is loaded when it is not on screen, a heading is put just
 * below the toolbar and a note in the middle of the free space, and then
 * HELD there while the pages around it finish loading — a page inserted
 * above would otherwise push it down the screen.
 *
 * When the book does not say where a link goes, or the function is not there
 * yet, the label is searched for instead, the way the find bar does it.
 *
 * The search itself, and the matcher that counts, are the READER's, lent
 * through LinkHost rather than imported here: a module this chunk shared with
 * the reader would stop being folded into the reader's own and cost the
 * reader's first load its wrapper — about 0.8 KB in all, measured.
 */

/** What the reader lends the session. Read fresh on every call. */
export type LinkHost = {
  bookId: number;
  published: boolean;
  /** The reader's content; its toolbar and bottom bar are found from it. */
  container: HTMLElement | null;
  loadedPages: BookPage[];
  /** The reader's goToPage with a final element: the page made present, the element found on it, nothing scrolled. */
  reveal: (pageNo: number, find: (page: HTMLElement) => HTMLElement | null) => Promise<HTMLElement | null | undefined>;
  /**
   * The reader's in-book search: every occurrence of the phrase, page by
   * page — or, when every search slot is taken, what to say about it.
   */
  search: (phrase: string) => Promise<{ pages: MatchPage[]; capped: boolean; all: Occurrence[] } | string>;
  /** The reader's matcher: how often a phrase occurs in a text. */
  count: (text: string, phrase: string) => number;
  /** Show a phrase's matches the way the find bar does, on the given occurrence. */
  showMatches: (term: string, pages: MatchPage[], capped: boolean, position: number) => void;
  loading: boolean;
  setPinned: (pinned: boolean) => void;
  /** What the bottom bar's status line shows; null empties it. */
  say: (message: string | null) => void;
};

export type LinkSession = {
  /** Start loading the outline before the click lands. */
  prefetch: () => void;
  /** Follow an in-book link. True when the reader moved. */
  follow: (anchor: HTMLAnchorElement) => Promise<boolean>;
};

/** The reader's own loading words, shown when following a link takes a moment. */
const LOADING_TEXT = "يۈكلىنىۋاتىدۇ…";
/** …only after this long, so an instant jump does not flash a line in the bar. */
const SLOW_MS = 250;
/** A message stays this long, then gets out of the way. */
const MESSAGE_MS = 8000;

/** Space between the toolbar's bottom edge and a heading put under it. */
const GAP = 8;
/** A landing is held this long after the last change of layout or load. */
const SETTLE_MS = 1500;
/** …and never longer than this. */
const HOLD_MAX_MS = 12_000;

type Loaded = { index: LinkIndex } | { missing: true } | { failed: true };

/** Wait, a frame at a time, for something React is about to put on the page. */
async function waitFor<T>(find: () => T | null | undefined, frames = 30): Promise<T | null> {
  for (let frame = 0; ; frame += 1) {
    const found = find();
    if (found || frame >= frames) return found ?? null;
    await new Promise((resolve) => requestAnimationFrame(resolve));
  }
}

function offline(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

/**
 * The function's answer. A 404 or PGRST202 means the migration is not
 * applied yet — remembered for this visit; anything else may pass.
 */
async function loadOutline(bookId: number, published: boolean): Promise<Loaded> {
  try {
    const supabase = published ? createSupabasePublicClient() : createSupabaseBrowserClient();
    const { data, error, status } = await supabase.rpc("book_outline", { p_book_id: bookId });
    if (error) return status === 404 || error.code === "PGRST202" ? { missing: true } : { failed: true };
    const outline = parseOutline(data);
    return outline ? { index: buildLinkIndex(outline) } : { failed: true };
  } catch {
    return { failed: true };
  }
}

/** In-book links on a page whose fragment is `key`, in order. */
function linksOn(page: HTMLElement, key: string): HTMLAnchorElement[] {
  return Array.from(page.querySelectorAll<HTMLAnchorElement>('.md-body a[href^="#"]')).filter(
    (anchor) => fragmentKey((anchor.getAttribute("href") ?? "").slice(1)) === key,
  );
}

/** The nth heading on a page that reads `text`. Found by its words, never by position alone. */
function headingOn(page: HTMLElement, text: string, nth: number): HTMLElement | null {
  const headings = Array.from(
    page.querySelectorAll<HTMLElement>(".md-body h1, .md-body h2, .md-body h3, .md-body h4, .md-body h5, .md-body h6"),
  ).filter((heading) => headingKey(heading.textContent ?? "") === text);
  return headings[nth] ?? null;
}

function finderFor(target: LinkTarget): (page: HTMLElement) => HTMLElement | null {
  return target.kind === "heading"
    ? (page) => headingOn(page, target.text, target.nth)
    : (page) => linksOn(page, target.fragment)[target.nth] ?? null;
}

export function createLinkSession(host: () => LinkHost): LinkSession {
  let outline: Promise<Loaded> | null = null;
  let missing = false;
  let hold: (() => void) | null = null;
  let busy = false;
  let showing: string | null = null;
  let slow: number | undefined;
  let fade: number | undefined;

  /** Put a message in the bottom bar, or empty it; a message fades after a while. */
  function say(message: string | null): void {
    window.clearTimeout(slow);
    window.clearTimeout(fade);
    showing = message;
    host().say(message);
    if (message && message !== LOADING_TEXT) fade = window.setTimeout(() => say(null), MESSAGE_MS);
  }

  function load(): Promise<Loaded> {
    if (missing) return Promise.resolve({ missing: true });
    const { bookId, published } = host();
    outline ??= loadOutline(bookId, published).then((loaded) => {
      if ("missing" in loaded) missing = true;
      // A passing failure is not remembered: the next click asks again.
      if ("failed" in loaded) outline = null;
      return loaded;
    });
    return outline;
  }

  function release(): void {
    hold?.();
    hold = null;
  }

  /**
   * Keep an element where it was put while the reader settles around it.
   * Corrected in a ResizeObserver, which runs after layout and before paint,
   * so a page inserted above never shows as a jump. Any sign of the reader
   * taking over — a wheel, a touch, a key, a press — lets go at once.
   */
  function holdInPlace(locate: () => HTMLElement | null, top: number): void {
    release();
    const reader = host();
    const began = performance.now();
    let quietSince = began;

    const correct = () => {
      const element = locate();
      if (!element) return;
      const delta = element.getBoundingClientRect().top - top;
      if (Math.abs(delta) > 1) window.scrollBy(0, delta);
    };
    const observer = new ResizeObserver(() => {
      quietSince = performance.now();
      correct();
    });
    if (reader.container) observer.observe(reader.container);

    const inputs = ["wheel", "touchstart", "keydown", "mousedown"] as const;
    const letGo = () => release();
    for (const type of inputs) window.addEventListener(type, letGo, { capture: true, passive: true });
    const timer = window.setInterval(() => {
      const now = performance.now();
      // The reader has gone (another page): nothing left to hold.
      if (!host().container?.isConnected) return release();
      if (host().loading) quietSince = now;
      if (now - quietSince > SETTLE_MS || now - began > HOLD_MAX_MS) release();
    }, 250);

    reader.setPinned(true);
    hold = () => {
      observer.disconnect();
      window.clearInterval(timer);
      for (const type of inputs) window.removeEventListener(type, letGo, { capture: true });
      host().setPinned(false);
    };
  }

  /** Put an element in place, flash it, give it focus, and hold it there. */
  function place(locate: () => HTMLElement | null, mode: "top" | "center"): void {
    const element = locate();
    if (!element) return;
    // The reader's sticky bars, measured now: their height depends on the
    // screen, the find row, the message line.
    const root = host().container?.parentElement;
    const header = root?.querySelector('[data-testid="reader-toolbar"]');
    const bar = root?.querySelector('[data-testid="reader-bottom-bar"]');
    const headerBottom = Math.max(0, header?.getBoundingClientRect().bottom ?? 0);
    const barTop = Math.min(bar?.getBoundingClientRect().top ?? window.innerHeight, window.innerHeight);
    const rect = element.getBoundingClientRect();
    const top =
      mode === "top" ? headerBottom + GAP : headerBottom + Math.max(GAP, (barTop - headerBottom - rect.height) / 2);
    // Instant, like the find bar's own jumps: a smooth scroll over hundreds of
    // pages is a slide past text nobody asked to read, and it fights the hold.
    window.scrollBy(0, rect.top - top);

    element.classList.remove("match-flash");
    void element.offsetWidth;
    element.classList.add("match-flash");
    // A heading is not focusable by itself; the screen reader announces it here.
    if (!element.matches("a[href], button, input, [tabindex]")) element.setAttribute("tabindex", "-1");
    element.focus({ preventScroll: true });

    holdInPlace(locate, top);
  }

  /** Land on a page's element, or on the page itself when the element is not to be found. */
  async function land(page: number, find: (page: HTMLElement) => HTMLElement | null, mode: "top" | "center"): Promise<boolean> {
    const reader = host();
    const pageNode = () => reader.container?.querySelector<HTMLElement>(`[data-page-no="${page}"]`) ?? null;
    const locate = () => {
      const current = pageNode();
      return current ? find(current) : null;
    };
    // React may take a frame or two to put down a page it was just given, and
    // the marks of a search it was just told about.
    const element = (await reader.reveal(page, find)) ?? ((await waitFor(pageNode)) ? await waitFor(locate) : null);
    if (element) {
      place(locate, mode);
      return true;
    }
    if (!pageNode()) return false;
    place(pageNode, "top");
    return true;
  }

  /** How many times the phrase occurs on the page before the link, and up to its end. */
  function occurrencesAround(anchor: HTMLAnchorElement, phrase: string): { before: number; through: number } {
    const body = anchor.closest(".md-body");
    if (!body) return { before: 0, through: 0 };
    const range = document.createRange();
    range.setStart(body, 0);
    range.setEndBefore(anchor);
    const { count } = host();
    const before = count(range.toString(), phrase);
    range.setEndAfter(anchor);
    return { before, through: count(range.toString(), phrase) };
  }

  /**
   * The label, searched for: the first occurrence after the link, or else the
   * first in the book — never the link's own text.
   */
  async function searchFor(anchor: HTMLAnchorElement, page: number): Promise<boolean> {
    const reader = host();
    const phrase = labelPhrase(anchor.textContent ?? "");
    if (Array.from(phrase).length < 2) {
      say(LINK_NOT_FOUND_TEXT);
      return false;
    }
    let found: Awaited<ReturnType<LinkHost["search"]>>;
    try {
      found = await reader.search(phrase);
    } catch {
      found = offline() ? LINK_OFFLINE_TEXT : SEARCH_FAILED_TEXT;
    }
    if (typeof found === "string") {
      say(found);
      return false;
    }

    const { all } = found;
    const own = occurrencesAround(anchor, phrase);
    const others = all.filter((at) => !(at.pageNo === page && at.index >= own.before && at.index < own.through));
    const chosen =
      others.find((at) => at.pageNo > page || (at.pageNo === page && at.index >= own.through)) ?? others[0];
    if (!chosen) {
      say(LINK_NOT_FOUND_TEXT);
      return false;
    }

    reader.showMatches(phrase, found.pages, found.capped, all.indexOf(chosen));
    return land(chosen.pageNo, (node) => node.querySelector<HTMLElement>(`[data-match="${chosen.index}"]`), "center");
  }

  /** One link at a time: a second tap while the first is on its way is ignored. */
  async function follow(anchor: HTMLAnchorElement): Promise<boolean> {
    if (busy) return false;
    busy = true;
    say(null);
    slow = window.setTimeout(() => {
      showing = LOADING_TEXT;
      host().say(LOADING_TEXT);
    }, SLOW_MS);
    try {
      return await followLink(anchor);
    } finally {
      busy = false;
      window.clearTimeout(slow);
      if (showing === LOADING_TEXT) say(null);
    }
  }

  async function followLink(anchor: HTMLAnchorElement): Promise<boolean> {
    const pageNode = anchor.closest<HTMLElement>("[data-page-no]");
    const page = Number(pageNode?.dataset.pageNo);
    if (!pageNode || !Number.isInteger(page)) return false;
    const fragment = (anchor.getAttribute("href") ?? "").slice(1);
    const clicked = { fragment, label: anchor.textContent ?? "", page };

    const loaded = await load();
    if ("index" in loaded) {
      const target = resolveInternalLink(loaded.index, clicked);
      if (target) {
        if (await land(target.page, finderFor(target), target.kind === "heading" ? "top" : "center")) return true;
        say(offline() ? LINK_OFFLINE_TEXT : PAGE_FAILED_TEXT);
        return false;
      }
    } else if (offline()) {
      // No database to ask: the pages already here may still hold the target.
      const reader = host();
      const target = resolveInternalLink(buildLinkIndex(outlineFromPages(reader.loadedPages)), clicked);
      if (target && reader.loadedPages.some((loadedPage) => loadedPage.page_no === target.page)) {
        if (await land(target.page, finderFor(target), target.kind === "heading" ? "top" : "center")) return true;
      }
      say(LINK_OFFLINE_TEXT);
      return false;
    }

    return searchFor(anchor, page);
  }

  return {
    prefetch: () => void load(),
    follow,
  };
}
