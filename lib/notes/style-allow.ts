/**
 * The one place that decides which CSS a stored note may carry.
 *
 * Both sanitizers import it — the browser's DOMPurify pass and the server's
 * parse5 pass — so the two cannot drift apart. Before PROMPT 16 the answer was
 * "text-align and colour, nothing else", which was right while the toolbar only
 * produced those two. It no longer is: an inserted aya has to render in the
 * Uthmani face or it is not the Qur'an any more, and that face can only travel
 * with the text as an inline `font-family`.
 *
 * So the list grows by exactly three properties, each with its values checked
 * against a closed set rather than a pattern that merely looks safe:
 *
 *   font-family  — only names this site already serves or names from the
 *                  reader's own system that we deliberately fall back to. A
 *                  family name is not a URL and cannot become one, but an
 *                  unchecked one would let a note carry `url(...)` inside a
 *                  `@font-face`-shaped value.
 *   font-size    — a bounded number with a unit, nothing computed.
 *   line-height  — a bare ratio between 1 and 3.
 *
 * Nothing here admits a function call, a URL, an expression or a custom
 * property, so none of it can reach the network or escape its element.
 */

/**
 * Family names a note may name. Everything in the first group is served from
 * /fonts (UKIJ, LGPL); the rest are resolved from the reader's own machine and
 * are never served by this site — see THIRD-PARTY-NOTICES.md. Uthmanic Hafs is
 * shipped for the Qur'an module, which is what an inserted aya renders in.
 */
export const ALLOWED_FONT_FAMILIES = [
  "UKIJ Ekran",
  "UKIJ Tuz",
  "UKIJ Tuz Tom",
  "UKIJ Tuz Kitab",
  "Uthmanic Hafs",
  "KFGQPC Uthmanic Script HAFS",
  "Traditional Arabic",
  "Amiri",
  "Microsoft Uighur",
  "Arial",
  "serif",
  "sans-serif",
  "monospace",
] as const;

/** Generic families are written bare; everything else is quoted. */
const GENERIC = new Set(["serif", "sans-serif", "monospace"]);

const BY_LOWER = new Map(ALLOWED_FONT_FAMILIES.map((name) => [name.toLowerCase(), name]));

/** Enough for a face plus its fallbacks; past that it is noise. */
const MAX_FAMILIES = 5;

export const MIN_NOTE_FONT_PX = 12;
export const MAX_NOTE_FONT_PX = 48;
export const MIN_NOTE_LINE_HEIGHT = 1;
export const MAX_NOTE_LINE_HEIGHT = 3;

/**
 * Canonicalise a `font-family` value, or reject it whole.
 *
 * Rejecting the whole declaration rather than filtering it is deliberate: a
 * stack with one unknown name in it is a stack somebody wrote by hand, and
 * silently keeping the half we recognise would change what it says.
 */
export function safeFontFamily(value: string): string | null {
  const parts = value.split(",");
  if (parts.length === 0 || parts.length > MAX_FAMILIES) return null;

  const kept: string[] = [];
  for (const part of parts) {
    const bare = part.trim().replace(/^['"]|['"]$/g, "").trim();
    const known = BY_LOWER.get(bare.toLowerCase());
    if (!known) return null;
    kept.push(GENERIC.has(known) ? known : `'${known}'`);
  }
  return kept.length > 0 ? kept.join(", ") : null;
}

/** A bounded `font-size` in pt or px. Anything else, including 0, is dropped. */
export function safeFontSize(value: string): string | null {
  const found = /^(\d{1,3})(pt|px)$/i.exec(value.trim());
  if (!found) return null;
  const size = Number(found[1]);
  const unit = found[2].toLowerCase();
  // pt is bigger than px, so the same bounds in pt allow a slightly larger
  // face — which is what a Word-shaped size list expects.
  if (size < MIN_NOTE_FONT_PX || size > MAX_NOTE_FONT_PX) return null;
  return `${size}${unit}`;
}

/** A bare line-height ratio, 1 to 3. No units, so nothing can be computed. */
export function safeLineHeight(value: string): string | null {
  const found = /^(\d(?:\.\d{1,2})?)$/.exec(value.trim());
  if (!found) return null;
  const ratio = Number(found[1]);
  if (ratio < MIN_NOTE_LINE_HEIGHT || ratio > MAX_NOTE_LINE_HEIGHT) return null;
  return found[1];
}

export const SAFE_ALIGN = /^(right|left|center|justify|start|end)$/i;
/** #rgb / #rrggbb, rgb()/rgba(), or a plain keyword. Nothing with url() or a function name in it. */
export const SAFE_COLOR = /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\)|[a-z]{3,20})$/i;

/**
 * Reduce one element's `style` attribute to the declarations a note may keep.
 * Shared by both sanitizers so "what survives" has exactly one definition.
 */
export function keepAllowedDeclarations(style: string): string[] {
  const kept: string[] = [];
  for (const declaration of style.split(";")) {
    const split = declaration.indexOf(":");
    if (split < 0) continue;
    const property = declaration.slice(0, split).trim().toLowerCase();
    const raw = declaration.slice(split + 1).trim();

    if (property === "text-align" && SAFE_ALIGN.test(raw)) kept.push(`text-align: ${raw}`);
    else if (property === "color" && SAFE_COLOR.test(raw)) kept.push(`color: ${raw}`);
    else if (property === "font-family") {
      const family = safeFontFamily(raw);
      if (family) kept.push(`font-family: ${family}`);
    } else if (property === "font-size") {
      const size = safeFontSize(raw);
      if (size) kept.push(`font-size: ${size}`);
    } else if (property === "line-height") {
      const height = safeLineHeight(raw);
      if (height) kept.push(`line-height: ${height}`);
    }
  }
  return kept;
}
