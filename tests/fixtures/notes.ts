import { expect, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * A scratch note for a spec to work in, made without pressing «يېڭى خاتىرە».
 *
 * Making a note through the page is rate-limited per writer
 * (NOTE_CREATE_RULE: 30 an hour, PROMPT-44), and every notebook project of a
 * run writes as the same staff account — roughly 350 notes a run across the
 * three Chromium viewports and the four Firefox/WebKit projects. Through the
 * button the suite would spend that allowance in its first minutes and fail
 * the rest. So a spec whose subject is NOT making a note gets its note
 * straight from the database, as the page's own user, through the
 * service-role key; the specs whose subject IS making one (a brand-new
 * account's first note, keeping both versions after a conflict, the quota
 * messages) still press the button.
 *
 * Written with the service role, so the quota trigger (migration 0030) does
 * not count it either way — and RLS is not asked, which is why the owner is
 * read from the page's own session rather than trusted from anywhere else.
 */

export function adminClient(): SupabaseClient {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/**
 * The id of the user this page is signed in as, read from @supabase/ssr's
 * session cookie (`sb-<ref>-auth-token`, split into `.0`, `.1` … when long;
 * "base64-" + base64url JSON). Nothing is sent anywhere.
 */
export async function signedInUserId(page: Page): Promise<string> {
  const cookies = await page.context().cookies();
  const parts = cookies
    .filter((cookie) => /^sb-[a-z0-9]+-auth-token(\.\d+)?$/.test(cookie.name))
    .sort((a, b) => a.name.localeCompare(b.name, "en", { numeric: true }));
  if (parts.length === 0) throw new Error("this page is not signed in");
  let value = parts.map((cookie) => cookie.value).join("");
  if (value.startsWith("base64-")) value = Buffer.from(value.slice("base64-".length), "base64url").toString("utf8");
  const session = JSON.parse(value) as { user?: { id?: string } };
  const id = session.user?.id;
  if (!id) throw new Error("the session cookie names no user");
  return id;
}

/**
 * Make a note for the page's user, open it, and return its path — once the
 * editor takes input. Empty, or holding `html` exactly as given, for a spec
 * about a note of a particular shape (one that starts with a heading, say).
 *
 * Opening the note is a full page load, and the body is on screen (rendered
 * on the server) before the editor is hydrated and ready; an `input` event
 * dispatched in between is never heard and the edit never saved. Pressing
 * «يېڭى خاتىرە» arrived by an in-app navigation on a page already running,
 * where that gap hardly existed. The editor says it is ready by turning
 * contentEditable on.
 */
export async function newNote(page: Page, content: { html?: string } = {}): Promise<string> {
  const userId = await signedInUserId(page);
  const row: { user_id: string; content_html?: string; content_text?: string } = { user_id: userId };
  if (content.html !== undefined) {
    row.content_html = content.html;
    // Only the search and the counts read this column; tags off is enough.
    row.content_text = content.html.replace(/<[^>]*>/g, " ");
  }
  const { data, error } = await adminClient().from("note_documents").insert(row).select("id").single();
  if (error || !data) throw new Error(`could not make a scratch note: ${error?.message}`);
  const path = `/notes/${(data as { id: number }).id}`;
  await page.goto(path);
  await expect(page.getByTestId("note-body")).toHaveAttribute("contenteditable", "true");
  return path;
}

/** Delete a scratch note by its path, straight from the database. */
export async function dropNote(path: string): Promise<void> {
  const id = Number(path.split("/").pop());
  const { error } = await adminClient().from("note_documents").delete().eq("id", id);
  if (error) throw new Error(`could not delete scratch note ${id}: ${error.message}`);
}

/**
 * Open the find bar wherever its button is: in the tool row where there is
 * room, under «باشقا ئىقتىدارلار» on a phone (PROMPT-45).
 */
export async function openFind(page: Page): Promise<void> {
  const button = page.getByTestId("find-open");
  if (!(await button.isVisible())) await page.getByTestId("toolbar-more").click();
  await button.click();
  await expect(page.getByTestId("find-bar")).toBeVisible();
}

/** Choose a block style for the block the caret is in, from its menu. */
export async function chooseBlock(page: Page, style: "normal" | "heading" | "quote"): Promise<void> {
  await page.getByTestId("block-style").click();
  await page.getByTestId(`format-${style}`).click();
  await expect(page.getByTestId("block-style-menu")).toHaveCount(0);
}
