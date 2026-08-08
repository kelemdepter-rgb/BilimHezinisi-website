/**
 * Aya clipboard, ported from desktop src/quran.js `copyAyaToClipboard`.
 *
 * Writes rich text and plain text together, so pasting into Word keeps the
 * Uthmani face and the ornate brackets, while a plain-text target still gets
 * readable output. Falls back to writeText, then to a hidden textarea, so an
 * older browser or a denied clipboard permission still copies something.
 */
import type { Aya } from "@/lib/quran/types";

const FONT_STACK_AR = "'Uthmanic Hafs','KFGQPC Uthmanic Script HAFS','Traditional Arabic','Amiri',serif";
const FONT_STACK_UG = "'UKIJ Ekran','UKIJ Tuz','Microsoft Uighur','Arial',sans-serif";

/** Ornate Quran brackets ﴿ ﴾ and the Uyghur quotation guillemets. */
const OPEN_AYA = "﴿";
const CLOSE_AYA = "﴾";
const OPEN_QUOTE = "«";
const CLOSE_QUOTE = "»";

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] as string,
  );
}

export async function copyAyas(ayas: Aya[], withTranslation: boolean): Promise<boolean> {
  if (ayas.length === 0) return false;

  const htmlParts: string[] = [];
  const textParts: string[] = [];

  for (const aya of ayas) {
    const arabic =
      `<span style="font-family:${FONT_STACK_AR};font-size:20pt;line-height:1.9">` +
      `${OPEN_AYA}${escapeHtml(aya.text_ar)}${CLOSE_AYA}</span>`;
    if (withTranslation && aya.text_ug) {
      htmlParts.push(
        `<p dir="rtl" style="text-align:right;margin:0 0 12pt 0;">${arabic}<br>` +
          `<span style="font-family:${FONT_STACK_UG};font-size:13pt;line-height:1.7;color:#333">` +
          `${OPEN_QUOTE}${escapeHtml(aya.text_ug)}${CLOSE_QUOTE}</span></p>`,
      );
      textParts.push(
        `${OPEN_AYA}${aya.text_ar}${CLOSE_AYA} ${OPEN_QUOTE}${aya.text_ug}${CLOSE_QUOTE}`,
      );
    } else {
      htmlParts.push(`<p dir="rtl" style="text-align:right;margin:0 0 12pt 0;">${arabic}</p>`);
      textParts.push(`${OPEN_AYA}${aya.text_ar}${CLOSE_AYA}`);
    }
  }

  const html = `<html><head><meta charset="utf-8"></head><body>${htmlParts.join("\n")}</body></html>`;
  const text = textParts.join("\n\n");

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
