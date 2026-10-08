"use server";

import { revalidatePath } from "next/cache";
import { ownerClient } from "@/lib/notes/data";
import { noteHtmlToText, sanitizeNoteHtmlServer } from "@/lib/notes/sanitize-server";
import { MAX_NOTE_CHARS } from "@/lib/notes/limits";
import {
  MAX_SAVE_BYTES,
  SAVE_MESSAGES,
  UNTITLED,
  normalizeTitle,
  saveBytes,
  saveFailure,
  type SaveFailure,
  type SaveResult,
} from "@/lib/notes/save-protocol";
import { reportServerError } from "@/lib/server-log";
import type { ActionResult } from "@/lib/admin/messages";

/** The notebook list's own wording; a save uses SAVE_MESSAGES.needs_account. */
const SIGN_IN_TO_WRITE = "خاتىرە يېزىش ئۈچۈن ھېساباتقا كىرىڭ.";

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
      if (!session) return { ok: false, code: "needs_account", error: SIGN_IN_TO_WRITE };

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
      if (error) {
        reportServerError("createNoteAction:insert", error);
        return saveFailure("failed");
      }

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

      const { data, error } = await session.supabase
        .from("note_documents")
        .update({ title: prepared.title, content_html: prepared.html, content_text: prepared.text })
        .eq("id", id)
        .eq("user_id", session.userId)
        .eq("updated_at", baseUpdatedAt)
        .select("updated_at")
        .maybeSingle();
      if (error) {
        reportServerError("saveNoteAction:update", error);
        return saveFailure("failed");
      }

      if (!data) {
        // Nothing matched: either the note is gone (or was never this
        // writer's), or it has moved on since this text was written.
        const { data: current, error: readError } = await session.supabase
          .from("note_documents")
          .select("updated_at")
          .eq("id", id)
          .eq("user_id", session.userId)
          .maybeSingle();
        if (readError) {
          reportServerError("saveNoteAction:version", readError);
          return saveFailure("failed");
        }
        if (!current) return saveFailure("not_found");
        return saveFailure("conflict", (current as { updated_at: string }).updated_at);
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
        .select("title, content_html, updated_at")
        .eq("id", id)
        .eq("user_id", session.userId)
        .maybeSingle();
      if (error) {
        reportServerError("loadNoteAction", error);
        return saveFailure("failed");
      }
      if (!data) return saveFailure("not_found");
      const row = data as { title: string; content_html: string; updated_at: string };
      return { ok: true, title: row.title, html: row.content_html, updatedAt: row.updated_at };
    },
    saveFailure("failed"),
  );
}

export async function deleteNoteAction(formData: FormData): Promise<ActionResult> {
  return guarded(
    "deleteNoteAction",
    async (): Promise<ActionResult> => {
      const session = await ownerClient();
      if (!session) return { ok: false, error: SIGN_IN_TO_WRITE };

      const id = Number(formData.get("id"));
      if (!Number.isInteger(id)) return { ok: false, error: SAVE_MESSAGES.failed };

      const { error } = await session.supabase
        .from("note_documents")
        .delete()
        .eq("id", id)
        .eq("user_id", session.userId);
      if (error) {
        reportServerError("deleteNoteAction:delete", error);
        return { ok: false, error: SAVE_MESSAGES.failed };
      }

      revalidatePath("/notes");
      return { ok: true, message: "ئۆچۈرۈلدى." };
    },
    { ok: false, error: SAVE_MESSAGES.failed },
  );
}
