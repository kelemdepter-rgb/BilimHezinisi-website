"use server";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { runBookSearch, type SearchHit } from "@/lib/search/books";
import { runQuranSearch } from "@/lib/quran/data";
import { findOccurrences } from "@/lib/search/occurrences";
import { stripMarkdown } from "@/lib/books/render-markdown";
import { NOTE_SOURCE_RULE, callerKey, isRateLimited } from "@/lib/rate-limit";
import { reportServerError } from "@/lib/server-log";
import type { Aya, QuranHit } from "@/lib/quran/types";

/**
 * Searching the library, and the Qur'an, from inside a note.
 *
 * This is the desktop app's strongest feature («كىتاب ئامبىرىدىن ئىزدەش» in
 * src/notes.js): write a sentence, find where the library already says it, and
 * cite it without leaving the page. Everything here is a thin wrapper over
 * search this site already runs — `search_books` and `search_quran` — so the
 * notebook adds no query the library does not already make, and no index.
 *
 * Three rules the whole file obeys:
 *   - the notebook needs an account, so every action checks for one;
 *   - only `status = 'published'` books are searchable, which the RPC enforces
 *     in SQL, so a draft can never reach someone's note;
 *   - the limiter is keyed on the user, not the address, because a carrier's
 *     NAT puts thousands of readers behind one IP.
 */

const MSG = {
  needsAccount: "خاتىرە يېزىش ئۈچۈن ھېساباتقا كىرىڭ.",
  tooFast: "بەك كۆپ ئىزدىدىڭىز. بىر ئاز ساقلاپ قايتا سىناڭ.",
  failed: "ئىزدەش مەغلۇپ بولدى. سەل تۇرۇپ قايتا سىناڭ.",
} as const;

export type NoteSourceHit = {
  bookId: number;
  title: string;
  author: string;
  pageNo: number;
  snippet: string;
};

export type NoteSourceResult =
  | { ok: true; hits: NoteSourceHit[]; tooCommon: boolean }
  | { ok: false; error: string };

export type NoteQuranResult = { ok: true; hits: QuranHit[] } | { ok: false; error: string };

export type NoteAyaResult =
  | { ok: true; aya: Aya; suraNameUg: string }
  | { ok: false; error: string };

export type NotePassageResult = { ok: true; passage: string } | { ok: false; error: string };

/** Longest query worth sending; past this it is not a phrase any more. */
const MAX_QUERY = 120;
/** How many results the panel shows. Small on purpose — it is a phone drawer. */
const RESULT_LIMIT = 8;
/** A cited paragraph past this length stops being a citation. */
const MAX_PASSAGE = 700;

/**
 * The signed-in caller, plus the limiter key to charge. Falls back to the
 * address only when there is somehow no user id to key on.
 */
async function notebookKey(): Promise<{ key: string } | null> {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return null;
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  return { key: `note-source:${user.id || (await callerKey())}` };
}

/** Search published books, exactly as the search page does. */
export async function searchLibraryForNoteAction(input: {
  query: string;
}): Promise<NoteSourceResult> {
  try {
    const caller = await notebookKey();
    if (!caller) return { ok: false, error: MSG.needsAccount };
    if (isRateLimited(caller.key, NOTE_SOURCE_RULE)) return { ok: false, error: MSG.tooFast };

    const query = input.query.trim().slice(0, MAX_QUERY);
    if (!query) return { ok: true, hits: [], tooCommon: false };

    const outcome = await runBookSearch({
      query,
      categoryId: null,
      limit: RESULT_LIMIT,
      offset: 0,
    });
    if (outcome.failed) return { ok: false, error: MSG.failed };

    return {
      ok: true,
      tooCommon: outcome.tooCommon,
      hits: outcome.hits.map((hit: SearchHit) => ({
        bookId: hit.book_id,
        title: hit.title,
        author: hit.author ?? "",
        pageNo: hit.page_no,
        // The RPC hands back a plain excerpt; the panel highlights it with the
        // one matcher the site shares, exactly as the search page does.
        snippet: stripMarkdown(hit.snippet ?? ""),
      })),
    };
  } catch (error) {
    reportServerError("searchLibraryForNoteAction", error);
    return { ok: false, error: MSG.failed };
  }
}

/**
 * The whole paragraph a match sits in, for a citation worth reading.
 *
 * One primary-key row read, not a scan: the page is addressed by book and
 * number. RLS keeps an unpublished book from answering at all.
 */
