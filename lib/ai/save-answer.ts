"use client";

import { createNoteAction, saveNoteAction } from "@/app/notes/actions";
import { readerHref } from "@/lib/notes/insert";

/**
 * «خاتىرىگە ساقلاش» — put an answer into the reader's own notebook.
 *
 * THIS IS THE ONE PATH ON WHICH AN AI ANSWER REACHES OUR SERVER, and it does
 * so only because the reader pressed a button asking for exactly that. What
 * gets stored is an ordinary note in their own notebook, under the same RLS as
 * every other note, and it is theirs to edit or delete. Nothing about AI is
 * written anywhere without this tap: no key, no prompt, no answer, no record
 * that a question was ever asked.
 *
 * The note carries a link back to the page it came from, because an answer
 * about a book is worth much less when you cannot find the passage again —
 * the same reasoning behind the citation insert built in PROMPT 16.
 */

/** Small and grey on every theme, matching lib/notes/insert.ts. */
const CITE_STYLE = "font-size:13px;color:#8a8a8a";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export type SaveAnswerInput = {
  bookId: number;
  title: string;
  author: string;
  pageNo: number;
  /** The reader's own question, when they asked one. */
  question: string;
  /** «خۇلاسىلەش», «تەرجىمە» … so the note says what was asked for. */
  typeLabelText: string;
  /** The answer, already rendered by markdown-it with html:false. */
  answerHtml: string;
};

/** «AI — «ماۋزۇ» — 12-بەت» */
export function noteTitleFor(input: Pick<SaveAnswerInput, "title" | "pageNo">): string {
  const page = input.pageNo > 0 ? ` — ${input.pageNo}-بەت` : "";
  return `AI — «${input.title}»${page}`.slice(0, 200);
}

/**
 * The note's body. Everything here uses only tags the note allow-list admits
 * (lib/notes/sanitize-server.ts), so what is saved is what comes back.
 */
export function noteHtmlFor(input: SaveAnswerInput): string {
  const parts: string[] = [];

  parts.push(
    `<p dir="rtl" style="${CITE_STYLE}">سۈنئىي ئىدراكنىڭ جاۋابى · ${escapeHtml(
      input.typeLabelText,
    )}</p>`,
  );

  if (input.question.trim()) {
    parts.push(`<p dir="rtl"><b>سوئال:</b> ${escapeHtml(input.question.trim())}</p>`);
  }

  parts.push(`<div dir="rtl">${input.answerHtml}</div>`);

  const href = escapeHtml(readerHref({ bookId: input.bookId, pageNo: input.pageNo, query: "" }));
  const label = escapeHtml(
    [
      `«${input.title}»`,
      input.author.trim(),
      input.pageNo > 0 ? `${input.pageNo}-بەت` : "",
    ]
      .filter(Boolean)
      .join(" — "),
  );
  parts.push(`<p dir="rtl" style="${CITE_STYLE}"><a href="${href}">${label}</a></p>`);

  // Saved answers outlive the panel that explained this, so the warning goes
  // in the note too.
  parts.push(
    `<p dir="rtl" style="${CITE_STYLE}">بۇ جاۋاب سۈنئىي ئىدراك تەرىپىدىن يېزىلغان ۋە خاتا بولۇشى مۇمكىن — كىتابنىڭ ئۆزىدىن تەكشۈرۈڭ.</p>`,
  );

  return parts.join("");
}

export async function saveAnswerToNotebook(
  input: SaveAnswerInput,
): Promise<{ ok: true; id: number } | { ok: false }> {
  const created = await createNoteAction();
  if (!created.ok || typeof created.id !== "number") return { ok: false };

  const saved = await saveNoteAction({
    id: created.id,
    title: noteTitleFor(input),
    html: noteHtmlFor(input),
  });
  return saved.ok ? { ok: true, id: created.id } : { ok: false };
}
