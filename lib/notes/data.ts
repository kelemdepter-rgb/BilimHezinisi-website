import { cache } from "react";
import { isAuthApiError, isAuthSessionMissingError } from "@supabase/supabase-js";
import { throwIfUnavailable } from "@/lib/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { SESSION_DEADLINE_MS, withDeadline } from "@/lib/supabase/timeouts";

export type NoteSummary = {
  id: number;
  title: string;
  updated_at: string;
  /** Characters of plain text, for the list's "how long is this" hint. */
  length: number;
};

export type NoteDocument = {
  id: number;
  /** The owner — the editor's key for this browser's copy, never a permission. */
  user_id: string;
  title: string;
  content_html: string;
  content_text: string;
  updated_at: string;
};

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
 * The signed-in user's notes, newest edit first. Null when not signed in.
 *
 * Throws when the read fails (PROMPT-40). An empty list is what /notes shows
 * as «تېخى خاتىرە يوق», and a writer whose notes did not load must never be
 * told they have none — on 2026-10-07 one was, a moment after creating a note.
 * app/notes/error.tsx says the notebook did not open, and offers to try again.
 */
export async function listNotes(): Promise<NoteSummary[] | null> {
  const owner = await ownerClient();
  if (!owner) return null;

  const { data, error } = await owner.supabase
    .from("note_documents")
    .select("id, title, updated_at, content_length")
    .eq("user_id", owner.userId)
    .order("updated_at", { ascending: false });
  throwIfUnavailable("notes-list", error);

  type Row = { id: number; title: string; updated_at: string; content_length: number };
  return ((data as Row[] | null) ?? []).map((row) => ({
    id: row.id,
    title: row.title,
    updated_at: row.updated_at,
    length: row.content_length,
  }));
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
    .select("id, user_id, title, content_html, content_text, updated_at")
    .eq("id", id)
    .eq("user_id", owner.userId)
    .maybeSingle();
  throwIfUnavailable("note", error);

  return (data as NoteDocument | null) ?? null;
});
