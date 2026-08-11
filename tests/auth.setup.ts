import { test as setup, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  SEED_BOOK_HASH,
  SEED_BOOK_TITLE,
  SEED_NEEDLE,
  SEED_NEEDLE_PAGE,
  SEED_NEEDLE_LATER_PAGE,
  SEED_PAGE_COUNT,
  SEED_PATH,
  STAFF_EMAIL,
  STAFF_PASSWORD,
  STAFF_STATE_PATH,
  hasStaffTestEnv,
  loadEnvLocal,
} from "./env";

loadEnvLocal();

/**
 * Provision a disposable `uploader` account and save its signed-in state, so
 * the admin specs exercise the real guard rather than a mock. Removed again by
 * auth.teardown.ts.
 */
setup("create and sign in a staff account", async ({ page }) => {
  setup.skip(!hasStaffTestEnv(), "Supabase env not configured");

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  const { data: existing } = await admin.auth.admin.listUsers({ perPage: 200 });
  for (const user of existing?.users ?? []) {
    if (user.email === STAFF_EMAIL) await admin.auth.admin.deleteUser(user.id);
  }

  const { data: created, error } = await admin.auth.admin.createUser({
    email: STAFF_EMAIL,
    password: STAFF_PASSWORD,
    email_confirm: true,
  });
  if (error || !created.user) throw new Error(`could not create test user: ${error?.message}`);
  const { error: roleError } = await admin
    .from("profiles")
    .update({ role: "uploader", display_name: "E2E سىناق" })
    .eq("id", created.user.id);
  if (roleError) throw new Error(`could not set uploader role: ${roleError.message}`);

  await page.goto("/login");
  await page.locator('input[name="email"]').fill(STAFF_EMAIL);
  await page.locator('input[name="password"]').fill(STAFF_PASSWORD);
  await page.getByRole("button", { name: "كىرىش" }).click();

  // The admin link only renders for a staff session, so it proves the role took.
  await expect(page.getByRole("link", { name: /باشقۇرۇش/ })).toBeVisible({ timeout: 20_000 });

  mkdirSync(dirname(STAFF_STATE_PATH), { recursive: true });
  await page.context().storageState({ path: STAFF_STATE_PATH });
});

/**
 * Seed one published book with real pages, so the reader and search specs
 * exercise the actual data path instead of an empty library. Removed again by
 * auth.teardown.ts.
 */
setup("seed a published test book", async () => {
  setup.skip(!hasStaffTestEnv(), "Supabase env not configured");

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  await admin.from("books").delete().eq("file_hash", SEED_BOOK_HASH);

  const { data: book, error } = await admin
    .from("books")
    .insert({
      title: SEED_BOOK_TITLE,
      author: "سىناق ئاپتور",
      status: "published",
      file_hash: SEED_BOOK_HASH,
      format: "TXT",
      language: "ug",
      page_count: SEED_PAGE_COUNT,
      description: "بۇ Playwright سىنىقى ئۈچۈن قوشۇلغان ۋاقىتلىق كىتاب.",
    })
    .select("id")
    .single();
  if (error || !book) throw new Error(`could not seed book: ${error?.message}`);

  const pages = Array.from({ length: SEED_PAGE_COUNT }, (_, index) => {
    const pageNo = index + 1;
    const filler = `${pageNo}-بەتنىڭ مەزمۇنى. ئۇيغۇر تىلىدىكى سىناق جۈملىسى. `.repeat(18);

    // The needle appears three times, deliberately: twice on one page and once
    // on a later one. Stepping between matches has to move within a page as
    // well as across pages, and a single occurrence would let a page-by-page
    // implementation pass.
    if (pageNo === SEED_NEEDLE_PAGE) {
      return {
        book_id: book.id,
        page_no: pageNo,
        content: ` بۇ بەتتە ${SEED_NEEDLE} دېگەن سۆز بار. ${filler} يەنە بىر قېتىم ${SEED_NEEDLE} مۇشۇ بەتتە. `,
      };
    }
    if (pageNo === SEED_NEEDLE_LATER_PAGE) {
      return { book_id: book.id, page_no: pageNo, content: `${filler} كېيىنكى ${SEED_NEEDLE} بۇ يەردە. ` };
    }
    return { book_id: book.id, page_no: pageNo, content: filler };
  });
  const { error: pageError } = await admin.from("book_pages").insert(pages);
  if (pageError) throw new Error(`could not seed pages: ${pageError.message}`);

  mkdirSync(dirname(SEED_PATH), { recursive: true });
  writeFileSync(SEED_PATH, JSON.stringify({ bookId: book.id }), "utf8");
});
