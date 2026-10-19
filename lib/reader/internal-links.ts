import { ug_normalize_client } from "@/lib/reader/normalize";
import type { BookOutline } from "@/lib/reader/outline";

/**
 * Where an in-book link goes, worked out from the book's own text (PROMPT-51).
 *
 * A Word table of contents arrives as `[1\. Title](#QBH1)` with no target
 * anywhere: mammoth writes the bookmark as an empty anchor and turndown drops
 * it. So the target is recovered from what IS stored — the heading the label
 * names, or, for a note, the link that points back — and recovered here, in
 * the reader, so that no book has to be uploaded again.
 *
 * Pure: no DOM, no network, no React. The reader loads it on first use.
 *
 * Order, per fragment:
 *   1. notes — mammoth names them footnote-N ↔ footnote-ref-N and
 *      endnote-N ↔ endnote-ref-N; the target is the link carrying the
 *      reciprocal fragment;
 *   2. a heading whose GitHub-style slug is the fragment (.md and .html
 *      sources that link `#some-heading`);
 *   3. the label aligned with the headings, for the whole book at once,
 *      fragments in the order of their first link:
 *        tier 1 — the label equals the heading;
 *        tier 2 — equal once a leading enumeration is gone from either side;
 *        tier 3 — one is a prefix of the other at a word boundary, the shorter
 *                 at least 8 characters (a TOC entry that joins a heading and
 *                 the subtitle after it);
 *      first forward from each link and from the previous tier 1–2 target —
 *      a cursor that only moves forward, so repeated chapter titles map in
 *      order — then, for what is left, from the start of the book with a
 *      fresh cursor (a contents page printed at the END, as many Uyghur books
 *      have it), and last each one on its own (a back-reference);
 *   4. nothing — the reader falls back to searching for the label.
 */

export type LinkTarget =
  /** A heading, found on its page by its text: the nth of the headings that read the same. */
  | { kind: "heading"; page: number; text: string; nth: number }
  /** A note's other end: the nth link on that page whose fragment is `fragment`. */
  | { kind: "note"; page: number; fragment: string; nth: number };

export type ClickedLink = {
  /** The fragment from the link's href, without `#` — as the DOM has it. */
  fragment: string;
  /** The link's visible text, used only when its fragment is not in the outline. */
  label: string;
  /** The page the link was clicked on. */
  page: number;
};

type Heading = {
  order: number;
  page: number;
  /** The heading's text, normalized. */
  norm: string;
  /** The same with a leading enumeration taken off. */
  bare: string;
  slug: string;
  /** How many headings on the same page, before this one, read the same. */
  nth: number;
};

/** A label, as alignment compares it. */
type Probe = {
  /** Its normalized forms, the fully stripped one first. */
  forms: string[];
  /** Tier 3's word-boundary prefixes of the forms, filled in on first need. */
  prefixes?: string[];
  /** The forms long enough to be a prefix themselves, likewise. */
  long?: string[];
};

type Link = Probe & {
  order: number;
  page: number;
  key: string;
};

export type LinkIndex = {
  headings: Heading[];
  /** Each fragment's first link. */
  firstLink: Map<string, Link>;
  targets: Map<string, LinkTarget | null>;
  /** Heading positions, ascending, by normalized text… */
  byNorm: Map<string, number[]>;
  /** …by text without its enumeration… */
  byBare: Map<string, number[]>;
  /** …and by every word-boundary prefix of either, 8 characters or longer. */
  byPrefix: Map<string, number[]>;
  slugs: Map<string, Heading>;
};

// ── Normalizing ───────────────────────────────────────────────────────────────

