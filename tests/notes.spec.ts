import { expect, test, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
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

  /**
   * Where the misspelled word is on screen.
   *
   * The marks are painted through the CSS Custom Highlight API, so there is no
   * element to locate — the ranges have to be asked for directly. This is also
   * what proves the underline exists at all: if nothing was painted, there is
   * no box to click.
   */
  async function markBox(page: Page, word: string) {
    return page.evaluate((needle) => {
      const highlight = CSS.highlights?.get("bh-spell-error");
      if (!highlight) return null;
      // A Highlight yields AbstractRange; the ones we put in are real Ranges.
      for (const abstract of highlight) {
        const range = abstract as Range;
        if (range.toString() === needle) {
          const box = range.getBoundingClientRect();
          return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
        }
      }
      return null;
    }, word);
  }

  test("underlines a misspelled word in place and corrects it from the popup", async ({
    page,
  }) => {
    const path = await newNote(page);
    await page.getByTestId("note-body").click();
    await page.keyboard.type(`بۇ ${MISSPELLING} دېگەن سۆز خاتا.`);

    await page.getByTestId("spell-toggle").click();
    // The dictionary is 777 KB over the wire and unpacks in the worker.
    await expect(page.getByTestId("spell-summary")).toBeVisible({ timeout: 90_000 });

    // The word is marked in the text itself, not listed in a panel.
    await expect
      .poll(() => markBox(page, MISSPELLING), { timeout: 30_000 })
      .not.toBeNull();
    const box = (await markBox(page, MISSPELLING))!;

    await page.mouse.click(box.x, box.y);
    const popup = page.getByTestId("spell-popup");
    await expect(popup).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("spell-popup-word")).toHaveText(MISSPELLING);
    await expect(page.getByTestId("spell-suggestion").first()).toContainText("ئۇيغۇر", {
      timeout: 30_000,
    });

    // Anchored at the word and clear of the toolbar — the rule that matters on
    // a phone, where the popup used to have nowhere to go.
    const popupBox = (await popup.boundingBox())!;
    const toolbar = (await page.getByTestId("note-toolbar").boundingBox())!;
    expect(popupBox.y, "popup must sit below the toolbar").toBeGreaterThanOrEqual(
      toolbar.y + toolbar.height,
    );
    const viewport = page.viewportSize()!;
    expect(popupBox.y + popupBox.height, "popup must be fully on screen").toBeLessThanOrEqual(
      viewport.height + 1,
    );

    // Choosing a correction replaces that word and nothing else.
    await page.getByTestId("spell-suggestion").first().click();
    await expect(page.getByTestId("note-body")).toContainText("ئۇيغۇر");
    await expect(page.getByTestId("note-body")).not.toContainText(MISSPELLING);
    await expect(popup).toHaveCount(0);

    await deleteNote(page, path);
  });

  test("adding a word to the personal dictionary clears its underline", async ({ page }) => {
    const path = await newNote(page);
    await page.getByTestId("note-body").click();
    await page.keyboard.type(`بۇ ${MISSPELLING} دېگەن سۆز.`);

    await page.getByTestId("spell-toggle").click();
    await expect(page.getByTestId("spell-summary")).toBeVisible({ timeout: 90_000 });
    await expect.poll(() => markBox(page, MISSPELLING), { timeout: 30_000 }).not.toBeNull();

    const box = (await markBox(page, MISSPELLING))!;
    await page.mouse.click(box.x, box.y);
    await expect(page.getByTestId("spell-popup")).toBeVisible({ timeout: 30_000 });

    await page.getByTestId("spell-popup-add").click();
    // The mark goes immediately, and the word itself stays in the text.
    await expect.poll(() => markBox(page, MISSPELLING), { timeout: 15_000 }).toBeNull();
    await expect(page.getByTestId("note-body")).toContainText(MISSPELLING);

    await deleteNote(page, path);
  });
});

/**
 * The bug this exists for: «يېڭى خاتىرە» answered 500 in production while every
 * local test passed. The tests were wrong, not lucky — they all ran against an
 * account the suite had already used, and they all ran against `next dev`.
 *
 * So this one signs in as an account created seconds ago that has never held a
 * note, and walks the whole first-run path: press the button, land in the
 * editor, type, reload, and find the writing still there.
 */
test.describe("a brand-new account's first note", () => {
  // Its own session, not the shared signed-in state every other spec reuses.
  test.use({ storageState: { cookies: [], origins: [] } });

  const admin = () =>
    createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false } },
    );

  test("creates, opens and keeps a note", async ({ page }, testInfo) => {
    const email = `bh-e2e-fresh-${testInfo.project.name}-${Date.now()}@mailinator.com`;
    const password = "bh-e2e-fresh-4471";
    const supabase = admin();

    const { data: created, error } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (error || !created.user) throw new Error(`could not create a fresh user: ${error?.message}`);

    try {
      await page.goto("/login");
      await page.locator('input[name="email"]').fill(email);
      await page.locator('input[name="password"]').fill(password);
      await page.getByRole("button", { name: "كىرىش" }).click();
      await expect(page.getByRole("button", { name: /چىقىش/ })).toBeVisible({ timeout: 20_000 });

      // An empty notebook, which is the state the bug happened in.
      await page.goto("/notes");
      await expect(page.getByTestId("notes-empty")).toBeVisible({ timeout: 20_000 });

      await page.getByTestId("new-note").click();

      // No server error screen — the exact failure being guarded against.
      await expect(page.locator("body")).not.toContainText("A server error occurred");
      await expect(page.getByTestId("notes-error-retry")).toHaveCount(0);

      await expect(page).toHaveURL(/\/notes\/\d+$/, { timeout: 20_000 });
      const editor = page.getByTestId("note-body");
      await expect(editor).toBeVisible();

      // And it saves, which needs the sanitizer the same module used to break on.
      await editor.click();
      await page.keyboard.type("تۇنجى خاتىرەم.");
      await expect(page.getByTestId("save-state")).toHaveText("ساقلاندى", { timeout: 20_000 });

      const path = new URL(page.url()).pathname;
      await page.reload();
      await expect(page.getByTestId("note-body")).toContainText("تۇنجى خاتىرەم.");

      // It is really in the database, not just in the tab.
      const { count } = await supabase
        .from("note_documents")
        .select("id", { count: "exact", head: true })
        .eq("user_id", created.user.id);
      expect(count).toBe(1);

      // Nobody else can open it, however new it is.
      const other = await page.context().browser()!.newContext({ storageState: READER_STATE_PATH });
      const otherPage = await other.newPage();
      const response = await otherPage.goto(path);
      expect(response?.status()).toBe(404);
      await expect(otherPage.locator("body")).not.toContainText("تۇنجى خاتىرەم.");
      await other.close();
    } finally {
      await supabase.auth.admin.deleteUser(created.user.id);
    }
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
