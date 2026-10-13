import { expect, test, type Locator, type Page } from "@playwright/test";
import { freshPassword, hasStaffTestEnv, loadEnvLocal, testEmail } from "./env";
import { adminClient, dropNote, newNote, openFind, signedInUserId } from "./fixtures/notes";
import { scrollPage, scrollToTop, wheelWorks } from "./fixtures/scroll";

loadEnvLocal();

test.skip(!hasStaffTestEnv(), "Supabase env not configured");

/**
 * «ئىلگىرىكى نۇسخىلار» (PROMPT-46): earlier versions of a note, kept in this
 * browser's IndexedDB and nowhere else. Each test reads the store itself to
 * prove what is there — and never creates it: a database made by a test,
 * without the site's stores in it, would leave the history unavailable.
 *
 * The service worker is blocked because page.route cannot see requests from a
 * page it controls, and one test holds this page's saves back. Every text is
 * invented.
 */
test.use({ serviceWorkers: "block" });

const SAVED = "ساقلاندى";
const OFFLINE = "ئۇلىنىش يوق — بۇ ئۈسكۈنىدە ساقلاندى";
const RESTORED = "ئەسلىگە قايتۇرۇلدى. ئالدىنقى ھالىتى «ئىلگىرىكى نۇسخىلار» دا ساقلاندى.";
const UNAVAILABLE = "بۇ تور كۆرگۈچتە ئىلگىرىكى نۇسخىلارنى ساقلىغىلى بولمايدۇ (مەسىلەن، يوشۇرۇن كۆزنەكتە).";

type Stored = { userId: string; noteId: number; reason: string; title: string; html: string; at: number };

/** Every version in this browser's store; empty when there is no store at all. */
function storedVersions(page: Page): Promise<Stored[]> {
  return page.evaluate(
    () =>
      new Promise<Stored[]>((resolve, reject) => {
        const request = indexedDB.open("bh-notebook");
        // It did not exist: abort, so the test does not create it.
        request.onupgradeneeded = () => request.transaction?.abort();
        request.onerror = () => resolve([]);
        request.onsuccess = () => {
          const database = request.result;
          if (!database.objectStoreNames.contains("versions")) {
            database.close();
            resolve([]);
            return;
          }
          const all = database.transaction("versions").objectStore("versions").getAll();
          all.onsuccess = () => {
            database.close();
            resolve(all.result as Stored[]);
          };
          all.onerror = () => {
            database.close();
            reject(all.error);
          };
        };
      }),
  );
}

/** `count` older versions of the note, written straight into the store the editor made. */
async function seedVersions(page: Page, userId: string, noteId: number, count: number) {
  await page.evaluate(
    ({ userId, noteId, count }) =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open("bh-notebook");
        request.onupgradeneeded = () => request.transaction?.abort();
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const database = request.result;
          const transaction = database.transaction("versions", "readwrite");
          const store = transaction.objectStore("versions");
          const first = Date.now() - (count + 1) * 60 * 60_000;
          for (let n = 0; n < count; n += 1) {
            store.add({
              userId,
              noteId,
              at: first + n * 60 * 60_000,
              title: "كونا نۇسخا",
              html: `<div>كونا نۇسخا ${n + 1}</div>`,
              chars: 12,
              reason: n % 2 ? "auto" : "before-ai",
            });
          }
          transaction.oncomplete = () => {
            database.close();
            resolve();
          };
          transaction.onerror = () => reject(transaction.error);
        };
      }),
    { userId, noteId, count },
  );
}

function noteIdOf(path: string): number {
  return Number(path.split("/").pop());
}

function bodyHtml(page: Page): Promise<string> {
  return page.getByTestId("note-body").evaluate((editor) => editor.innerHTML);
}

/** The caret at the very end of the note. */
async function caretAtEnd(page: Page) {
  await page.getByTestId("note-body").evaluate((editor) => {
    (editor as HTMLElement).focus();
    const range = document.createRange();
    range.selectNodeContents(editor);
    range.collapse(false);
    const selection = getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
  });
}

/** Select the text node holding `text`, so a Backspace deletes it. */
async function selectText(page: Page, text: string) {
  await page.getByTestId("note-body").evaluate((editor, wanted) => {
    (editor as HTMLElement).focus();
    const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.textContent?.includes(wanted)) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      const selection = getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
      return;
    }
    throw new Error("text not found");
  }, text);
}

