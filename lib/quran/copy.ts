/**
 * Aya rendering and clipboard, ported from desktop src/quran.js
 * `copyAyaToClipboard`.
 *
 * Every translation is written with its label, «[7]» or «[4 _ 6]», and a
 * group's translation once per unit (lib/quran/verse-label.ts); this module
 * takes units ready-made and imports only their type, so the notebook does
 * not carry the group table.
 *
 * Writes rich text and plain text together, so pasting into Word keeps the
 * Uthmani face and the ornate brackets, while a plain-text target still gets
 * readable output. Falls back to writeText, then to a hidden textarea, so an
 * older browser or a denied clipboard permission still copies something.
 *
 * The HTML builder is exported because the notebook inserts ayas too
 * (lib/notes/insert.ts). One builder, so a verse pasted into Word and a verse
 * inserted into a note are the same markup — and so the note sanitizer only
 * ever has to admit one shape (lib/notes/style-allow.ts).
 */
import type { VerseUnit } from "@/lib/quran/verse-label";

const FONT_STACK_AR = "'Uthmanic Hafs','KFGQPC Uthmanic Script HAFS','Traditional Arabic','Amiri',serif";
const FONT_STACK_UG = "'UKIJ Ekran','UKIJ Tuz','Microsoft Uighur','Arial',sans-serif";

/** Ornate Quran brackets ﴿ ﴾ and the Uyghur quotation guillemets. */
const OPEN_AYA = "﴿";
const CLOSE_AYA = "﴾";
const OPEN_QUOTE = "«";
const CLOSE_QUOTE = "»";

/** What of a verse to render: the Arabic, the translation, or both. */
export type AyaRenderMode = "ar" | "ug" | "both";

export function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] as string,
  );
}

/** Each verse's Arabic, in the Uthmani face, inside its ornate brackets. */
function arabicSpan(unit: VerseUnit): string {
  return (
    `<span style="font-family:${FONT_STACK_AR};font-size:20pt;line-height:1.9">` +
    unit.ayas.map((aya) => `${OPEN_AYA}${escapeHtml(aya.text_ar)}${CLOSE_AYA}`).join(" ") +
    `</span>`
  );
}

/**
 * The Uyghur translation, in the reading face, inside guillemets and followed
 * by its label: «…» [4 _ 6] (lib/quran/verse-label.ts).
 */
function uyghurSpan(unit: VerseUnit): string {
  return (
    `<span style="font-family:${FONT_STACK_UG};font-size:13pt;line-height:1.7;color:#333">` +
    `${OPEN_QUOTE}${escapeHtml(unit.text)}${CLOSE_QUOTE} ${escapeHtml(unit.label)}</span>`
  );
}

/** `mode`, falling back to the Arabic when the unit carries no translation. */
function effectiveMode(unit: VerseUnit, mode: AyaRenderMode): AyaRenderMode {
  return mode !== "ar" && !unit.text ? "ar" : mode;
}

/**
 * One unit — a verse, or the verses of a group in a run — as a single RTL
 * paragraph: each verse's Arabic, then the translation once. `mode` falls
 * back to the Arabic when a translation was asked for and the verse carries
 * none, which is the desktop's behaviour and better than emitting an empty
 * quotation.
 */
export function unitHtml(unit: VerseUnit, mode: AyaRenderMode): string {
  const wanted = effectiveMode(unit, mode);
  const parts: string[] = [];
  if (wanted !== "ug") parts.push(arabicSpan(unit));
  if (wanted !== "ar") parts.push(uyghurSpan(unit));
  return `<p dir="rtl" style="text-align:right;margin:0 0 12pt 0;">${parts.join("<br>")}</p>`;
}

/** The same unit as plain text, for a plain-text clipboard target. */
export function unitText(unit: VerseUnit, mode: AyaRenderMode): string {
  const wanted = effectiveMode(unit, mode);
  const parts: string[] = [];
  if (wanted !== "ug") parts.push(unit.ayas.map((aya) => `${OPEN_AYA}${aya.text_ar}${CLOSE_AYA}`).join(" "));
  if (wanted !== "ar") parts.push(`${OPEN_QUOTE}${unit.text}${CLOSE_QUOTE} ${unit.label}`);
  return parts.join(" ");
}

/**
 * Copy these units. Without the translation every verse is its own
 * paragraph, so a group's verses are not run together.
 */
export async function copyUnits(units: VerseUnit[], withTranslation: boolean): Promise<boolean> {
  if (units.length === 0) return false;

  const mode: AyaRenderMode = withTranslation ? "both" : "ar";
  const parts = withTranslation
    ? units
    : units.flatMap((unit) => unit.ayas.map((aya) => ({ ...unit, ayas: [aya] })));
  const html = `<html><head><meta charset="utf-8"></head><body>${parts
    .map((unit) => unitHtml(unit, mode))
    .join("\n")}</body></html>`;
  const text = parts.map((unit) => unitText(unit, mode)).join("\n\n");

  try {
    if (navigator.clipboard && typeof window.ClipboardItem === "function") {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/html": new Blob([html], { type: "text/html" }),
          "text/plain": new Blob([text], { type: "text/plain" }),
        }),
      ]);
      return true;
    }
  } catch {
    // Rich write refused (permission or unsupported type) — try plain text.
  }

  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to the textarea path.
  }

  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.top = "-9999px";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    const copied = document.execCommand("copy");
    document.body.removeChild(textarea);
    return copied;
  } catch {
    return false;
  }
}
