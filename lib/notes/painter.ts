/**
 * «فورمات سۈپۈرگىسى» — the format painter (PROMPT-49, N24).
 *
 * The desktop notebook's painter (src/notes.js, `fpCaptureFormat` /
 * `fpApplyFormat`) reads the computed style at the caret and writes the
 * selection back as ONE styled span through `insertHTML`. Neither half fits
 * here. A span carrying `font-weight` or `text-decoration` does not survive
 * this site's note allow-list (lib/notes/style-allow.ts), so the paint would
 * vanish on the next save; and rewriting the selection as one span of its
 * text throws away whatever it held — a citation's link, a line break.
 *
 * So the painter carries exactly what the toolbar can make and a note can
 * keep — bold, italic, underline and an explicit text colour — and applies
 * it with the toolbar's own commands, which the engines store as `<b>`,
 * `<i>`, `<u>` and `<font color>` (folded into a `color` by the sanitizer).
 * Measured in Chromium 151, Firefox 153 and WebKit 26.5, all three alike:
 * `bold`, `italic` and `underline` over a selection that only partly has
 * one give ALL of it that one, and over a selection that wholly has it take
 * it away; `foreColor` takes `rgb()` and writes it as hex. So each property
 * needs at most two commands, and each command is one «يېنىۋېلىش».
 *
 * Colour is copied only when the source had one of its own. The text's
 * colour on screen otherwise comes from the theme, and baking the paper
 * theme's ink into the note would leave it dark-on-dark in the dark theme.
 */

export type PaintFormat = {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  /** An explicit colour set on the text, as `rgb(r, g, b)` — or null for the theme's own. */
  color: string | null;
};

export type Toggle = "bold" | "italic" | "underline";
const TOGGLES: readonly Toggle[] = ["bold", "italic", "underline"];

/** How much of a selection has a property. */
export type Coverage = "all" | "none" | "some";

const BOLD_TAGS = new Set(["B", "STRONG", "H1", "H2", "H3", "H4", "H5", "H6", "TH"]);
const ITALIC_TAGS = new Set(["I", "EM"]);
const UNDERLINE_TAGS = new Set(["U", "INS"]);
const HEADING = /^H[1-6]$/;
/** Colour words that name no colour of the text's own. */
const NOT_A_COLOUR = new Set(["inherit", "initial", "unset", "revert", "revert-layer", "currentcolor", "transparent"]);

/**
 * A colour in one spelling, so two ways of writing the same one compare equal:
 * `#c0392b`, `#C0392B` and `rgb(192,57,43)` all become `rgb(192, 57, 43)`.
 * Null for no colour at all.
 */
export function canonicalColor(value: string | null | undefined): string | null {
  const written = (value ?? "").trim().toLowerCase();
  if (!written || NOT_A_COLOUR.has(written)) return null;
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(written);
  if (hex) {
    const digits = hex[1].length === 3 ? [...hex[1]].map((digit) => digit + digit).join("") : hex[1];
    const n = Number.parseInt(digits, 16);
    return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
  }
  const rgb = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*(1|1\.0+)\s*)?\)$/.exec(written);
  if (rgb) return `rgb(${rgb[1]}, ${rgb[2]}, ${rgb[3]})`;
  return written;
}

/** True for `bold`, `bolder` or a weight of 600 and up. */
function isBoldWeight(weight: string): boolean {
  return weight === "bold" || weight === "bolder" || Number(weight) >= 600;
}

/**
 * The format of the text at `node`, read from the markup between it and
 * `root`: the nearest element that says anything about a property decides
 * it — a `font-weight: normal` inside a `<b>` is not bold — except underline,
 * which an element below cannot take away from one above (CSS propagates a
 * text decoration to every descendant).
 *
 * Headings count as bold, as every engine's own `bold` command sees them.
 */