/** Zero-width characters, bidi marks and the soft hyphen: invisible, and in the way of a comparison. */
const INVISIBLE = /[\u00AD\u061C\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u206F\uFEFF]/g;
const DIGITS = "0-9٠-٩۰-۹";
/** «1. », «١- », «۲) », «3: », «1.2 » — a number that only counts. Something must follow it. */
const ENUMERATION = new RegExp(`^\\s*[${DIGITS}]+(?:[.\\-][${DIGITS}]+)*(?:\\s*[.\\-):]\\s*|\\s+)(?=\\S)`);
/** A printed page number at the end: after a tab, dot leaders or spaces. */
const PAGE_REFERENCE = new RegExp(`(?:\\t[\\s.…]*|\\s*(?:\\.{2,}|…+)[\\s.…]*|\\s+)[${DIGITS}]+\\s*$`);
/** A Markdown backslash escape: any ASCII punctuation. */
const ESCAPE = /\\([!-/:-@[-`{-~])/g;
/** Escaped characters are parked in the private-use area while markup is removed. */
const PARKED = /[\uF000-\uF07F]/g;

function park(text: string): string {
  return text.replace(ESCAPE, (_, character: string) => String.fromCharCode(0xf000 + character.charCodeAt(0)));
}

function unpark(text: string): string {
  return text.replace(PARKED, (character) => String.fromCharCode(character.charCodeAt(0) - 0xf000));
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: "\u00A0" };

/**
 * Inline Markdown as the reader shows it: links become their labels, images
 * nothing, emphasis and code marks go, escapes are undone.
 *
 * Deliberately not stripMarkdown: that one also removes a list marker at the
 * start of a line, and a heading or a label reading «1. …» would lose its
 * number on this side and keep it in the DOM — the two would never agree.
 */
function inlineText(raw: string): string {
  if (!/[\\`*_~[!&]/.test(raw)) return raw;
  const text = park(raw)
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/`+([^`]*?)`+/g, "$1")
    .replace(/(\*{1,3}|_{1,3}|~~)(?=\S)([\s\S]*?\S)\1/g, "$2")
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (whole, name: string) => {
      if (name[0] !== "#") return ENTITIES[name.toLowerCase()] ?? whole;
      const code = name[1] === "x" || name[1] === "X" ? Number.parseInt(name.slice(2), 16) : Number(name.slice(1));
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    });
  return unpark(text);
}

const EDGE = /[\s\p{P}]/u;

/** One space between words, no punctuation at either end. */
function tidy(text: string): string {
  const collapsed = text.replace(/\s+/g, " ");
  // Walked from both ends: a /[…]+$/ expression would retry at every position.
  let start = 0;
  let end = collapsed.length;
  while (start < end && EDGE.test(collapsed[start])) start++;
  while (end > start && EDGE.test(collapsed[end - 1])) end--;
  return collapsed.slice(start, end);
}

/**
 * Letters as search compares them, then tidied. Run once per label or
 * heading: ug_normalize_client is most of what building the index costs, and
 * it leaves digits, dots and spaces alone, so the other forms are cut out of
 * its answer rather than normalized again.
 */
function plain(text: string): string {
  return tidy(ug_normalize_client(text.replace(INVISIBLE, "")));
}

function stripEnumeration(text: string): string {
  return text.replace(ENUMERATION, "");
}

function stripPageReference(text: string): string {
  const stripped = text.replace(PAGE_REFERENCE, "");
  return stripped.trim() ? stripped : text;
}

/**
 * The forms a label is compared in: fully stripped first, then keeping its
 * enumeration, then keeping its trailing number, then as written. Which number
 * is a page and which is part of a title («سۈرە 2», «1-باب») cannot be told
 * from the label alone, so every reading is tried and the heading decides.
 */
function labelForms(text: string): string[] {
  const whole = plain(text);
  const withoutPage = stripPageReference(whole);
  const forms = [tidy(stripEnumeration(withoutPage)), tidy(withoutPage), tidy(stripEnumeration(whole)), whole];
  return [...new Set(forms.filter(Boolean))];
}

/** The phrase to search for when no target is known: the label without its number and page. */
export function labelPhrase(label: string): string {
  return stripEnumeration(stripPageReference(label.replace(INVISIBLE, "")))
    .replace(/\s+/g, " ")
    .trim();
}

/** A heading's text as rendered, in the form LinkTarget.text holds it. */
export function headingKey(renderedText: string): string {
  return plain(renderedText);
}

/** A fragment as the DOM's href has it, percent-decoded where it can be. */
export function fragmentKey(fragment: string): string {
  if (!fragment.includes("%")) return fragment;
  try {
    return decodeURIComponent(fragment);
  } catch {
    return fragment;
  }
}

/** The same for a fragment as Markdown stores it, escapes and all. */
function storedFragmentKey(raw: string): string {
  return fragmentKey(raw.replace(ESCAPE, "$1"));
}

/** github-slugger's rule: lower-case, keep letters, marks, numbers, `_`, `-` and spaces, spaces to hyphens. */
function slugOf(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, "").replace(/ /g, "-");
}

const NOTE = /^(footnote|endnote)-(ref-)?(.+)$/;

// ── Building the index ────────────────────────────────────────────────────────

/** Appends in ascending order (headings are visited in order), once per heading. */
function listPush(map: Map<string, number[]>, key: string, value: number): void {
  if (!key) return;
  const list = map.get(key);
  if (!list) map.set(key, [value]);
  else if (list[list.length - 1] !== value) list.push(value);
}

const MIN_PREFIX = 8;

/** Every proper prefix of `text` that ends before a space and is long enough to mean something. */
function wordPrefixes(text: string): string[] {
  const prefixes: string[] = [];
  for (let at = text.indexOf(" "); at > 0; at = text.indexOf(" ", at + 1)) {
    const prefix = text.slice(0, at);
    if (characters(prefix) >= MIN_PREFIX) prefixes.push(prefix);
  }
  return prefixes;
}

/** Length in characters (code points), the way the rule counts them. */
function characters(text: string): number {
  return /[\uD800-\uDBFF]/.test(text) ? Array.from(text).length : text.length;
}

/** The first value in an ascending list that is at least `min`, or -1. */
function firstAtLeast(list: number[] | undefined, min: number): number {
  if (!list) return -1;
  let low = 0;
  let high = list.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (list[middle] < min) low = middle + 1;
    else high = middle;
  }
  return low < list.length ? list[low] : -1;
}

/**
 * Headings and links outside code, the note and slug targets, and the
 * alignment of every other fragment — once for the whole book.
 */
export function buildLinkIndex(outline: BookOutline): LinkIndex {
  const headings: Heading[] = [];
  const firstLink = new Map<string, Link>();

  // Fences, per page: each page is rendered on its own, so a block left open
  // on one page closes at its end, exactly as markdown-it sees it.
  let fence: { character: string; length: number } | null = null;
  let fencePage = -1;
  const sameOnPage = new Map<string, number>();
  const slugsSeen = new Map<string, number>();

  outline.entries.forEach((entry, order) => {
    const page = entry[0];
    if (page !== fencePage) {
      fence = null;
      fencePage = page;
    }
    if (entry[1] === "f") {
      const [, , marker, info] = entry;
      const character = marker[0];
      if (!fence) {
        if (character === "~" || !info.includes("`")) fence = { character, length: marker.length };
      } else if (character === fence.character && marker.length >= fence.length && info === "") {
        fence = null;
      }
      return;
    }
    if (fence) return;

    if (entry[1] === "h") {
      const text = inlineText(entry[3].replace(/(?:^|[ \t]+)#+[ \t]*$/, "")).replace(INVISIBLE, "");
      const norm = plain(text);
      const counted = `${page}\u0000${norm}`;
      const nth = sameOnPage.get(counted) ?? 0;
      sameOnPage.set(counted, nth + 1);
      let slug = slugOf(text);
      const seen = slugsSeen.get(slug) ?? 0;
      slugsSeen.set(slug, seen + 1);
      if (seen > 0) slug = `${slug}-${seen}`;
      headings.push({ order, page, norm, bare: tidy(stripEnumeration(norm)), slug, nth });
      return;
    }

    const [, , label, fragment] = entry;
    const key = storedFragmentKey(fragment);
    if (!firstLink.has(key)) firstLink.set(key, { order, page, key, forms: labelForms(inlineText(label)) });
  });

  const byNorm = new Map<string, number[]>();
  const byBare = new Map<string, number[]>();
  const byPrefix = new Map<string, number[]>();
  const slugs = new Map<string, Heading>();
  headings.forEach((heading, at) => {
    listPush(byNorm, heading.norm, at);
    listPush(byBare, heading.bare, at);
    for (const prefix of wordPrefixes(heading.norm)) listPush(byPrefix, prefix, at);
    for (const prefix of wordPrefixes(heading.bare)) listPush(byPrefix, prefix, at);
    if (!slugs.has(heading.slug)) slugs.set(heading.slug, heading);
  });

  const index: LinkIndex = { headings, firstLink, targets: new Map(), byNorm, byBare, byPrefix, slugs };
  resolveAll(index);
  return index;
}

