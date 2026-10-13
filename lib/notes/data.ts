import { cache } from "react";
import { isAuthApiError, isAuthSessionMissingError } from "@supabase/supabase-js";
import { throwIfUnavailable } from "@/lib/cache";
import { NOTE_TRASH_DAYS } from "@/lib/notes/limits";
import { reportServerError } from "@/lib/server-log";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { SESSION_DEADLINE_MS, withDeadline } from "@/lib/supabase/timeouts";

export type NoteSummary = {
  id: number;
  title: string;
  /** The first 160 characters of the text, whitespace collapsed (0031). */
  preview: string;
  created_at: string;
  updated_at: string;
  /** Set while the note is pinned to the top of the list. */
  pinned_at: string | null;
  /** Characters of plain text, for the list's "how long is this" hint. */
  length: number;
  /** What the note counts against the account's 5 MB (migration 0030). */
  bytes: number;
};

/** A note in the trash: it still counts against the quota until it is gone. */
export type TrashedNote = NoteSummary & { deleted_at: string };

/** Everything /notes shows: the notes, and the trash beside them. */
export type Notebook = { notes: NoteSummary[]; trash: TrashedNote[] };

export type NoteDocument = {
  id: number;
  /** The owner — the editor's key for this browser's copy, never a permission. */
  user_id: string;
  title: string;
  content_html: string;
  content_text: string;
  updated_at: string;
  /** Set while the note is in the trash: it opens read-only. */
  deleted_at: string | null;
};

/** The list's columns: metadata and the preview, never a note's body. */
const SUMMARY_COLUMNS =
  "id, title, preview, created_at, updated_at, pinned_at, deleted_at, content_length, content_bytes";

type SummaryRow = {
  id: number;
  title: string;
  preview: string | null;
  created_at: string;
  updated_at: string;
  pinned_at: string | null;
  deleted_at?: string | null;
  content_length: number;
  content_bytes: number;
};

/** One row as the list shows it; search_my_notes answers the same columns. */
export function toNoteSummary(row: SummaryRow): NoteSummary {
  return {
    id: Number(row.id),
    title: row.title,
    preview: row.preview ?? "",
    created_at: row.created_at,
    updated_at: row.updated_at,
    pinned_at: row.pinned_at ?? null,
    length: row.content_length,
    bytes: row.content_bytes,
  };
}

function toTrashedNote(row: SummaryRow & { deleted_at: string }): TrashedNote {
  return { ...toNoteSummary(row), deleted_at: row.deleted_at };
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** A session check that ran out of time: no answer at all. */
const UNANSWERED = { data: { user: null }, error: { code: "deadline" } } as const;

/**
 * Auth's own word that this request carries no valid session: none at all,
 * or a token it refused (4xx). Not a network failure, a timeout, a 5xx or
 * a 429 — those only say Auth could not be asked.
 */
function signedOut(error: unknown): boolean {
  if (isAuthSessionMissingError(error)) return true;
  return isAuthApiError(error) && error.status >= 400 && error.status < 500 && error.status !== 429;
}

/**
 * Notes are personal writing. RLS restricts note_documents to its owner, and
 * every read here also filters by the caller's id — one guard is the database's
 * and one is ours, so a mistake in either still leaves the other standing.
 *
 * Null means Auth ANSWERED that nobody is signed in, and the pages send that
 * visitor to sign in. An Auth that did not answer — failed, or ran past
 * SESSION_DEADLINE_MS — is not that, and throws like a failed read: as null
 * it made a writer's own note a 404 (PROMPT-40). The Server Actions in
 * app/notes/actions.ts ask the same way: a session check that failed is a
 * save that failed and is retried, never "you have been signed out".
 */
export async function ownerClient() {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return null;
  const { data, error } = await withDeadline(supabase.auth.getUser(), SESSION_DEADLINE_MS, UNANSWERED);
  if (error && !signedOut(error)) throwIfUnavailable("notes-auth", error);
  if (!data.user) return null;
  return { supabase, userId: data.user.id };
}

/**
 * The signed-in user's notes and trash, newest edit first, in one read. Null
 * when not signed in.
 *
 * Metadata only: `preview`, `content_length` and `content_bytes` are stored
 * generated columns (0031, 0018, 0030), so the list — and the usage line
 * above it, which counts the trash too, as the quota does — never downloads a
 * note's text.
 *
 * Throws when the read fails (PROMPT-40). An empty list is what /notes shows
 * as «تېخى خاتىرە يوق», and a writer whose notes did not load must never be
 * told they have none — on 2026-10-07 one was, a moment after creating a note.
 * app/notes/error.tsx says the notebook did not open, and offers to try again.
 */
export async function loadNotebook(): Promise<Notebook | null> {
  const owner = await ownerClient();
  if (!owner) return null;

  const { data, error } = await owner.supabase
    .from("note_documents")
    .select(SUMMARY_COLUMNS)
    .eq("user_id", owner.userId)
    .order("updated_at", { ascending: false });
  throwIfUnavailable("notes-list", error);

  const notebook: Notebook = { notes: [], trash: [] };
  for (const row of (data as SummaryRow[] | null) ?? []) {
    if (row.deleted_at) notebook.trash.push(toTrashedNote({ ...row, deleted_at: row.deleted_at }));
    else notebook.notes.push(toNoteSummary(row));
  }
  return notebook;
}

/**
 * The trash, most recently deleted first. Null when not signed in.
 *
 * Opening it first deletes this writer's own notes whose 30 days are over,
 * so nothing is shown that the daily purge (/api/health) would have taken
 * already. Through the writer's own client — RLS and the owner filter — so
 * it can only ever reach this account's rows, of which the quota allows 200.
 * A delete that fails is not the page failing: the expired notes are left
 * for the daily run, and not shown.
 */
export async function openTrash(now: number = Date.now()): Promise<TrashedNote[] | null> {
  const owner = await ownerClient();
  if (!owner) return null;

  const cutoff = new Date(now - NOTE_TRASH_DAYS * DAY_MS).toISOString();
  const { error: expireError } = await owner.supabase
    .from("note_documents")
    .delete()
    .eq("user_id", owner.userId)
    .not("deleted_at", "is", null)
    .lt("deleted_at", cutoff);
  if (expireError) reportServerError("notes-trash:expire", expireError);

  const { data, error } = await owner.supabase
    .from("note_documents")
    .select(SUMMARY_COLUMNS)
    .eq("user_id", owner.userId)
    .not("deleted_at", "is", null)
    .gte("deleted_at", cutoff)
    .order("deleted_at", { ascending: false });
  throwIfUnavailable("notes-trash", error);

  return ((data as (SummaryRow & { deleted_at: string })[] | null) ?? []).map(toTrashedNote);
}

/** One note, or null when it does not exist or belongs to someone else. */
/**
 * Deduplicated per request: the segment layout asks whether this note is
 * this reader's before the page does — that is what keeps a stranger's note
 * a 404 rather than a 200 with a not-found page in it — and both asks are one
 * query.
 *
 * A read that failed throws instead: null would make the writer's own note a
 * 404, as if it had been deleted.
 */
export const getNote = cache(async (id: number): Promise<NoteDocument | null> => {
  const owner = await ownerClient();
  if (!owner) return null;

  const { data, error } = await owner.supabase
    .from("note_documents")
    .select("id, user_id, title, content_html, content_text, updated_at, deleted_at")
    .eq("id", id)
    .eq("user_id", owner.userId)
    .maybeSingle();
  throwIfUnavailable("note", error);

  return (data as NoteDocument | null) ?? null;
});