/** «ئىلگىرىكى نۇسخىلار» lives under «باشقا ئىقتىدارلار» at every width. */
async function openHistory(page: Page) {
  await page.getByTestId("toolbar-more").click();
  await page.getByTestId("history-open").click();
  await expect(page.getByTestId("history-panel")).toBeVisible();
  await expect(page.getByTestId("history-loading")).toHaveCount(0);
}

/** Visible, a 44 px target, and the thing under its centre is itself. */
async function expectTappable(control: Locator, name: string) {
  await expect(control, name).toBeInViewport({ ratio: 1 });
  const box = (await control.boundingBox())!;
  expect(box.height, `${name} is a 44 px target`).toBeGreaterThanOrEqual(44);
  const onTop = await control.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return hit !== null && element.contains(hit);
  });
  expect(onTop, `${name} is not covered`).toBe(true);
}

function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

/** Abort every Server Action this page sends — its saves — until the routes are dropped. */
async function blockSaves(page: Page) {
  await page.route("**/*", async (route) => {
    const request = route.request();
    if (request.method() === "POST" && request.headers()["next-action"]) {
      await route.abort("failed");
      return;
    }
    await route.fallback();
  });
}

test.describe("putting an earlier version back", () => {
  test("a deleted paragraph comes back, is saved, and the note as it was is kept too", async ({ page }) => {
    const PARAGRAPH = "بۇ ئابزاس ئۆچۈرۈلۈپ ئاندىن قايتىپ كېلىدۇ";
    const path = await newNote(page, { html: "<div>بىرىنچى قۇر</div>" });
    try {
      await caretAtEnd(page);
      await page.keyboard.press("Enter");
      await page.keyboard.type(PARAGRAPH);
      await expect(page.getByTestId("save-state")).toHaveText(SAVED, { timeout: 20_000 });
      // The first confirmed save leaves an automatic version.
      await expect
        .poll(async () => (await storedVersions(page)).some((v) => v.reason === "auto" && v.html.includes(PARAGRAPH)))
        .toBe(true);

      await selectText(page, PARAGRAPH);
      await page.keyboard.press("Backspace");
      await expect(page.getByTestId("note-body")).not.toContainText(PARAGRAPH);
      await expect(page.getByTestId("save-state")).toHaveText(SAVED, { timeout: 20_000 });

      await openHistory(page);
      await expect(page.getByTestId("history-device-only")).toHaveText(
        "بۇ نۇسخىلار پەقەت مۇشۇ ئۈسكۈنىدە ساقلىنىدۇ.",
      );
      const auto = page.locator('[data-testid="history-row"][data-reason="auto"]').first();
      await expect(auto.getByTestId("history-row-reason")).toContainText("ئاپتوماتىك");
      await auto.click();
      await expect(page.getByTestId("history-preview")).toContainText(PARAGRAPH);
      await page.getByTestId("history-restore").click();

      await expect(page.getByTestId("history-panel")).toHaveCount(0);
      await expect(page.getByTestId("note-body")).toContainText(PARAGRAPH);
      await expect(page.getByTestId("note-notice")).toHaveText(RESTORED);
      await expect(page.getByTestId("save-state")).toHaveText(SAVED, { timeout: 20_000 });

      // The note as it was before the restore is the newest version now.
      await openHistory(page);
      const newest = page.getByTestId("history-row").first();
      await expect(newest).toHaveAttribute("data-reason", "before-restore");
      await expect(newest.getByTestId("history-row-reason")).toContainText("ئەسلىگە قايتۇرۇشتىن بۇرۇن");
      await newest.click();
      await expect(page.getByTestId("history-preview")).toContainText("بىرىنچى قۇر");
      await expect(page.getByTestId("history-preview")).not.toContainText(PARAGRAPH);
      await page.getByTestId("history-close").click();

      // And the server has the restored note.
      await page.reload();
      await expect(page.getByTestId("note-body")).toContainText(PARAGRAPH);
    } finally {
      await dropNote(path);
    }
  });

  test("a replace-all leaves «ئالماشتۇرۇشتىن بۇرۇن», which puts the note back exactly", async ({ page }) => {
    const html =
      "<h2>ئالما باغچىسى</h2><div>بۇ يىل ئالما كۆپ.</div><blockquote>ئالما دەرىخى ئېگىز.</blockquote>" +
      "<ul><li>ئالما</li><li>نەشپۈت ۋە ئالما</li></ul>";
    const path = await newNote(page, { html });
    try {
      const before = await bodyHtml(page);
      await openFind(page);
      await page.getByTestId("find-input").fill("ئالما");
      await page.getByTestId("find-toggle-replace").click();
      await page.getByTestId("replace-input").fill("ئۆرۈك");
      await page.getByTestId("replace-all").click();
      await expect.poll(() => bodyHtml(page)).toBe(before.split("ئالما").join("ئۆرۈك"));
      await expect(page.getByTestId("save-state")).toHaveText(SAVED, { timeout: 20_000 });
      await page.getByTestId("find-close").click();

      await openHistory(page);
      const row = page.locator('[data-testid="history-row"][data-reason="before-replace-all"]');
      await expect(row).toHaveCount(1);
      await expect(row.getByTestId("history-row-reason")).toContainText("ئالماشتۇرۇشتىن بۇرۇن");
      await row.click();
      await expect(page.getByTestId("history-preview")).toContainText("ئالما باغچىسى");
      await page.getByTestId("history-restore").click();

      expect(await bodyHtml(page)).toBe(before);
      await expect(page.getByTestId("save-state")).toHaveText(SAVED, { timeout: 20_000 });
      await page.reload();
      await expect(page.getByTestId("note-body")).toContainText("ئالما باغچىسى");
      await expect(page.getByTestId("note-body")).not.toContainText("ئۆرۈك");
    } finally {
      await dropNote(path);
    }
  });
});

