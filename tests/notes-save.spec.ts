import { expect, test, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { hasStaffTestEnv, loadEnvLocal } from "./env";
import { scrollPage, scrollToTop } from "./fixtures/scroll";

loadEnvLocal();

test.skip(!hasStaffTestEnv(), "Supabase env not configured");

/**
 * Nothing written in the notebook is lost (PROMPT-43).
 *
 * Failures are simulated by aborting this page's own Server Action requests —
 * a POST carrying a `Next-Action` header — never by breaking the real project.
 * The service worker is blocked because page.route cannot see requests from a
 * page it controls. Each test makes a note or two with the suite's bh-e2e-
 * account and deletes them. Every text is invented.
 */
test.use({ serviceWorkers: "block" });

const SENTENCE = "مۇھىم جۈملە يېزىلدى";
const LABEL = {
  saved: "ساقلاندى",
  dirty: "ئۆزگەردى…",
  offline: "ئۇلىنىش يوق — بۇ ئۈسكۈنىدە ساقلاندى",
  notSaved: "ساقلانمىدى",
};
const COPY_SUFFIX = "(بۇ ئۈسكۈنىدىكى نۇسخا)";

const admin = () =>
  createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

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
  await page
    .locator(`[data-testid="note-list"] li`)
    .filter({ has: page.locator(`a[href="/notes/${id}"]`) })
    .getByTestId("delete-note")
    .click();
  await expect(page.locator(`a[href="/notes/${id}"]`)).toHaveCount(0, { timeout: 20_000 });
}

/** Abort every Server Action this page sends until `allow()`. */
async function blockSaves(page: Page) {
  const gate = { blocked: true, attempts: 0 };
  await page.route("**/*", async (route) => {
    const request = route.request();
    if (gate.blocked && request.method() === "POST" && request.headers()["next-action"]) {
      gate.attempts += 1;
      // "failed", not "connectionreset": Chromium re-sends some requests after
      // a reset, and a POST that quietly went through would prove nothing.
      await route.abort("failed");
      return;
    }
    await route.fallback();
  });
  return {
    get attempts() {
      return gate.attempts;
    },
    allow() {
      gate.blocked = false;
    },
  };
}

async function write(page: Page, text: string) {
  const body = page.getByTestId("note-body");
  // The note takes keystrokes once it is in the editor (after a reload, once
  // the page has hydrated) — before that a tap does nothing, by design.
  await expect(body).toHaveAttribute("contenteditable", "true");
  await body.click();
  await page.keyboard.type(text);
}