export function formatAt(root: Node, node: Node): PaintFormat {
  let bold: boolean | null = null;
  let italic: boolean | null = null;
  let underline = false;
  let color: string | null = null;
  let colorDecided = false;

  for (let current = node.parentNode; current && current !== root; current = current.parentNode) {
    if (current.nodeType !== Node.ELEMENT_NODE) continue;
    const element = current as HTMLElement;
    const style = element.style;

    if (bold === null) {
      if (style?.fontWeight) bold = isBoldWeight(style.fontWeight);
      else if (BOLD_TAGS.has(element.tagName)) bold = true;
    }
    if (italic === null) {
      if (style?.fontStyle) italic = style.fontStyle === "italic" || style.fontStyle.startsWith("oblique");
      else if (ITALIC_TAGS.has(element.tagName)) italic = true;
    }
    if (!underline) {
      const decoration = `${style?.textDecoration ?? ""} ${style?.textDecorationLine ?? ""}`;
      underline = UNDERLINE_TAGS.has(element.tagName) || decoration.includes("underline");
    }
    if (!colorDecided) {
      const own = canonicalColor(style?.color) ?? (element.tagName === "FONT" ? canonicalColor(element.getAttribute("color")) : null);
      if (own) {
        color = own;
        colorDecided = true;
      }
    }
  }
  return { bold: bold ?? false, italic: italic ?? false, underline, color };
}

/** The text nodes a range really selects some writing in, in document order. */
export function selectedTexts(range: Range): Text[] {
  const texts: Text[] = [];
  const holds = (text: Text) => {
    const start = text === range.startContainer ? range.startOffset : 0;
    const end = text === range.endContainer ? range.endOffset : text.data.length;
    return text.data.slice(start, end).trim() !== "";
  };
  const top = range.commonAncestorContainer;
  if (top.nodeType === Node.TEXT_NODE) return holds(top as Text) ? [top as Text] : [];

  const owner = top.ownerDocument ?? (top as Document);
  const walker = owner.createTreeWalker(top, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node as Text;
    if (range.intersectsNode(text) && holds(text)) texts.push(text);
  }
  return texts;
}

/**
 * The format at the start of a selection — of its first character that is not
 * a space — or null when nothing but space is selected.
 */
export function captureFormat(root: Node, range: Range): PaintFormat | null {
  const [first] = selectedTexts(range);
  return first ? formatAt(root, first) : null;
}

export type RangeFormat = Record<Toggle, Coverage> & {
  /** Every selected part has exactly this colour of its own; null when they differ or one has none. */
  color: string | null;
  /** Some of it is in a heading. */
  inHeading: boolean;
};

/** What a selection has, property by property. */
export function rangeFormat(root: Node, range: Range): RangeFormat {
  const formats = selectedTexts(range).map((text) => ({ text, format: formatAt(root, text) }));
  const coverage = (property: Toggle): Coverage => {
    const count = formats.filter(({ format }) => format[property]).length;
    return count === 0 ? "none" : count === formats.length ? "all" : "some";
  };
  const colors = new Set(formats.map(({ format }) => format.color));
  const inHeading = formats.some(({ text }) => {
    for (let current = text.parentNode; current && current !== root; current = current.parentNode) {
      if (current.nodeType === Node.ELEMENT_NODE && HEADING.test((current as Element).tagName)) return true;
    }
    return false;
  });
  return {
    bold: coverage("bold"),
    italic: coverage("italic"),
    underline: coverage("underline"),
    color: colors.size === 1 ? [...colors][0] : null,
    inHeading,
  };
}

/** What `paint` needs from the page: a way to run a command, and the selection after it. */
export type PaintDeps = {
  exec: (command: string, value?: string) => void;
  selection: () => Range | null;
};

/**
 * Make the selection's bold, italic and underline match `format`, and give it
 * `format`'s colour if it has one. Returns the commands run — one
 * «يېنىۋېلىش» each.
 *
 * A property is put right with at most two commands: the first gives a
 * partly-formatted selection all of it, the second then takes it away when
 * that was the aim. Boldness is left alone where the selection touches a
 * heading and the aim is "not bold": a heading is bold by being a heading,
 * and a note cannot store a heading that is not (the span an engine writes
 * for that does not survive the sanitizer).
 */
export function paint(root: Node, format: PaintFormat, deps: PaintDeps): number {
  let commands = 0;
  for (const property of TOGGLES) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const range = deps.selection();
      // Nothing but space selected: nothing to paint.
      if (!range || selectedTexts(range).length === 0) return commands;
      const now = rangeFormat(root, range);
      if (property === "bold" && !format.bold && now.inHeading) break;
      if (now[property] === (format[property] ? "all" : "none")) break;
      deps.exec(property);
      commands += 1;
    }
  }
  if (format.color) {
    const range = deps.selection();
    if (range && selectedTexts(range).length > 0 && rangeFormat(root, range).color !== format.color) {
      deps.exec("foreColor", format.color);
      commands += 1;
    }
  }
  return commands;
}