function headingTarget(heading: Heading): LinkTarget {
  return { kind: "heading", page: heading.page, text: heading.norm, nth: heading.nth };
}

/** The other end of a note link, if the book has it. */
function noteTarget(index: LinkIndex, key: string): LinkTarget | null | undefined {
  const note = NOTE.exec(key);
  if (!note) return undefined;
  const reciprocal = note[2] ? `${note[1]}-${note[3]}` : `${note[1]}-ref-${note[3]}`;
  const found = index.firstLink.get(reciprocal);
  // The first link carrying that fragment: no earlier one shares its page.
  return found ? { kind: "note", page: found.page, fragment: reciprocal, nth: 0 } : null;
}

function slugTarget(index: LinkIndex, key: string): LinkTarget | null {
  const heading = index.slugs.get(key.toLowerCase());
  return heading ? headingTarget(heading) : null;
}

/** The best heading at or after `lower`, by tier; tier 3 only when 1 and 2 find nothing. */
function align(index: LinkIndex, probe: Probe, lower: number): { at: number; tier: 1 | 2 | 3 } | null {
  const earliest = (map: Map<string, number[]>, keys: string[]) => {
    let best = -1;
    for (const key of keys) {
      const at = firstAtLeast(map.get(key), lower);
      if (at >= 0 && (best < 0 || at < best)) best = at;
    }
    return best;
  };
  const exact = earliest(index.byNorm, probe.forms);
  if (exact >= 0) return { at: exact, tier: 1 };
  const bare = earliest(index.byBare, probe.forms);
  if (bare >= 0) return { at: bare, tier: 2 };
  // A heading that begins the label, or a label that begins the heading —
  // at a word boundary, the shorter at least MIN_PREFIX characters. Worked
  // out once per label, and only for a label that gets this far.
  probe.prefixes ??= probe.forms.flatMap(wordPrefixes);
  probe.long ??= probe.forms.filter((form) => characters(form) >= MIN_PREFIX);
  const candidates = [
    earliest(index.byNorm, probe.prefixes),
    earliest(index.byBare, probe.prefixes),
    earliest(index.byPrefix, probe.long),
  ].filter((at) => at >= 0);
  return candidates.length > 0 ? { at: Math.min(...candidates), tier: 3 } : null;
}