test("with IndexedDB refused, the note still saves and the panel says why it is empty", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "indexedDB", {
      configurable: true,
      get() {
        throw new DOMException("The user denied permission to access the database.", "SecurityError");
      },
    });
  });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));

  const path = await newNote(page);
  try {
    await page.getByTestId("note-body").click();
    await page.keyboard.type("ساقلىنىدىغان جۈملە");
    await expect(page.getByTestId("save-state")).toHaveText(SAVED, { timeout: 20_000 });

    await openHistory(page);
    await expect(page.getByTestId("history-unavailable")).toHaveText(UNAVAILABLE);
    await page.getByTestId("history-close").click();

    await page.reload();
    await expect(page.getByTestId("note-body")).toContainText("ساقلىنىدىغان جۈملە");
    expect(errors).toEqual([]);
  } finally {
    await dropNote(path);
  }
});

test("signing out empties the history and leaves unsaved writing alone", async ({ browser }, testInfo) => {
  // Signing out ends every session of the account, so this one is its own,
  // made for this test and removed again (the bh-e2e- sweep catches it too).
  const admin = adminClient();
  const email = testEmail(`history-${testInfo.project.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`);
  const password = freshPassword();
  const { data: created, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !created.user) throw new Error(`could not create a test account: ${error?.message}`);

  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const page = await context.newPage();
  const signIn = async () => {
    await page.goto("/login");
    await page.locator('input[name="email"]').fill(email);
    await page.locator('input[name="password"]').fill(password);
    await page.getByRole("button", { name: "كىرىش" }).click();
    await expect(page.getByRole("button", { name: "ھېساباتتىن چىقىش" })).toBeVisible({ timeout: 20_000 });
  };
  try {
    await signIn();
    const path = await newNote(page, { html: "<div>ساقلانغان قۇر</div>" });
    const userId = await signedInUserId(page);
    const draftKey = `bh-note-draft-v2:${userId}:${noteIdOf(path)}`;
    await expect.poll(async () => (await storedVersions(page)).length).toBeGreaterThan(0);

    // Writing that never reached the server: its copy is on this device only.
    await blockSaves(page);
    await caretAtEnd(page);
    await page.keyboard.type(" ساقلانمىغان سۆز");
    await expect(page.getByTestId("save-state")).toHaveText(OFFLINE, { timeout: 20_000 });
    await page.getByTestId("notes-back").click();
    await expect(page).toHaveURL(/\/notes$/);
    await page.unrouteAll({ behavior: "ignoreErrors" });
    const draft = () => page.evaluate((key) => localStorage.getItem(key), draftKey);
    expect(await draft()).toContain("ساقلانمىغان سۆز");

    await page.getByRole("button", { name: "ھېساباتتىن چىقىش" }).click();
    await expect(page.getByTestId("login-link")).toBeVisible({ timeout: 20_000 });
    expect(await storedVersions(page)).toEqual([]);

    await signIn();
    expect(await storedVersions(page)).toEqual([]);
    expect(await draft()).toContain("ساقلانمىغان سۆز");

    // And the unsaved writing is still there to come back.
    await page.goto(path);
    await expect(page.getByTestId("note-body")).toContainText("ساقلانمىغان سۆز");
    await expect(page.getByTestId("save-state")).toHaveText(SAVED, { timeout: 20_000 });
  } finally {
    await context.close();
    await admin.auth.admin.deleteUser(created.user.id);
  }
});