/** Enough paragraphs to make the page scroll, written in one go. */
async function fillLongNote(page: Page) {
  await page.getByTestId("note-body").evaluate((body) => {
    body.innerHTML = Array.from({ length: 40 }, (_, line) => `<p>قۇر ${line + 1}</p>`).join("");
    body.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

/** Visible, at least 44 px tall, and the thing under its centre is itself. */
async function expectTappable(page: Page, testId: string) {
  const control = page.getByTestId(testId);
  await expect(control, testId).toBeInViewport({ ratio: 1 });
  const box = (await control.boundingBox())!;
  expect(box.height, `${testId} is a 44 px target`).toBeGreaterThanOrEqual(44);
  const onTop = await control.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return hit !== null && element.contains(hit);
  });
  expect(onTop, `${testId} is not covered`).toBe(true);
}

/** Another device saving this note: the row moves on without this page. */
async function editElsewhere(path: string, title: string) {
  const id = Number(path.split("/").pop());
  const { error } = await admin().from("note_documents").update({ title }).eq("id", id);
  expect(error).toBeNull();
}

test.describe("leaving and coming back", () => {
  test("a sentence typed just before the back link is there when the note is reopened", async ({
    page,
  }) => {
    const path = await newNote(page);
    try {
      await write(page, SENTENCE);
      const typed = Date.now();
      await page.getByTestId("notes-back").click();
      // Well inside the 1.2 s debounce: only the save on the way out can have
      // carried the sentence.
      expect(Date.now() - typed).toBeLessThan(1200);
      await expect(page).toHaveURL(/\/notes$/);

      await page.locator(`a[href="${path}"]`).click();
      await expect(page.getByTestId("note-body")).toContainText(SENTENCE);
      await expect(page.getByTestId("save-state")).toHaveText(LABEL.saved, { timeout: 20_000 });

      // On the server, not just in this tab.
      await page.reload();
      await expect(page.getByTestId("note-body")).toContainText(SENTENCE);
    } finally {
      await deleteNote(page, path);
    }
  });

  test("the page hidden — a phone switching apps — sends the save at once", async ({ page }) => {
    const path = await newNote(page);
    try {
      await write(page, SENTENCE);
      const sent = page.waitForRequest(
        (request) => request.method() === "POST" && Boolean(request.headers()["next-action"]),
        { timeout: 1000 },
      );
      const hidden = Date.now();
      await page.evaluate(() => {
        Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
        document.dispatchEvent(new Event("visibilitychange"));
      });
      await sent;
      expect(Date.now() - hidden, "before the 1.2 s debounce would have fired").toBeLessThan(1200);

      await page.evaluate(() => {
        delete (document as { visibilityState?: unknown }).visibilityState;
        document.dispatchEvent(new Event("visibilitychange"));
      });
      await expect(page.getByTestId("save-state")).toHaveText(LABEL.saved, { timeout: 20_000 });
    } finally {
      await deleteNote(page, path);
    }
  });
});

test.describe("the title", () => {
  test("is saved whole, typed letter by letter or set in one go", async ({ page }) => {
    const path = await newNote(page);
    try {
      const title = page.getByTestId("note-title");
      await title.click();
      await title.press("Control+A");
      await page.keyboard.type("تارىخ");
      await expect(page.getByTestId("save-state")).toHaveText(LABEL.saved, { timeout: 20_000 });
      await page.reload();
      await expect(page.getByTestId("note-title")).toHaveValue("تارىخ");

      await page.getByTestId("note-title").fill("دەرس پىلانى");
      await expect(page.getByTestId("save-state")).toHaveText(LABEL.dirty);
      await expect(page.getByTestId("save-state")).toHaveText(LABEL.saved, { timeout: 20_000 });
      await page.reload();
      await expect(page.getByTestId("note-title")).toHaveValue("دەرس پىلانى");

      // The field stops where the server would cut.
      await expect(page.getByTestId("note-title")).toHaveAttribute("maxlength", "200");
    } finally {
      await deleteNote(page, path);
    }
  });
});

test.describe("when saving fails", () => {
  test("offline: says so, keeps the text on this device, and a new page restores and saves it", async ({
    page,
    context,
  }) => {
    const path = await newNote(page);
    await blockSaves(page);
    await write(page, SENTENCE);
    await expect(page.getByTestId("save-state")).toHaveText(LABEL.offline, { timeout: 20_000 });
    await expect(page.getByTestId("save-retry")).toBeVisible();
    await page.close();

    const again = await context.newPage();
    try {
      await again.goto(path);
      await expect(again.getByTestId("note-body")).toContainText(SENTENCE);
      await expect(again.getByTestId("note-notice")).toContainText("ئەسلىگە كەلتۈرۈلدى");
      await expect(again.getByTestId("save-state")).toHaveText(LABEL.saved, { timeout: 20_000 });
      await again.reload();
      await expect(again.getByTestId("note-body")).toContainText(SENTENCE);
    } finally {
      await deleteNote(again, path);
    }
  });

  test("retries by itself, and «ھازىر قايتا سىناش» retries at once", async ({ page }) => {
    const path = await newNote(page);
    try {
      const gate = await blockSaves(page);
      await write(page, "بىرىنچى");
      await expect(page.getByTestId("save-state")).toHaveText(LABEL.offline, { timeout: 20_000 });
      // Nothing typed from here on: the first retry is 5 s after the failure.
      gate.allow();
      await expect(page.getByTestId("save-state")).toHaveText(LABEL.saved, { timeout: 10_000 });
      await expect(page.getByTestId("save-retry")).toHaveCount(0);

      // Again, letting the 5 s retry fail too: the next one is 15 s away, so a
      // save inside the next few seconds can only be the button's.
      const second = await blockSaves(page);
      await write(page, " ئىككىنچى");
      await expect(page.getByTestId("save-state")).toHaveText(LABEL.offline, { timeout: 20_000 });
      const failedOnce = second.attempts;
      await expect.poll(() => second.attempts, { timeout: 10_000 }).toBeGreaterThan(failedOnce);
      await expect(page.getByTestId("save-state")).toHaveText(LABEL.offline);
      second.allow();
      await page.getByTestId("save-retry").click();
      await expect(page.getByTestId("save-state")).toHaveText(LABEL.saved, { timeout: 8_000 });

      await page.reload();
      await expect(page.getByTestId("note-body")).toContainText("بىرىنچى ئىككىنچى");
    } finally {
      await page.unrouteAll({ behavior: "ignoreErrors" });
      await deleteNote(page, path);
    }
  });
});

test.describe("two versions of one note", () => {
  test("a stale tab asks, and «ئىككى خاتىرە قىلىپ ساقلاش» keeps both texts", async ({ page, context }) => {
    const path = await newNote(page);
    const other = await context.newPage();
    let copyPath: string | null = null;
    try {
      await other.goto(path);
      await expect(other.getByTestId("note-body")).toBeVisible();

      await write(page, "بىرىنچى بەتكۈچ");
      await expect(page.getByTestId("save-state")).toHaveText(LABEL.saved, { timeout: 20_000 });

      // The second tab never saw that save.
      await write(other, "ئىككىنچى بەتكۈچ");
      const banner = other.getByTestId("note-conflict");
      await expect(banner).toBeVisible({ timeout: 20_000 });
      await expect(banner).toContainText("باشقا يەردە");
      await expect(other.getByTestId("save-state")).toHaveText(LABEL.notSaved);

      await other.getByTestId("conflict-keep-both").click();
      const copyLink = other.getByTestId("note-copy-link");
      await expect(copyLink).toBeVisible({ timeout: 20_000 });
      await expect(copyLink).toContainText(COPY_SUFFIX);
      copyPath = await copyLink.getAttribute("href");
      expect(copyPath).toMatch(/^\/notes\/\d+$/);

      // This note now shows the other version, and nothing is pending.
      await expect(other.getByTestId("note-conflict")).toHaveCount(0);
      await expect(other.getByTestId("note-body")).toContainText("بىرىنچى بەتكۈچ");
      await expect(other.getByTestId("note-body")).not.toContainText("ئىككىنچى بەتكۈچ");

      // Both texts are on the server.
      await page.reload();
      await expect(page.getByTestId("note-body")).toContainText("بىرىنچى بەتكۈچ");
      await page.goto(copyPath!);
      await expect(page.getByTestId("note-body")).toContainText("ئىككىنچى بەتكۈچ");
      await expect(page.getByTestId("note-title")).toHaveValue(new RegExp(COPY_SUFFIX.replace(/[()]/g, "\\$&")));
    } finally {
      await other.close();
      if (copyPath) await deleteNote(page, copyPath);
      await deleteNote(page, path);
    }
  });

  test("a copy another open tab is still writing is left to it, and restored once that tab is gone", async ({
    page,
    context,
  }) => {
    const path = await newNote(page);
    const text = "يېزىلىۋاتقان جۈملە";
    await blockSaves(page);
    await write(page, text);
    await expect(page.getByTestId("save-state")).toHaveText(LABEL.offline, { timeout: 20_000 });

    // A second tab, while the first still has the note open with its copy
    // unsent: it must not take that copy for one left behind, nor save it.
    const second = await context.newPage();
    await second.goto(path);
    await expect(second.getByTestId("note-body")).toHaveAttribute("contenteditable", "true");
    await expect(second.getByTestId("note-body")).not.toContainText(text);
    await expect(second.getByTestId("note-notice")).toHaveCount(0);
    await expect(second.getByTestId("save-state")).toHaveText("");
    await second.close();

    // The first tab goes away with the copy still unsent: now it is left
    // behind, and the next tab puts it back and saves it.
    await page.close();
    const third = await context.newPage();
    try {
      await third.goto(path);
      await expect(third.getByTestId("note-body")).toContainText(text);
      await expect(third.getByTestId("note-notice")).toContainText("ئەسلىگە كەلتۈرۈلدى");
      await expect(third.getByTestId("save-state")).toHaveText(LABEL.saved, { timeout: 20_000 });
    } finally {
      await deleteNote(third, path);
    }
  });

  test("«مېنىڭ نۇسخامنى بۇنىڭ ئورنىغا قويۇش» puts this version over the other", async ({ page }) => {
    const path = await newNote(page);
    try {
      await editElsewhere(path, "باشقا ئۈسكۈنە");
      await write(page, "بۇ ئۈسكۈنىدىكى يېزىق");
      await expect(page.getByTestId("note-conflict")).toBeVisible({ timeout: 20_000 });
      await page.getByTestId("conflict-keep-mine").click();
      await expect(page.getByTestId("save-state")).toHaveText(LABEL.saved, { timeout: 20_000 });
      await expect(page.getByTestId("note-conflict")).toHaveCount(0);

      await page.reload();
      await expect(page.getByTestId("note-body")).toContainText("بۇ ئۈسكۈنىدىكى يېزىق");
    } finally {
      await deleteNote(page, path);
    }
  });

  test("the version survives its round trip: saves in a row never conflict with themselves", async ({
    page,
  }) => {
    const path = await newNote(page);
    try {
      // PostgREST prints microseconds; the save sends the string back and the
      // update matches on it. Asked directly first…
      const id = Number(path.split("/").pop());
      const db = admin();
      const { data: before } = await db.from("note_documents").select("updated_at").eq("id", id).single();
      const stamp = (before as { updated_at: string }).updated_at;
      expect(stamp).toMatch(/T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(\+00:00|Z)$/);
      const { data: matched } = await db
        .from("note_documents")
        .update({ title: "يېڭى خاتىرە" })
        .eq("id", id)
        .eq("updated_at", stamp)
        .select("updated_at")
        .maybeSingle();
      expect(matched, "the printed version matches its own row").not.toBeNull();
      const { data: stale } = await db
        .from("note_documents")
        .update({ title: "يېڭى خاتىرە" })
        .eq("id", id)
        .eq("updated_at", stamp)
        .select("updated_at")
        .maybeSingle();
      expect(stale, "and only until the row moves on").toBeNull();

      // …then through the editor: the page is now one version behind, so
      // reload, then save four times running from one page.
      await page.reload();
      for (const word of ["بىر", "ئىككى", "ئۈچ", "تۆت"]) {
        await write(page, ` ${word}`);
        await expect(page.getByTestId("save-state")).toHaveText(LABEL.saved, { timeout: 20_000 });
        await expect(page.getByTestId("note-conflict")).toHaveCount(0);
      }
      await page.reload();
      await expect(page.getByTestId("note-body")).toContainText("بىر ئىككى ئۈچ تۆت");
    } finally {
      await deleteNote(page, path);
    }
  });
});

test.describe("on a phone", () => {
  test("the retry button, the labels and the conflict banner fit and stay tappable", async ({
    page,
  }, testInfo) => {
    const path = await newNote(page);
    try {
      await fillLongNote(page);
      await expect(page.getByTestId("save-state")).toHaveText(LABEL.saved, { timeout: 20_000 });
      const { width: own, height } = testInfo.project.use.viewport!;
      // Phones: the narrowest screen the site promises, too.
      const widths = own < 768 ? [own, 360] : [own];

      // Offline: the longest label, and the retry button under the toolbar.
      const gate = await blockSaves(page);
      await page.getByTestId("note-body").press("End");
      await page.keyboard.type(" ئاخىر");
      await expect(page.getByTestId("save-state")).toHaveText(LABEL.offline, { timeout: 20_000 });
      for (const width of widths) {
        await page.setViewportSize({ width, height });
        expect(await horizontalOverflow(page), `no sideways scroll at ${width}px`).toBeLessThanOrEqual(1);
        // The title keeps room beside the long label.
        const titleBox = (await page.getByTestId("note-title").boundingBox())!;
        expect(titleBox.width, `the title stays usable at ${width}px`).toBeGreaterThanOrEqual(80);
        await scrollPage(page, 4000);
        await expect(page.getByTestId("save-state")).toBeInViewport();
        await scrollPage(page, -6000);
        await scrollToTop(page);
        await expectTappable(page, "save-retry");
      }
      gate.allow();
      await page.getByTestId("save-retry").click();
      await expect(page.getByTestId("save-state")).toHaveText(LABEL.saved, { timeout: 20_000 });

      // A conflict: the banner and both of its buttons.
      await editElsewhere(path, "باشقا ئۈسكۈنە");
      // The retry button has the focus; back into the note.
      await page.getByTestId("note-body").press("End");
      await page.keyboard.type(" يەنە");
      await expect(page.getByTestId("note-conflict")).toBeVisible({ timeout: 20_000 });
      for (const width of widths) {
        await page.setViewportSize({ width, height });
        expect(await horizontalOverflow(page), `no sideways scroll at ${width}px`).toBeLessThanOrEqual(1);
        await scrollPage(page, 4000);
        await scrollPage(page, -6000);
        await scrollToTop(page);
        await expectTappable(page, "conflict-keep-both");
        await expectTappable(page, "conflict-keep-mine");
      }
      await page.getByTestId("conflict-keep-mine").click();
      await expect(page.getByTestId("save-state")).toHaveText(LABEL.saved, { timeout: 20_000 });
    } finally {
      await page.unrouteAll({ behavior: "ignoreErrors" });
      await deleteNote(page, path);
    }
  });
});