export async function expandPassageAction(input: {
  bookId: number;
  pageNo: number;
  query: string;
}): Promise<NotePassageResult> {
  try {
    const caller = await notebookKey();
    if (!caller) return { ok: false, error: MSG.needsAccount };
    if (isRateLimited(caller.key, NOTE_SOURCE_RULE)) return { ok: false, error: MSG.tooFast };

    const bookId = Math.floor(Number(input.bookId));
    const pageNo = Math.floor(Number(input.pageNo));
    if (!Number.isInteger(bookId) || bookId <= 0 || !Number.isInteger(pageNo) || pageNo <= 0) {
      return { ok: false, error: MSG.failed };
    }

    const supabase = await createSupabaseServerClient();
    if (!supabase) return { ok: false, error: MSG.failed };

    const { data, error } = await supabase
      .from("book_pages")
      .select("content")
      .eq("book_id", bookId)
      .eq("page_no", pageNo)
      .maybeSingle();
    if (error || !data) return { ok: false, error: MSG.failed };

    const content = (data as { content: string }).content ?? "";
    const query = input.query.trim().slice(0, MAX_QUERY);
    const [first] = query ? findOccurrences(content, query) : [];

    // The paragraph the match falls inside, or the opening one when the phrase
    // is not on this page after all (a title hit, say).
    const paragraphs = content.split(/\n{2,}/);
    let cursor = 0;
    let chosen = paragraphs[0] ?? "";
    for (const paragraph of paragraphs) {
      const end = cursor + paragraph.length;
      if (first && first.start >= cursor && first.start <= end) {
        chosen = paragraph;
        break;
      }
      cursor = end + 2;
    }

    const passage = stripMarkdown(chosen).replace(/\s+/g, " ").trim();
    return {
      ok: true,
      passage: passage.length > MAX_PASSAGE ? `${passage.slice(0, MAX_PASSAGE).trim()}…` : passage,
    };
  } catch (error) {
    reportServerError("expandPassageAction", error);
    return { ok: false, error: MSG.failed };
  }
}

/** Search the Qur'an, through the module's own RPC. */
export async function searchQuranForNoteAction(input: { query: string }): Promise<NoteQuranResult> {
  try {
    const caller = await notebookKey();
    if (!caller) return { ok: false, error: MSG.needsAccount };
    if (isRateLimited(caller.key, NOTE_SOURCE_RULE)) return { ok: false, error: MSG.tooFast };

    const query = input.query.trim().slice(0, MAX_QUERY);
    if (!query) return { ok: true, hits: [] };

    const outcome = await runQuranSearch({ query, limit: RESULT_LIMIT, offset: 0 });
    if (outcome.failed) return { ok: false, error: MSG.failed };
    return { ok: true, hits: outcome.hits };
  } catch (error) {
    reportServerError("searchQuranForNoteAction", error);
    return { ok: false, error: MSG.failed };
  }
}

/** One verse by number, with the sura's Uyghur name for the reference line. */
export async function getAyaForNoteAction(input: {
  sura: number;
  aya: number;
}): Promise<NoteAyaResult> {
  try {
    const caller = await notebookKey();
    if (!caller) return { ok: false, error: MSG.needsAccount };
    if (isRateLimited(caller.key, NOTE_SOURCE_RULE)) return { ok: false, error: MSG.tooFast };

    const sura = Math.floor(Number(input.sura));
    const aya = Math.floor(Number(input.aya));
    if (!Number.isInteger(sura) || sura < 1 || sura > 114 || !Number.isInteger(aya) || aya < 1) {
      return { ok: false, error: "توغرا سۈرە/ئايەت نومۇرىنى كىرگۈزۈڭ." };
    }

    const supabase = await createSupabaseServerClient();
    if (!supabase) return { ok: false, error: MSG.failed };

    const [verse, suraRow] = await Promise.all([
      supabase
        .from("quran_ayas")
        .select("sura, aya, text_ar, text_ug")
        .eq("sura", sura)
        .eq("aya", aya)
        .maybeSingle(),
      supabase.from("quran_suras").select("name_ug").eq("number", sura).maybeSingle(),
    ]);

    if (verse.error || !verse.data) return { ok: false, error: "بۇ ئايەت تېپىلمىدى." };
    return {
      ok: true,
      aya: verse.data as Aya,
      suraNameUg: ((suraRow.data as { name_ug: string } | null)?.name_ug ?? "").trim(),
    };
  } catch (error) {
    reportServerError("getAyaForNoteAction", error);
    return { ok: false, error: MSG.failed };
  }
}
