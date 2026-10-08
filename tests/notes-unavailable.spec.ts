import { randomInt } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { freshPassword } from "./env";
import { assertNoHorizontalOverflow, assertTappable, signIn } from "./fixtures/auth-pages";
import { SupabaseMock } from "./fixtures/supabase-mock";

/**
 * The notebook when the database does not answer — at 375×667, 390×844 and
 * 1280×800.
 *
 * On 2026-10-07 a note had just been created at /notes/4143, and the very
 * next /notes told its writer «تېخى خاتىرە يوق»: lib/notes/data.ts turned a
 * failed read into an empty list. Its loaders now throw like every other
 * loader (PROMPT-40), so the writer sees app/notes/error.tsx — the notebook
 * did not open, nothing is lost, try again — and a failed read of one note is
 * that page too, never a 404 for a note that exists.
 *
 * Against the FAKE Supabase on :3300 (tests/fixtures/supabase-mock.ts), never
 * the real project: the notes are read on the server, where `page.route`
 * cannot reach.
 */

const mock = new SupabaseMock();

const WRITER = "bh-e2e-writer@example.com";
const ERROR_HEADING = "خاتىرە دەپتىرى ئېچىلمىدى";

/** The writer's one note, with every column the list and the editor select. */
const NOTE = {
  id: 4143,
  title: "سىناق خاتىرىسى",
  content_html: "<p>بۇ خاتىرىنىڭ مەزمۇنى.</p>",
  content_text: "بۇ خاتىرىنىڭ مەزمۇنى.",
  content_length: 21,
  updated_at: "2026-10-07T09:00:00.000Z",
};

test.beforeAll(async () => {
  await mock.start();
});

test.afterAll(async () => {
  await mock.stop();
});

test.beforeEach(async ({ page }) => {
  await mock.reset();
  // Its own address, so the sign-in counter never decides these tests.
  await page.setExtraHTTPHeaders({ "x-forwarded-for": `198.19.${randomInt(1, 255)}.${randomInt(1, 255)}` });
  const password = freshPassword();
  await mock.addUser(WRITER, password);
  // Signing in is only the way in here, so it gets one more go, as in
  // auth.setup.ts: once in about forty runs the form was left filled in on
  // /login with no answer shown, and that must not read as a notebook fault.
  const home = /localhost:3300\/$/;
  await expect(async () => {
    if (!home.test(page.url())) await signIn(page, WRITER, password);
    await expect(page).toHaveURL(home, { timeout: 10_000 });
  }).toPass({ intervals: [1_000], timeout: 30_000 });
  mock.answerTable("note_documents", [NOTE]);
});

/** The notebook's own error page, in Uyghur, right to left, every control in reach. */
async function expectNotebookError(page: Page) {
  const retry = page.getByTestId("notes-error-retry");
  // postgrest-js asks a 503 three more times (1 s, 2 s, 4 s) before giving up.
  await expect(retry).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("heading", { name: ERROR_HEADING })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.dir)).toBe("rtl");
  await assertNoHorizontalOverflow(page);
  await assertTappable(page, retry, "the notebook error's «قايتا سىناش»");
  await assertTappable(page, page.getByTestId("notes-error-back"), "the notebook error's «خاتىرىلەر تىزىملىكى»");
}

test("a list that did not load is the error page, never an empty notebook — and «قايتا سىناش» brings it back", async ({
  page,
}) => {
  mock.failTable("note_documents");
  await page.goto("/notes");

  await expectNotebookError(page);
  await expect(page.getByTestId("notes-empty")).toHaveCount(0);
  await expect(page.getByTestId("note-list")).toHaveCount(0);

  // The database answers again; the same button asks the server again.
  mock.clearTable("note_documents");
  await page.getByTestId("notes-error-retry").click();
  await expect(page.getByTestId("note-link")).toContainText(NOTE.title, { timeout: 20_000 });
  await expect(page.getByTestId("notes-error-retry")).toHaveCount(0);
  await expect(page.getByTestId("notes-empty")).toHaveCount(0);
});

test("the writer's own note that did not load is the error page, not a 404 — and comes back on retry", async ({
  page,
}) => {
  mock.failTable("note_documents");
  const response = await page.goto(`/notes/${NOTE.id}`);

  await expectNotebookError(page);
  expect(response?.status(), "a note that exists must not be answered as missing").not.toBe(404);

  mock.clearTable("note_documents");
  await page.getByTestId("notes-error-retry").click();
  await expect(page.getByTestId("note-title")).toHaveValue(NOTE.title, { timeout: 20_000 });
  await expect(page.getByTestId("notes-error-retry")).toHaveCount(0);
});

test("what really is empty, missing or signed out is answered as before", async ({ page, browser }) => {
  // No notes at all: the empty notebook, which is the truth this time.
  mock.answerTable("note_documents", []);
  await page.goto("/notes");
  await expect(page.getByTestId("notes-empty")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("notes-error-retry")).toHaveCount(0);

  // A note that is not theirs — or not there — is still a real 404.
  const missing = await page.goto(`/notes/${NOTE.id}`);
  expect(missing?.status()).toBe(404);
  await expect(page.getByTestId("notes-error-retry")).toHaveCount(0);

  // And somebody who is not signed in is sent to sign in.
  const stranger = await browser.newContext();
  const visitor = await stranger.newPage();
  await visitor.goto("/notes");
  await expect(visitor).toHaveURL(/\/login/, { timeout: 15_000 });
  await stranger.close();
});