test("the panel fits, scrolls inside itself, and every control stays in reach", async ({ page }, testInfo) => {
  const lines = Array.from({ length: 60 }, (_, n) => `<div>سىناق قۇرى ${n + 1}، مۇھىم نەرسە يوق.</div>`);
  const path = await newNote(page, { html: lines.join("") });
  try {
    const userId = await signedInUserId(page);
    await expect.poll(async () => (await storedVersions(page)).length).toBeGreaterThan(0);
    await seedVersions(page, userId, noteIdOf(path), 24);

    const { width: own, height } = testInfo.project.use.viewport!;
    // Phones: the narrowest screen the site promises, too.
    const widths = own < 768 ? [own, 360] : [own];
    for (const width of widths) {
      await page.setViewportSize({ width, height });
      // Reached from the sticky toolbar with the page scrolled down.
      await scrollPage(page, 3000);
      await openHistory(page);
      const panel = page.getByTestId("history-panel");
      const rows = page.getByTestId("history-row");
      await expect(rows).toHaveCount(25);
      expect(await horizontalOverflow(page), `no sideways scroll at ${width}px`).toBeLessThanOrEqual(1);

      const box = (await panel.boundingBox())!;
      if (width < 1024) {
        // A sheet from the bottom, no taller than 85% of the screen.
        expect(box.height).toBeLessThanOrEqual(height * 0.85 + 1);
        expect(Math.abs(box.y + box.height - height)).toBeLessThanOrEqual(1);
      } else {
        expect(Math.round(box.height)).toBe(height);
      }
      for (const row of [rows.first(), rows.last()]) {
        expect((await row.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      }

      // The list scrolls inside the sheet; the page behind it does not move.
      const scroller = page.getByTestId("history-scroll");
      const pageY = await page.evaluate(() => window.scrollY);
      if (wheelWorks(page)) {
        await scroller.hover();
        await page.mouse.wheel(0, 600);
      } else {
        await scroller.evaluate((element) => element.scrollBy(0, 600));
      }
      await expect.poll(() => scroller.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
      expect(await page.evaluate(() => window.scrollY)).toBe(pageY);
      if (wheelWorks(page)) {
        // Past the end of the list: still not the page.
        await page.mouse.wheel(0, 6000);
        await page.waitForTimeout(300);
        expect(await page.evaluate(() => window.scrollY)).toBe(pageY);
        // Back up by wheel, a few turns: Firefox caps how far one event scrolls.
        await expect(async () => {
          await page.mouse.wheel(0, -2000);
          expect(await scroller.evaluate((element) => element.scrollTop)).toBe(0);
        }).toPass();
      } else {
        await scroller.evaluate((element) => element.scrollTo(0, 0));
      }
      await expect.poll(() => scroller.evaluate((element) => element.scrollTop)).toBe(0);
      expect(await page.evaluate(() => window.scrollY)).toBe(pageY);

      await expectTappable(page.getByTestId("history-close"), "history-close");
      await expectTappable(rows.first(), "the newest row");

      // A preview: its two buttons stay put however far it is scrolled.
      await rows.first().click();
      await expect(page.getByTestId("history-preview")).toBeVisible();
      await expectTappable(page.getByTestId("history-restore"), "history-restore");
      await expectTappable(page.getByTestId("history-back"), "history-back");
      await scroller.evaluate((element) => element.scrollBy(0, 4000));
      await scroller.evaluate((element) => element.scrollTo(0, 0));
      await expectTappable(page.getByTestId("history-restore"), "history-restore after scrolling");
      await expectTappable(page.getByTestId("history-back"), "history-back after scrolling");
      await page.getByTestId("history-back").click();
      await expect(rows).toHaveCount(25);

      await page.getByTestId("history-close").click();
      await expect(panel).toHaveCount(0);
      await scrollToTop(page);
      await expectTappable(page.getByTestId("toolbar-more"), "toolbar-more after scrolling back up");
    }
  } finally {
    await dropNote(path);
  }
});
