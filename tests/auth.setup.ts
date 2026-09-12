import { test as setup, expect, type Locator, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  ACCOUNTS_PATH,
  READER_STATE_PATH,
  RUN_ID,
  SEED_BOOK_HASH,
  SEED_BOOK_TITLE,
  SEED_FRAGMENT_DECOYS,
  SEED_FRAGMENT_PAGE,
  SEED_FRAGMENT_STEM,
  SEED_MD_BOOK_HASH,
  SEED_MD_BOOK_TITLE,
  SEED_MD_NEEDLE_PAGE,
  SEED_MD_PAGE_COUNT,
  SEED_MD_PATH,
  SEED_NEEDLE,
  SEED_NEEDLE_PAGE,
  SEED_NEEDLE_LATER_PAGE,
  SEED_PAGE_COUNT,
  SEED_PATH,
  STAFF_STATE_PATH,
  freshPassword,
  hasStaffTestEnv,
  loadEnvLocal,
  testEmail,
} from "./env";
import { sweepTestAccounts } from "./fixtures/accounts";

loadEnvLocal();

type TestAccount = { email: string; password: string };

/**
 * Record one of the run's accounts in ACCOUNTS_PATH, beside the saved
 * storage states — the only place a generated password is ever written, and
 * a git-ignored one. A file left by an earlier run is replaced, not merged.
 */
function recordAccount(role: "staff" | "reader", account: TestAccount): void {
  let record: { runId?: string; staff?: TestAccount; reader?: TestAccount } = {};
  try {
    record = JSON.parse(readFileSync(ACCOUNTS_PATH, "utf8")) as typeof record;
  } catch {
    // Nothing recorded yet.
  }
  if (record.runId !== RUN_ID) record = {};
  mkdirSync(dirname(ACCOUNTS_PATH), { recursive: true });
  writeFileSync(ACCOUNTS_PATH, JSON.stringify({ ...record, runId: RUN_ID, [role]: account }), "utf8");
}

/**
 * Sign in, and try once more if the session did not take.
 *
 * Signing in is the one thing in this suite that depends on something outside
 * it: Supabase Auth applies its own rate limit centrally, per address, across
 * every run from this machine. Running the suite repeatedly while developing
 * is enough to meet it, and when it fires the whole run collapses at the setup
 * project with an error that says nothing about the real cause.
 *
 * A single retry after a pause is not papering over a product bug — the app's
 * own limiter is still exercised, deliberately and by name, in
 * discovery.spec.ts. This is about the harness not lying about what failed.
 */
async function signIn(
  page: Page,
  email: string,
  password: string,
  proof: Locator,
): Promise<void> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await page.goto("/login");
    await page.locator('input[name="email"]').fill(email);
    await page.locator('input[name="password"]').fill(password);
    await page.getByRole("button", { name: "كىرىش" }).click();

    try {
      await expect(proof).toBeVisible({ timeout: 20_000 });
      return;
    } catch (failure) {
      const message = (await page.locator('[role="alert"]').first().textContent()) ?? "";
      if (attempt === 1) {
        throw new Error(
          `could not sign in as ${email}${message ? ` — the page said: ${message.trim()}` : ""}`,
          { cause: failure },
        );
      }
      // Long enough for a short central window to roll over.
      await page.waitForTimeout(30_000);
    }
  }
}

/**
 * Start clean. A run stopped before its teardown — Ctrl+C, a crash, a closed
 * terminal — leaves its accounts behind, and an uploader account nobody is
 * watching must not outlive the next run. This is also what removed the
 * accounts of the older suite, which used fixed addresses on a public inbox.
 */
setup("remove the test accounts an earlier run left behind", async () => {
  setup.skip(!hasStaffTestEnv(), "Supabase env not configured");

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  const removed = await sweepTestAccounts(admin);
  // The count is all that is said about them.
  console.log(`removed ${removed} leftover test account(s)`);
});

/**
 * Provision a disposable `uploader` account and save its signed-in state, so
 * the admin specs exercise the real guard rather than a mock. Its address is
 * this run's alone and its password is drawn here, now — neither is in any
 * file the repository tracks. Removed again by auth.teardown.ts.
 */