/** Index of the first heading after an entry. */
function firstHeadingAfter(index: LinkIndex, order: number): number {
  let low = 0;
  let high = index.headings.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (index.headings[middle].order <= order) low = middle + 1;
    else high = middle;
  }
  return low;
}

function resolveAll(index: LinkIndex): void {
  const pending: Link[] = [];
  for (const [key, link] of index.firstLink) {
    const note = noteTarget(index, key);
    if (note) {
      index.targets.set(key, note);
      continue;
    }
    const slug = slugTarget(index, key);
    if (slug) {
      index.targets.set(key, slug);
      continue;
    }
    pending.push(link);
  }

  // Forward from each link, with a cursor that only moves on a tier 1–2 hit.
  let cursor = -1;
  for (const link of pending) {
    const hit = align(index, link, Math.max(cursor + 1, firstHeadingAfter(index, link.order)));
    if (!hit) continue;
    index.targets.set(link.key, headingTarget(index.headings[hit.at]));
    if (hit.tier < 3) cursor = hit.at;
  }

  // From the start of the book, a fresh cursor: a contents page at the end.
  cursor = -1;
  for (const link of pending) {
    if (index.targets.has(link.key)) continue;
    const hit = align(index, link, cursor + 1);
    if (!hit) continue;
    index.targets.set(link.key, headingTarget(index.headings[hit.at]));
    if (hit.tier < 3) cursor = hit.at;
  }

  // Each one on its own: a reference back to an earlier chapter.
  for (const link of pending) {
    if (index.targets.has(link.key)) continue;
    const hit = align(index, link, 0);
    index.targets.set(link.key, hit ? headingTarget(index.headings[hit.at]) : null);
  }
}

// ── Resolving a click ─────────────────────────────────────────────────────────

/**
 * Where a clicked link goes, or null when the book does not say.
 *
 * A fragment the outline knows shares the target worked out for the whole
 * book. One it does not know — a capped outline, a link Markdown wrote in a
 * shape the outline does not read — is resolved from the link's own label and
 * page: forward from that page first, then from the start.
 */
export function resolveInternalLink(index: LinkIndex, clicked: ClickedLink): LinkTarget | null {
  const key = fragmentKey(clicked.fragment);
  const known = index.targets.get(key);
  if (known !== undefined) return known;

  const note = noteTarget(index, key);
  if (note !== undefined) return note;
  const slug = slugTarget(index, key);
  if (slug) return slug;

  const probe: Probe = { forms: labelForms(clicked.label) };
  const fromPage = index.headings.findIndex((heading) => heading.page >= clicked.page);
  const hit = (fromPage >= 0 ? align(index, probe, fromPage) : null) ?? align(index, probe, 0);
  return hit ? headingTarget(index.headings[hit.at]) : null;
}
