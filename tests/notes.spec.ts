import { expect, test, type Page } from "@playwright/test";
import { READER_STATE_PATH, hasStaffTestEnv, loadEnvLocal } from "./env";

loadEnvLocal();

test.skip(!hasStaffTestEnv(), "Supabase env not configured");

/** A word the shipped dictionary does not contain, for the spellcheck panel. */
const MISSPELLING = "ئۇيغور";
const BODY_TEXT = "بۇ مېنىڭ سىناق خاتىرەم.";

async function newNote(page: Page): Promise<string> {
  await page.goto("/notes");
  await page.getByTestId("new-note").click();
  await expect(page).toHaveURL(/\/notes\/\d+$/, { timeout: 20_000 });
  await expect(page.getByTestId("note-body")).toBeVisible();
  return new URL(page.url()).pathname;
}

async function deleteNote(page: Page, path: string) {
  const id = path.split("/").pop();
  await page.goto("/notes");
  page.once("dialog", (dialog) => void dialog.accept());
  await page.locator(`[data-testid="note-list"] li`).filter({
    has: page.locator(`a[href="/notes/${id}"]`),
  }).getByTestId("delete-note").click();
  await expect(page.locator(`a[href="/notes/${id}"]`)).toHaveCount(0, { timeout: 20_000 });
}

test.describe("notebook", () => {
  test("writes, formats and saves, and the text survives a reload", async ({ page }) => {
    const path = await newNote(page);

    await page.getByTestId("note-title").fill("سىناق خاتىرىسى");
    const body = page.getByTestId("note-body");
    await body.click();
    await page.keyboard.type(BODY_TEXT);

    // Select what was typed, then bold it through the toolbar.
    await page.keyboard.press("Control+A");
    await page.getByTestId("format-bold").click();

    await expect(page.getByTestId("save-state")).toHaveText("ساقلاندى", { timeout: 20_000 });

    await page.reload();
    await expect(page.getByTestId("note-body")).toContainText(BODY_TEXT);
    // The bold has to have reached the database, not just the DOM.
    await expect(page.locator('[data-testid="note-body"] b, [data-testid="note-body"] strong'))
      .toHaveCount(1);
    await expect(page.getByTestId("note-title")).toHaveValue("سىناق خاتىرىسى");

    // The list shows it, with the title it was given.
    await page.goto("/notes");
    await expect(page.getByTestId("note-list")).toContainText("سىناق خاتىرىسى");

    await deleteNote(page, path);
  });

  test("a heading survives the round trip too", async ({ page }) => {
    const path = await newNote(page);
    await page.getByTestId("note-body").click();
    await page.keyboard.type("ماۋزۇ قۇرى");
    await page.keyboard.press("Control+A");
    await page.getByTestId("format-heading").click();
    await expect(page.getByTestId("save-state")).toHaveText("ساقلاندى", { timeout: 20_000 });

    await page.reload();
    await expect(page.locator('[data-testid="note-body"] h2')).toContainText("ماۋزۇ قۇرى");

    await deleteNote(page, path);
  });

  test("the toolbar stays put and nothing scrolls sideways", async ({ page }, testInfo) => {
    const path = await newNote(page);
    await page.getByTestId("note-body").click();
    // Enough text to make the page scroll at every viewport height.
    await page.keyboard.type(`${BODY_TEXT}\n`.repeat(40));

    const width = testInfo.project.use.viewport!.width;
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, `no horizontal scroll at ${width}px`).toBeLessThanOrEqual(1);

    // Scroll down, then back up: the mobile rule is that every control is still
    // there and tappable afterwards.
    await page.mouse.wheel(0, 4000);
    await page.waitForTimeout(200);
    await expect(page.getByTestId("note-toolbar")).toBeInViewport();
    await expect(page.getByTestId("format-bold")).toBeVisible();

    await page.mouse.wheel(0, -6000);
    await page.waitForTimeout(200);
    for (const id of ["notes-back", "note-title", "format-bold", "toolbar-more", "spell-toggle"]) {
      await expect(page.getByTestId(id), id).toBeVisible();
    }
    // Still clickable, not merely painted.
    await page.getByTestId("toolbar-more").click();
    await expect(page.getByTestId("toolbar-overflow")).toBeVisible();

    await deleteNote(page, path);
  });

  test("exports a Word file", async ({ page }) => {
    const path = await newNote(page);
    await page.getByTestId("note-body").click();
    await page.keyboard.type(BODY_TEXT);
    await page.getByTestId("note-title").fill("چىقىرىش سىنىقى");

    await page.getByTestId("toolbar-more").click();
    const download = page.waitForEvent("download", { timeout: 30_000 });
    await page.getByTestId("export-docx").click();
    const file = await download;

    expect(file.suggestedFilename()).toMatch(/\.docx$/);
    const stream = await file.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);
    const bytes = Buffer.concat(chunks);
    expect(bytes.length).toBeGreaterThan(1000);
    // Every .docx is a zip; "PK" is the signature Word looks for.
    expect(bytes.subarray(0, 2).toString("latin1")).toBe("PK");

    await deleteNote(page, path);
  });

  test("the spellchecker loads and flags a misspelled word", async ({ page }) => {
    const path = await newNote(page);
    await page.getByTestId("note-body").click();
    await page.keyboard.type(`بۇ ${MISSPELLING} دېگەن سۆز خاتا.`);

    await page.getByTestId("spell-toggle").click();
    await expect(page.getByTestId("spell-panel")).toBeVisible();

    // The dictionary is 424 KB over the wire and unpacks in the worker.
    const flagged = page.getByTestId("spell-word").filter({ hasText: MISSPELLING });
    await expect(flagged).toBeVisible({ timeout: 60_000 });

    await flagged.click();
    await expect(page.getByTestId("spell-suggestions")).toContainText("ئۇيغۇر", {
      timeout: 30_000,
    });

    await deleteNote(page, path);
  });
});

test.describe("who may read a note", () => {
  test("an anonymous visitor is sent to sign in", async ({ browser }) => {
    const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const page = await context.newPage();
    await page.goto("/notes");
    await expect(page).toHaveURL(/\/login/);
    await context.close();
  });

  test("the notebook link is hidden until you have an account", async ({ browser }) => {
    const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const page = await context.newPage();
    await page.goto("/");
    await expect(page.getByTestId("notes-link")).toHaveCount(0);
    await expect(page.getByTestId("notes-sidebar-link")).toHaveCount(0);
    await context.close();
  });

  test("one signed-in user cannot open another's note", async ({ page, browser }) => {
    const path = await newNote(page);
    await page.getByTestId("note-body").click();
    await page.keyboard.type("مەخپىي مەزمۇن");
    await expect(page.getByTestId("save-state")).toHaveText("ساقلاندى", { timeout: 20_000 });

    // A different real account, not a logged-out one: this is the case RLS is
    // actually there for.
    const other = await browser.newContext({ storageState: READER_STATE_PATH });
    const otherPage = await other.newPage();
    const response = await otherPage.goto(path);
    expect(response?.status()).toBe(404);
    await expect(otherPage.locator("body")).not.toContainText("مەخپىي مەزمۇن");
    // And their own notebook is empty — they see none of it in the list.
    await otherPage.goto("/notes");
    await expect(otherPage.getByTestId("notes-empty")).toBeVisible();
    await other.close();

    await deleteNote(page, path);
  });
});
