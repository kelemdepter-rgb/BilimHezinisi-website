/**
 * Aya rendering and clipboard, ported from desktop src/quran.js
 * `copyAyaToClipboard`.
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
import type { Aya } from "@/lib/quran/types";

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

/** The Arabic, in the Uthmani face, inside its ornate brackets. */
function arabicSpan(aya: Aya): string {
  return (
    `<span style="font-family:${FONT_STACK_AR};font-size:20pt;line-height:1.9">` +
    `${OPEN_AYA}${escapeHtml(aya.text_ar)}${CLOSE_AYA}</span>`
  );
}

/** The Uyghur translation, in the reading face, inside guillemets. */
function uyghurSpan(aya: Aya): string {
  return (
    `<span style="font-family:${FONT_STACK_UG};font-size:13pt;line-height:1.7;color:#333">` +
    `${OPEN_QUOTE}${escapeHtml(aya.text_ug)}${CLOSE_QUOTE}</span>`
  );
}

/**
 * One verse as a single RTL paragraph. `mode` falls back to the Arabic when a
 * translation was asked for and the verse carries none, which is the desktop's
 * behaviour and better than emitting an empty quotation.
 */
export function ayaHtml(aya: Aya, mode: AyaRenderMode): string {
  const hasTranslation = Boolean(aya.text_ug);
  const wanted: AyaRenderMode = mode !== "ar" && !hasTranslation ? "ar" : mode;

  const parts: string[] = [];
  if (wanted !== "ug") parts.push(arabicSpan(aya));
  if (wanted !== "ar") parts.push(uyghurSpan(aya));

  return `<p dir="rtl" style="text-align:right;margin:0 0 12pt 0;">${parts.join("<br>")}</p>`;
}

/** The same verse as plain text, for a plain-text clipboard target. */
export function ayaText(aya: Aya, mode: AyaRenderMode): string {
  const hasTranslation = Boolean(aya.text_ug);
  const wanted: AyaRenderMode = mode !== "ar" && !hasTranslation ? "ar" : mode;

  const parts: string[] = [];
  if (wanted !== "ug") parts.push(`${OPEN_AYA}${aya.text_ar}${CLOSE_AYA}`);
  if (wanted !== "ar") parts.push(`${OPEN_QUOTE}${aya.text_ug}${CLOSE_QUOTE}`);
  return parts.join(" ");
}

export async function copyAyas(ayas: Aya[], withTranslation: boolean): Promise<boolean> {
  if (ayas.length === 0) return false;

  const mode: AyaRenderMode = withTranslation ? "both" : "ar";
  const html = `<html><head><meta charset="utf-8"></head><body>${ayas
    .map((aya) => ayaHtml(aya, mode))
    .join("\n")}</body></html>`;
  const text = ayas.map((aya) => ayaText(aya, mode)).join("\n\n");

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
