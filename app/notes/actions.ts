"use server";

import { revalidatePath } from "next/cache";
import { ownerClient, toNoteSummary, type NoteSummary } from "@/lib/notes/data";
import { noteHtmlToText, sanitizeNoteHtmlServer } from "@/lib/notes/sanitize-server";
import { MAX_NOTE_CHARS } from "@/lib/notes/limits";
import {
  CREATE_RATE_MESSAGE,
  MAX_SAVE_BYTES,
  UNTITLED,
  normalizeTitle,
  quotaCode,
  saveBytes,
  saveFailure,
  type SaveFailure,
  type SaveResult,
} from "@/lib/notes/save-protocol";
import {
  LIST_MESSAGES,
  SEARCH_MAX_CHARS,
  SEARCH_MIN_CHARS,
  listFailure,
  type ListFailure,
} from "@/lib/notes/list-protocol";
import { NOTE_CREATE_RULE, NOTE_SAVE_RULE, NOTE_SEARCH_RULE, isRateLimited } from "@/lib/rate-limit";
import { reportServerError } from "@/lib/server-log";

/**
 * Never let an action throw.
 *
 * A Server Action that rejects surfaces as Next's own error screen — a blank
 * page saying "A server error occurred", with no way back and nothing written
 * down. That is exactly what «يېڭى خاتىرە» did in production. Whatever goes
 * wrong now, the writer gets a sentence in Uyghur and the cause goes to the
 * platform log.
 *
 * A session check that could not be made throws too (lib/notes/data.ts
 * `ownerClient`), and so lands here as `failed` — retried by the editor —
 * rather than as `needs_account`, which would tell a writer they had been
 * signed out because Auth was slow.
 */
async function guarded<T>(where: string, work: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await work();
  } catch (error) {
    reportServerError(where, error);
    return fallback;
  }
}

/**
 * Sanitize on the way IN as well as on the way out. The editor sanitizes what
 * it pastes, but a Server Action is a public endpoint — whatever reaches it
 * must be treated as if a stranger wrote it.
 *
 * This used to run DOMPurify against a jsdom window, and that is exactly what
 * broke the notebook in production: jsdom cannot be loaded in Vercel's runtime,
 * so importing it threw while this module was still being evaluated and every
 * action in the file answered 500. lib/notes/sanitize-server.ts explains it in
 * full. The allow-list is unchanged; only the parser under it is.
 */
function clean(html: string): { html: string; text: string } {
  const safe = sanitizeNoteHtmlServer(html);
  return { html: safe, text: noteHtmlToText(safe) };
}

/** What a writer may send as a note's text, checked before anything is stored. */
function prepare(title: string, html: string): SaveFailure | { title: string; html: string; text: string } {
  // Next refuses a body over 1 MB before this runs; this is the same line the
  // editor draws, held here too because anyone can call an action directly.
  if (saveBytes({ title, html }) > MAX_SAVE_BYTES) return saveFailure("too_large");
  const safe = clean(html);
  if (safe.text.length > MAX_NOTE_CHARS) return saveFailure("too_long");
  return { title: normalizeTitle(title), html: safe.html, text: safe.text };
}

