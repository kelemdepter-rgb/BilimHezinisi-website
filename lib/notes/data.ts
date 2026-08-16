import { createSupabaseServerClient } from "@/lib/supabase/server";

export type NoteSummary = {
  id: number;
  title: string;
  updated_at: string;
  /** Characters of plain text, for the list's "how long is this" hint. */
  length: number;
};

export type NoteDocument = {
  id: number;
  title: string;
  content_html: string;
  content_text: string;
  updated_at: string;
};

/**
 * Notes are personal writing. RLS restricts note_documents to its owner, and
 * every read here also filters by the caller's id — one guard is the database's
 * and one is ours, so a mistake in either still leaves the other standing.
 */
async function ownerClient() {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return null;
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  return { supabase, userId: user.id };
}

/** The signed-in user's notes, newest edit first. Null when not signed in. */
export async function listNotes(): Promise<NoteSummary[] | null> {
  const owner = await ownerClient();
  if (!owner) return null;

  const { data } = await owner.supabase
    .from("note_documents")
    .select("id, title, updated_at, content_length")
    .eq("user_id", owner.userId)
    .order("updated_at", { ascending: false });

  type Row = { id: number; title: string; updated_at: string; content_length: number };
  return ((data as Row[] | null) ?? []).map((row) => ({
    id: row.id,
    title: row.title,
    updated_at: row.updated_at,
    length: row.content_length,
  }));
}

/** One note, or null when it does not exist or belongs to someone else. */
export async function getNote(id: number): Promise<NoteDocument | null> {
  const owner = await ownerClient();
  if (!owner) return null;

  const { data } = await owner.supabase
    .from("note_documents")
    .select("id, title, content_html, content_text, updated_at")
    .eq("id", id)
    .eq("user_id", owner.userId)
    .maybeSingle();

  return (data as NoteDocument | null) ?? null;
}
