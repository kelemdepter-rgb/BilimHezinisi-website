"use server";

import { revalidatePath } from "next/cache";
import { JSDOM } from "jsdom";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { sanitizeNoteHtml } from "@/lib/notes/sanitize";
import { MAX_NOTE_CHARS } from "@/lib/notes/limits";
import type { ActionResult } from "@/lib/admin/messages";

const MSG = {
  needsAccount: "خاتىرە يېزىش ئۈچۈن ھېساباتقا كىرىڭ.",
  notFound: "بۇ خاتىرە تېپىلمىدى.",
  tooLong: `خاتىرە بەك ئۇزۇن بولۇپ كەتتى (${MAX_NOTE_CHARS.toLocaleString("en-US")} ھەرپتىن ئاشماسلىقى كېرەك). ئىككىگە بۆلۈپ يېزىڭ.`,
  failed: "مەشغۇلات مەغلۇپ بولدى.",
} as const;

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
 * DOMPurify needs a DOM, which the server does not have, so jsdom supplies one
 * (the same approach the URL importer already uses).
 */
function clean(html: string): { html: string; text: string } {
  const dom = new JSDOM("");
  const safe = sanitizeNoteHtml(html, dom.window);
  const body = new JSDOM(`<body>${safe}</body>`).window.document.body;
  // Block elements have to become line breaks or every paragraph runs together
  // in the plain-text copy, which is what the counter and future search read.
  for (const node of body.querySelectorAll("p, div, br, li, h1, h2, h3, h4, h5, h6, blockquote")) {
    node.insertAdjacentText("beforeend", "\n");
  }
  const text = (body.textContent ?? "").replace(/\n{3,}/g, "\n\n").trim();
  return { html: safe, text };
}

export async function createNoteAction(): Promise<ActionResult & { id?: number }> {
  const session = await owner();
  if (!session) return { ok: false, error: MSG.needsAccount };

  const { data, error } = await session.supabase
    .from("note_documents")
    .insert({ user_id: session.userId, title: "يېڭى خاتىرە" })
    .select("id")
    .single();
  if (error) return { ok: false, error: MSG.failed };

  revalidatePath("/notes");
  return { ok: true, id: (data as { id: number }).id };
}

export async function saveNoteAction(input: {
  id: number;
  title: string;
  html: string;
}): Promise<ActionResult> {
  const session = await owner();
  if (!session) return { ok: false, error: MSG.needsAccount };

  const { html, text } = clean(input.html);
  if (text.length > MAX_NOTE_CHARS) return { ok: false, error: MSG.tooLong };

  const title = input.title.trim().slice(0, 200) || "يېڭى خاتىرە";

  const { error, count } = await session.supabase
    .from("note_documents")
    .update(
      { title, content_html: html, content_text: text },
      { count: "exact" },
    )
    .eq("id", input.id)
    .eq("user_id", session.userId);

  if (error) return { ok: false, error: MSG.failed };
  if (count === 0) return { ok: false, error: MSG.notFound };

  revalidatePath("/notes");
  return { ok: true, message: "ساقلاندى" };
}

export async function deleteNoteAction(formData: FormData): Promise<ActionResult> {
  const session = await owner();
  if (!session) return { ok: false, error: MSG.needsAccount };

  const id = Number(formData.get("id"));
  if (!Number.isInteger(id)) return { ok: false, error: MSG.failed };

  const { error } = await session.supabase
    .from("note_documents")
    .delete()
    .eq("id", id)
    .eq("user_id", session.userId);
  if (error) return { ok: false, error: MSG.failed };

  revalidatePath("/notes");
  return { ok: true, message: "ئۆچۈرۈلدى." };
}
