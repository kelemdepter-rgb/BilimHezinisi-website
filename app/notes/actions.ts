"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { noteHtmlToText, sanitizeNoteHtmlServer } from "@/lib/notes/sanitize-server";
import { MAX_NOTE_CHARS } from "@/lib/notes/limits";
import { reportServerError } from "@/lib/server-log";
import type { ActionResult } from "@/lib/admin/messages";

const MSG = {
  needsAccount: "خاتىرە يېزىش ئۈچۈن ھېساباتقا كىرىڭ.",
  notFound: "بۇ خاتىرە تېپىلمىدى.",
  tooLong: `خاتىرە بەك ئۇزۇن بولۇپ كەتتى (${MAX_NOTE_CHARS.toLocaleString("en-US")} ھەرپتىن ئاشماسلىقى كېرەك). ئىككىگە بۆلۈپ يېزىڭ.`,
  failed: "مەشغۇلات مەغلۇپ بولدى. سەل تۇرۇپ قايتا سىناڭ.",
} as const;

/**
 * Never let an action throw.
 *
 * A Server Action that rejects surfaces as Next's own error screen — a blank
 * page saying "A server error occurred", with no way back and nothing written
 * down. That is exactly what «يېڭى خاتىرە» did in production. Whatever goes
 * wrong now, the writer gets a sentence in Uyghur and the cause goes to the
 * platform log.
 */
async function guarded<T extends ActionResult>(
  where: string,
  work: () => Promise<T>,
): Promise<T | ActionResult> {
  try {
    return await work();
  } catch (error) {
    reportServerError(where, error);
    return { ok: false, error: MSG.failed };
  }
}

async function owner() {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return null;
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  return { supabase, userId: user.id };
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

export async function createNoteAction(): Promise<ActionResult & { id?: number }> {
  return guarded("createNoteAction", async () => {
    const session = await owner();
    if (!session) return { ok: false, error: MSG.needsAccount };

    const { data, error } = await session.supabase
      .from("note_documents")
      .insert({ user_id: session.userId, title: "يېڭى خاتىرە" })
      .select("id")
      .single();
    if (error) {
      reportServerError("createNoteAction:insert", error);
      return { ok: false, error: MSG.failed };
    }

    revalidatePath("/notes");
    return { ok: true, id: (data as { id: number }).id };
  });
}

export async function saveNoteAction(input: {
  id: number;
  title: string;
  html: string;
}): Promise<ActionResult> {
  return guarded("saveNoteAction", async () => {
    const session = await owner();
    if (!session) return { ok: false, error: MSG.needsAccount };

    const { html, text } = clean(input.html);
    if (text.length > MAX_NOTE_CHARS) return { ok: false, error: MSG.tooLong };

    const title = input.title.trim().slice(0, 200) || "يېڭى خاتىرە";

    const { error, count } = await session.supabase
      .from("note_documents")
      .update({ title, content_html: html, content_text: text }, { count: "exact" })
      .eq("id", input.id)
      .eq("user_id", session.userId);

    if (error) {
      reportServerError("saveNoteAction:update", error);
      return { ok: false, error: MSG.failed };
    }
    if (count === 0) return { ok: false, error: MSG.notFound };

    revalidatePath("/notes");
    return { ok: true, message: "ساقلاندى" };
  });
}

export async function deleteNoteAction(formData: FormData): Promise<ActionResult> {
  return guarded("deleteNoteAction", async () => {
    const session = await owner();
    if (!session) return { ok: false, error: MSG.needsAccount };

    const id = Number(formData.get("id"));
    if (!Number.isInteger(id)) return { ok: false, error: MSG.failed };

    const { error } = await session.supabase
      .from("note_documents")
      .delete()
      .eq("id", id)
      .eq("user_id", session.userId);
    if (error) {
      reportServerError("deleteNoteAction:delete", error);
      return { ok: false, error: MSG.failed };
    }

    revalidatePath("/notes");
    return { ok: true, message: "ئۆچۈرۈلدى." };
  });
}