setup("create and sign in a staff account", async ({ page }) => {
  setup.skip(!hasStaffTestEnv(), "Supabase env not configured");

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  const email = testEmail("uploader");
  const password = freshPassword();
  const { data: created, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error || !created.user) throw new Error(`could not create test user: ${error?.message}`);
  const { error: roleError } = await admin
    .from("profiles")
    .update({ role: "uploader", display_name: "E2E سىناق" })
    .eq("id", created.user.id);
  if (roleError) throw new Error(`could not set uploader role: ${roleError.message}`);

  // The admin link only renders for a staff session, so it proves the role took.
  await signIn(page, email, password, page.getByRole("link", { name: /باشقۇرۇش/ }));

  mkdirSync(dirname(STAFF_STATE_PATH), { recursive: true });
  await page.context().storageState({ path: STAFF_STATE_PATH });
  recordAccount("staff", { email, password });
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

    // The fragment trap. Searching «<needle> چا» must reach INTO «چاقىرىش» and
    // «چاقىر» where the needle precedes them, and must leave the standalone
    // «چالايلى» and «چاقىر» alone. Both shapes are on this one page so a single
    // query proves both halves of the rule.
    if (pageNo === SEED_FRAGMENT_PAGE) {
      return {
        book_id: book.id,
        page_no: pageNo,
        content:
          ` ساھابىلار ${SEED_FRAGMENT_STEM} چاقىرىش توغرۇلۇق سۆزلەشتى. ` +
          ` بەزىلەر: داڭ ${SEED_FRAGMENT_DECOYS[0]} دېدى، بۇرغا ${SEED_FRAGMENT_DECOYS[0]} دېگەنمۇ بار. ` +
          ` ھەي بىلال، ${SEED_FRAGMENT_STEM} ${SEED_FRAGMENT_DECOYS[1]}! دېدى. ` +
          ` ئاندىن ${SEED_FRAGMENT_DECOYS[1]} دېگەن سۆز يالغۇز كەلدى. ${filler}`,
      };
    }
    return { book_id: book.id, page_no: pageNo, content: filler };
  });
  const { error: pageError } = await admin.from("book_pages").insert(pages);
  if (pageError) throw new Error(`could not seed pages: ${pageError.message}`);

  mkdirSync(dirname(SEED_PATH), { recursive: true });
  writeFileSync(SEED_PATH, JSON.stringify({ bookId: book.id }), "utf8");
});

/**
 * A second seeded book, stored as MARKDOWN.
 *
 * Two thirds of the real library is Markdown, and that reader path drew no
 * <mark> at all: following a search result opened the right page and left the
 * phrase to be found by eye. Nothing caught it because every fixture until now
 * was plain text.
 */
setup("seed a published Markdown book", async () => {
  setup.skip(!hasStaffTestEnv(), "Supabase env not configured");

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  await admin.from("books").delete().eq("file_hash", SEED_MD_BOOK_HASH);

  const { data: book, error } = await admin
    .from("books")
    .insert({
      title: SEED_MD_BOOK_TITLE,
      author: "سىناق ئاپتور",
      status: "published",
      file_hash: SEED_MD_BOOK_HASH,
      format: "DOCX",
      content_format: "markdown",
      language: "ug",
      page_count: SEED_MD_PAGE_COUNT,
      description: "Playwright سىنىقى ئۈچۈن ماركداۋن فورماتىدىكى ۋاقىتلىق كىتاب.",
    })
    .select("id")
    .single();
  if (error || !book) throw new Error(`could not seed markdown book: ${error?.message}`);

  const pages = Array.from({ length: SEED_MD_PAGE_COUNT }, (_, index) => {
    const pageNo = index + 1;
    const filler = `${pageNo}-بەتنىڭ ماركداۋن مەزمۇنى. ئۇيغۇرچە سىناق جۈملىسى.\n\n`.repeat(10);

    if (pageNo === SEED_MD_NEEDLE_PAGE) {
      return {
        book_id: book.id,
        page_no: pageNo,
        // Headings, bold and a list — real Markdown, and the needle appears
        // both in plain prose and split across inline markup, which is the case
        // a naive per-text-node highlighter would miss.
        content:
          `## ماركداۋن ماۋزۇسى\n\n` +
          `بۇ بەتتە **${SEED_NEEDLE}** دېگەن سۆز توم خەتتە بار.\n\n` +
          `- تىزىملىكتىكى ${SEED_NEEDLE} يەنە بىر قېتىم\n` +
          `- باشقا بىر قۇر\n\n` +
          `${filler}`,
      };
    }
    return { book_id: book.id, page_no: pageNo, content: filler };
  });
  const { error: pageError } = await admin.from("book_pages").insert(pages);
  if (pageError) throw new Error(`could not seed markdown pages: ${pageError.message}`);

  mkdirSync(dirname(SEED_MD_PATH), { recursive: true });
  writeFileSync(SEED_MD_PATH, JSON.stringify({ bookId: book.id }), "utf8");
});

/**
 * A second, ordinary reader account. The notebook is per-user, so proving that
 * needs two real sessions — one writes a note, the other must be refused.
 */
setup("create and sign in a plain reader account", async ({ page }) => {
  setup.skip(!hasStaffTestEnv(), "Supabase env not configured");

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  const email = testEmail("reader");
  const password = freshPassword();
  const { data: created, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error || !created.user) throw new Error(`could not create reader user: ${error?.message}`);

  // No admin link for this one — the sign-out control is what proves a session.
  await signIn(page, email, password, page.getByRole("button", { name: /چىقىش/ }));

  mkdirSync(dirname(READER_STATE_PATH), { recursive: true });
  await page.context().storageState({ path: READER_STATE_PATH });
  recordAccount("reader", { email, password });
});