function isNoteId(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

/**
 * A write the database refused. The notebook's quota (200 notes, 5 MB per
 * account — migration 0030) is enforced by a trigger, which answers with an
 * exception of its own name; that is a full notebook, said in Uyghur, not a
 * failure to log. Anything else is.
 */
function writeFailure(where: string, error: unknown): SaveFailure {
  const quota = quotaCode(error as { message?: unknown } | null);
  if (quota) return saveFailure(quota);
  reportServerError(where, error);
  return saveFailure("failed");
}

export type CreateNoteResult = { ok: true; id: number; updatedAt: string } | SaveFailure;

/**
 * A new note — empty, or already holding a text («ئىككى خاتىرە قىلىپ ساقلاش»
 * after a conflict, «يېڭى خاتىرە قىلىپ ساقلاش» after the note was deleted
 * elsewhere, an AI answer saved from the reader), in one request.
 */
export async function createNoteAction(input?: { title?: unknown; html?: unknown }): Promise<CreateNoteResult> {
  return guarded(
    "createNoteAction",
    async (): Promise<CreateNoteResult> => {
      const session = await ownerClient();
      if (!session) return { ok: false, code: "needs_account", error: LIST_MESSAGES.needs_account };
      // Keyed on the writer, never the address: a carrier's NAT puts
      // thousands of readers behind one IP.
      if (isRateLimited(`note-create:${session.userId}`, NOTE_CREATE_RULE)) {
        return { ok: false, code: "rate", error: CREATE_RATE_MESSAGE };
      }

      // Called with nothing (the list's button) or with a FormData by anyone
      // who tries: only a plain object carries a text.
      const given = input && typeof input === "object" && !(input instanceof FormData) ? input : {};
      const html = typeof given.html === "string" ? given.html : "";
      const title = typeof given.title === "string" ? given.title : UNTITLED;

      const row: { user_id: string; title: string; content_html?: string; content_text?: string } = {
        user_id: session.userId,
        title: normalizeTitle(title),
      };
      if (html) {
        const prepared = prepare(title, html);
        if ("ok" in prepared) return prepared;
        row.content_html = prepared.html;
        row.content_text = prepared.text;
      }

      const { data, error } = await session.supabase
        .from("note_documents")
        .insert(row)
        .select("id, updated_at")
        .single();
      if (error) return writeFailure("createNoteAction:insert", error);

      revalidatePath("/notes");
      const created = data as { id: number; updated_at: string };
      return { ok: true, id: created.id, updatedAt: created.updated_at };
    },
    saveFailure("failed"),
  );
}

/**
 * Save a note — only over the version it was written on.
 *
 * `baseUpdatedAt` is the `updated_at` the editor last saw, passed back
 * exactly as PostgREST printed it (microseconds). The row is updated only
 * while it still carries that value: a second tab or a second device that
 * saved in between moved it, and this save then answers `conflict` with the
 * server's version instead of silently writing over theirs (N5). The trigger
 * note_documents_set_updated_at moves `updated_at` on every write.
 */
export async function saveNoteAction(input: {
  id: number;
  title: string;
  html: string;
  baseUpdatedAt: string;
}): Promise<SaveResult> {
  return guarded(
    "saveNoteAction",
    async (): Promise<SaveResult> => {
      const session = await ownerClient();
      if (!session) return saveFailure("needs_account");
      if (isRateLimited(`note-save:${session.userId}`, NOTE_SAVE_RULE)) return saveFailure("rate");

      const { id, title, html, baseUpdatedAt } = input ?? {};
      if (
        !isNoteId(id) ||
        typeof title !== "string" ||
        typeof html !== "string" ||
        typeof baseUpdatedAt !== "string" ||
        !baseUpdatedAt ||
        baseUpdatedAt.length > 64
      ) {
        return saveFailure("failed");
      }

      const prepared = prepare(title, html);
      if ("ok" in prepared) return prepared;

      // Never into the trash (PROMPT-47): a note moved there in another tab
      // or on another device stays as it was put there.
      const { data, error } = await session.supabase
        .from("note_documents")
        .update({ title: prepared.title, content_html: prepared.html, content_text: prepared.text })
        .eq("id", id)
        .eq("user_id", session.userId)
        .eq("updated_at", baseUpdatedAt)
        .is("deleted_at", null)
        .select("updated_at")
        .maybeSingle();
      if (error) return writeFailure("saveNoteAction:update", error);

      if (!data) {
        // Nothing matched: the note is gone (or was never this writer's), it
        // is in the trash, or it has moved on since this text was written.
        const { data: current, error: readError } = await session.supabase
          .from("note_documents")
          .select("updated_at, deleted_at")
          .eq("id", id)
          .eq("user_id", session.userId)
          .maybeSingle();
        if (readError) {
          reportServerError("saveNoteAction:version", readError);
          return saveFailure("failed");
        }
        if (!current) return saveFailure("not_found");
        const row = current as { updated_at: string; deleted_at: string | null };
        if (row.deleted_at) return saveFailure("in_trash");
        return saveFailure("conflict", row.updated_at);
      }

      revalidatePath("/notes");
      return { ok: true, updatedAt: (data as { updated_at: string }).updated_at };
    },
    saveFailure("failed"),
  );
}

export type NoteVersionResult = { ok: true; updatedAt: string } | SaveFailure;

/** Only the version — asked when a tab comes back after a while away. */
export async function noteVersionAction(id: number): Promise<NoteVersionResult> {
  return guarded(
    "noteVersionAction",
    async (): Promise<NoteVersionResult> => {
      const session = await ownerClient();
      if (!session) return saveFailure("needs_account");
      if (!isNoteId(id)) return saveFailure("not_found");
      const { data, error } = await session.supabase
        .from("note_documents")
        .select("updated_at")
        .eq("id", id)
        .eq("user_id", session.userId)
        .maybeSingle();
      if (error) {
        reportServerError("noteVersionAction", error);
        return saveFailure("failed");
      }
      if (!data) return saveFailure("not_found");
      return { ok: true, updatedAt: (data as { updated_at: string }).updated_at };
    },
    saveFailure("failed"),
  );
}

export type LoadNoteResult = { ok: true; title: string; html: string; updatedAt: string } | SaveFailure;

/**
 * The server's version of a note, for the editor to put on screen when the
 * writer chose it after a conflict, or when it changed elsewhere while this
 * tab was away.
 */
export async function loadNoteAction(id: number): Promise<LoadNoteResult> {
  return guarded(
    "loadNoteAction",
    async (): Promise<LoadNoteResult> => {
      const session = await ownerClient();
      if (!session) return saveFailure("needs_account");
      if (!isNoteId(id)) return saveFailure("not_found");
      const { data, error } = await session.supabase
        .from("note_documents")
        .select("title, content_html, updated_at, deleted_at")
        .eq("id", id)
        .eq("user_id", session.userId)
        .maybeSingle();
      if (error) {
        reportServerError("loadNoteAction", error);
        return saveFailure("failed");
      }
      if (!data) return saveFailure("not_found");
      const row = data as { title: string; content_html: string; updated_at: string; deleted_at: string | null };
      // A conflict choice settled against a note in the trash would write
      // into it; the editor puts it back first, or not at all.
      if (row.deleted_at) return saveFailure("in_trash");
      return { ok: true, title: row.title, html: row.content_html, updatedAt: row.updated_at };
    },
    saveFailure("failed"),
  );
}

/* ── The list and the trash (PROMPT-47) ───────────────────────────────────── */

export type NoteListResult = { ok: true } | ListFailure;

/**
 * Every page under /notes shows the list or the trash, and a note's own page
 * changes when it goes to the trash or comes back: all of it is rendered
 * afresh, the page the action came from in the same response.
 */
function revalidateNotebook(): void {
  revalidatePath("/notes", "layout");
}

/**
 * One update of the writer's own note, the way pin, trash and restore all
 * need it: by id AND owner (RLS refuses anyone else's anyway), and only from
 * the state named by `where`. None of the three touches the title or the
 * text, so none moves `updated_at` (0031) — an editor open elsewhere is not
 * told the note changed.
 *
 * When nothing matched, `settled` says whether the note is already where it
 * was asked to go (a second tap, another tab first) — that is not a failure.
 */
async function updateOwnNote(
  where: string,
  id: unknown,
  values: { pinned_at?: string | null; deleted_at?: string | null },
  state: "live" | "trash",
  settled: (row: { deleted_at: string | null }) => boolean,
): Promise<NoteListResult> {
  return guarded(
    where,
    async (): Promise<NoteListResult> => {
      const session = await ownerClient();
      if (!session) return listFailure("needs_account");
      if (!isNoteId(id)) return listFailure("not_found");

      const update = session.supabase.from("note_documents").update(values).eq("id", id).eq("user_id", session.userId);
      const filtered = state === "live" ? update.is("deleted_at", null) : update.not("deleted_at", "is", null);
      const { data, error } = await filtered.select("id").maybeSingle();
      if (error) {
        reportServerError(`${where}:update`, error);
        return listFailure("failed");
      }

      if (!data) {
        const { data: current, error: readError } = await session.supabase
          .from("note_documents")
          .select("deleted_at")
          .eq("id", id)
          .eq("user_id", session.userId)
          .maybeSingle();
        if (readError) {
          reportServerError(`${where}:read`, readError);
          return listFailure("failed");
        }
        if (!current || !settled(current as { deleted_at: string | null })) return listFailure("not_found");
      }

      revalidateNotebook();
      return { ok: true };
    },
    listFailure("failed"),
  );
}

/** Pin a note to the top of the list, or take it down. Not for a note in the trash. */
export async function pinNoteAction(id: number, pinned: boolean): Promise<NoteListResult> {
  return updateOwnNote(
    "pinNoteAction",
    id,
    { pinned_at: pinned === true ? new Date().toISOString() : null },
    "live",
    () => false,
  );
}

/**
 * «ئۆچۈرۈش» on the list: into the trash, at once and without a question —
 * it can be put back for 30 days. Deleting for good is only ever done from
 * the trash, in two steps.
 */
export async function trashNoteAction(id: number): Promise<NoteListResult> {
  return updateOwnNote(
    "trashNoteAction",
    id,
    { deleted_at: new Date().toISOString() },
    "live",
    (row) => row.deleted_at !== null,
  );
}

/** «قايتۇرۇش»: out of the trash, exactly as it went in. */
export async function restoreNoteAction(id: number): Promise<NoteListResult> {
  return updateOwnNote("restoreNoteAction", id, { deleted_at: null }, "trash", (row) => row.deleted_at === null);
}

/** «مەڭگۈلۈك ئۆچۈرۈش» — only a note already in the trash. */
export async function deleteNoteForeverAction(id: number): Promise<NoteListResult> {
  return guarded(
    "deleteNoteForeverAction",
    async (): Promise<NoteListResult> => {
      const session = await ownerClient();
      if (!session) return listFailure("needs_account");
      if (!isNoteId(id)) return listFailure("not_found");

      const { data, error } = await session.supabase
        .from("note_documents")
        .delete()
        .eq("id", id)
        .eq("user_id", session.userId)
        .not("deleted_at", "is", null)
        .select("id");
      if (error) {
        reportServerError("deleteNoteForeverAction:delete", error);
        return listFailure("failed");
      }
      if (!data || data.length === 0) return listFailure("not_found");

      revalidateNotebook();
      return { ok: true };
    },
    listFailure("failed"),
  );
}

export type EmptyTrashResult = { ok: true; deleted: number } | ListFailure;

/** «ئەخلەت ساندۇقىنى بوشىتىش»: every note in this writer's trash, for good. */
export async function emptyTrashAction(): Promise<EmptyTrashResult> {
  return guarded(
    "emptyTrashAction",
    async (): Promise<EmptyTrashResult> => {
      const session = await ownerClient();
      if (!session) return listFailure("needs_account");

      const { data, error } = await session.supabase
        .from("note_documents")
        .delete()
        .eq("user_id", session.userId)
        .not("deleted_at", "is", null)
        .select("id");
      if (error) {
        reportServerError("emptyTrashAction:delete", error);
        return listFailure("failed");
      }

      revalidateNotebook();
      return { ok: true, deleted: data?.length ?? 0 };
    },
    listFailure("failed"),
  );
}

export type SearchNotesResult = { ok: true; notes: NoteSummary[] } | ListFailure;

/**
 * The search box on /notes: search_my_notes (0031) as the writer, so RLS
 * applies. What was typed goes to the database as a parameter and nowhere
 * else — not into a log (a failure reports its code and stage, never the
 * query), not into a table.
 */
export async function searchMyNotesAction(query: string): Promise<SearchNotesResult> {
  return guarded(
    "searchMyNotesAction",
    async (): Promise<SearchNotesResult> => {
      const session = await ownerClient();
      if (!session) return listFailure("needs_account");
      if (typeof query !== "string") return listFailure("failed");

      // Outside the bounds the function itself would find nothing: answered
      // here without a request.
      const trimmed = query.trim();
      if (trimmed.length < SEARCH_MIN_CHARS || trimmed.length > SEARCH_MAX_CHARS) return { ok: true, notes: [] };

      if (isRateLimited(`note-search:${session.userId}`, NOTE_SEARCH_RULE)) return listFailure("rate");

      const { data, error } = await session.supabase.rpc("search_my_notes", { p_query: trimmed, p_limit: 50 });
      if (error) {
        reportServerError("searchMyNotesAction:rpc", { code: error.code, message: "search_my_notes failed" });
        return listFailure("failed");
      }
      return { ok: true, notes: ((data as Parameters<typeof toNoteSummary>[0][] | null) ?? []).map(toNoteSummary) };
    },
    listFailure("failed"),
  );
}

export type DiscardResult = { ok: true; discarded: boolean } | ListFailure;

/**
 * The editor is being left and nothing was ever written in this note. The
 * server decides (discard_note_if_empty, 0031): only the writer's own note,
 * outside the trash, with the default title, no text, and never saved since
 * it was made. Anything else stays.
 *
 * No revalidation: the call is made on the way OUT of the editor, and
 * re-rendering the page it came from would draw a 404 over the editor for a
 * moment. The editor refreshes whatever page the writer went to instead.
 */
export async function discardIfEmptyAction(id: number): Promise<DiscardResult> {
  return guarded(
    "discardIfEmptyAction",
    async (): Promise<DiscardResult> => {
      const session = await ownerClient();
      if (!session) return listFailure("needs_account");
      if (!isNoteId(id)) return listFailure("not_found");

      const { data, error } = await session.supabase.rpc("discard_note_if_empty", { p_id: id });
      if (error) {
        reportServerError("discardIfEmptyAction:rpc", error);
        return listFailure("failed");
      }
      return { ok: true, discarded: data === true };
    },
    listFailure("failed"),
  );
}
