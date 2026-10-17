import { expect, test, type Locator, type Page } from "@playwright/test";
import { SEED_NEEDLE, hasStaffTestEnv, loadEnvLocal } from "./env";
import { dropNote, newNote } from "./fixtures/notes";
import { scrollPage, scrollToTop } from "./fixtures/scroll";

loadEnvLocal();

test.skip(!hasStaffTestEnv(), "Supabase env not configured");

/**
 * Stage 8 of the notebook (PROMPT-49): a citation's link opened and unlinked
 * from inside the note. Citations come from the seeded test book and the
 * Qur'an through the source panel, the way a writer makes them; every other
 * text is invented.
 */

const AYA = { sura: 1, aya: 2 };

/** Visible, a 44 px target, and the thing under its centre is itself. */
async function expectTappable(control: Locator, name: string) {
  await expect(control, name).toBeInViewport({ ratio: 1 });
  const box = (await control.boundingBox())!;
  // Rounded: Firefox measures a 44 px row of a box at a fractional position as 43.99997.
  expect(Math.round(box.height), `${name} is a 44 px target`).toBeGreaterThanOrEqual(44);
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

/** Type a line, then cite the seeded book; returns the citation's link. */
async function citeTheBook(page: Page): Promise<Locator> {
  await page.getByTestId("note-body").click();
  await page.keyboard.type("بۇ سىناق خاتىرىسى، مەنبە ئاستىدا.");
  await page.getByTestId("source-open").click();
  await expect(page.getByTestId("source-panel")).toBeVisible();
  await page.getByTestId("source-query").fill(SEED_NEEDLE);
  await page.getByTestId("source-search").click();
  const result = page.getByTestId("source-result").first();
  await expect(result).toBeVisible({ timeout: 30_000 });
  await result.getByTestId("source-insert").click();
  const link = page.getByTestId("note-body").locator('a[href^="/books/"]');
  await expect(link).toHaveCount(1);
  await closeSourcePanel(page);
  return link;
}

/** The panel stays open for another insert; on a phone it covers the note. */
async function closeSourcePanel(page: Page) {
  await page.getByTestId("source-close").click();
  await expect(page.getByTestId("source-panel")).toBeHidden();
}

/** Cite a verse from the source panel; returns its link. */
async function citeTheVerse(page: Page): Promise<Locator> {
  await page.getByTestId("note-body").click();
  await page.keyboard.type("ئايەت ئاستىدا.");
  await page.getByTestId("source-open").click();
  await page.getByTestId("source-tab-quran").click();
  await page.getByTestId("aya-sura").fill(String(AYA.sura));
  await page.getByTestId("aya-number-input").fill(String(AYA.aya));
  await page.getByTestId("aya-preview").click();
  await expect(page.getByTestId("aya-preview-box")).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("aya-insert").click();
  const link = page.getByTestId("note-body").locator(`a[href="/quran/${AYA.sura}?aya=${AYA.aya}"]`);
  await expect(link).toHaveCount(1);
  await closeSourcePanel(page);
  return link;
}

test.describe("a citation's link", () => {
  test("a tap opens a card naming the book and page, and «ئېچىش» opens the reader there", async ({
    page,
    context,
  }) => {
    const path = await newNote(page);
    try {
      const link = await citeTheBook(page);
      const href = (await link.getAttribute("href"))!;
      const label = ((await link.textContent()) ?? "").trim();
      const title = /«([^«»]+)»/.exec(label)![1];
      const pageNo = new URL(href, "http://x").searchParams.get("page")!;

      await link.click();
      const card = page.getByTestId("link-popover");
      await expect(card).toBeVisible();
      await expect(card).toHaveAttribute("data-kind", "book");
      await expect(page.getByTestId("link-popover-text")).toHaveText(label);
      await expect(page.getByTestId("link-popover-where")).toHaveText(`كىتاب: «${title}» — ${pageNo}-بەت`);
      // The spellchecker's popup is never opened by the same tap.
      await expect(page.getByTestId("spell-popup")).toHaveCount(0);
      // The tap neither left the note nor opened anything by itself.
      expect(new URL(page.url()).pathname).toBe(path);
      expect(context.pages()).toHaveLength(1);

      for (const id of ["link-open", "link-unlink", "link-popover-close"]) {
        await expectTappable(page.getByTestId(id), id);
      }

      const opened = context.waitForEvent("page");
      await page.getByTestId("link-open").click();
      const reader = await opened;
      await reader.waitForURL(/\/books\/\d+\/read/);
      const at = new URL(reader.url());
      expect(at.origin).toBe(new URL(page.url()).origin);
      expect(`${at.pathname}${at.search}`).toBe(href);
      // A new tab with no way back to the note.
      expect(await reader.evaluate(() => window.opener)).toBeNull();
      await reader.close();

      await expect(card).toHaveCount(0);
      expect(new URL(page.url()).pathname).toBe(path);
    } finally {
      await dropNote(path);
    }
  });

  test("«ئۇلىنىشنى ئېلىۋېتىش» keeps the text, and one «يېنىۋېلىش» brings the link back", async ({ page }) => {
    const path = await newNote(page);
    try {
      const link = await citeTheBook(page);
      const href = (await link.getAttribute("href"))!;
      const label = ((await link.textContent()) ?? "").trim();
      const body = page.getByTestId("note-body");

      await link.click();
      await page.getByTestId("link-unlink").click();
      await expect(page.getByTestId("link-popover")).toHaveCount(0);
      await expect(body.locator("a")).toHaveCount(0);
      await expect(body).toContainText(label);
      // Saved like any edit.
      await expect(page.getByTestId("save-state")).toHaveText("ساقلاندى", { timeout: 25_000 });

      await page.getByTestId("format-undo").click();
      await expect(body.locator(`a[href="${href}"]`)).toHaveCount(1);
      await expect(body.locator(`a[href="${href}"]`)).toHaveText(label);
    } finally {
      await dropNote(path);
    }
  });

  test("a verse's link says which verse it is", async ({ page }) => {
    const path = await newNote(page);
    try {
      const link = await citeTheVerse(page);
      await link.click();
      await expect(page.getByTestId("link-popover")).toHaveAttribute("data-kind", "quran");
      await expect(page.getByTestId("link-popover-where")).toHaveText(`قۇرئان: ${AYA.sura}:${AYA.aya}`);
      // Escape closes it, as an outside tap does.
      await page.keyboard.press("Escape");
      await expect(page.getByTestId("link-popover")).toHaveCount(0);
      await link.click();
      await expect(page.getByTestId("link-popover")).toBeVisible();
      await page.getByTestId("note-title").click();
      await expect(page.getByTestId("link-popover")).toHaveCount(0);
    } finally {
      await dropNote(path);
    }
  });

  test("a link it may not open is shown as written, and never opened", async ({ page, context }, testInfo) => {
    const path = await newNote(page, {
      html: '<div>بىر قۇر.</div><div><a href="mailto:someone@example.com">خەت يېزىش</a></div>',
    });
    try {
      const link = page.getByTestId("note-body").locator("a");
      await link.click();
      await expect(page.getByTestId("link-popover")).toHaveAttribute("data-kind", "blocked");
      await expect(page.getByTestId("link-popover-where")).toHaveText("mailto:someone@example.com");
      await expect(page.getByTestId("link-popover-blocked")).toBeVisible();
      await expect(page.getByTestId("link-open")).toHaveCount(0);
      await page.getByTestId("link-popover-close").click();
      await expect(page.getByTestId("link-popover")).toHaveCount(0);

      if (!testInfo.project.use.isMobile) {
        // Ctrl+click opens nothing either: it only shows the card.
        await link.click({ modifiers: ["ControlOrMeta"] });
        await expect(page.getByTestId("link-popover")).toBeVisible();
      }
      expect(context.pages()).toHaveLength(1);
    } finally {
      await dropNote(path);
    }
  });

  test("Ctrl+click opens a link at once on a desktop", async ({ page, context }, testInfo) => {
    test.skip(Boolean(testInfo.project.use.isMobile), "no Ctrl key on a phone");
    const path = await newNote(page, {
      html: '<div>بىر قۇر.</div><p><a href="/quran/1?aya=2">قۇرئان كەرىم — 1:2</a></p>',
    });
    try {
      const opened = context.waitForEvent("page");
      await page.getByTestId("note-body").locator("a").click({ modifiers: ["ControlOrMeta"] });
      const tab = await opened;
      await tab.waitForURL(/\/quran\/1\?aya=2/);
      await tab.close();
      await expect(page.getByTestId("link-popover")).toHaveCount(0);
      expect(new URL(page.url()).pathname).toBe(path);
    } finally {
      await dropNote(path);
    }
  });

  test("the card fits, follows its link, and is in reach after scrolling down and up", async ({
    page,
  }, testInfo) => {
    const lines = Array.from({ length: 50 }, (_, n) => `<div>سىناق قۇرى ${n + 1}.</div>`);
    const path = await newNote(page, {
      html: `<div>باش قۇر.</div><p><a href="/quran/1?aya=2">قۇرئان كەرىم — 1:2</a></p>${lines.join("")}`,
    });
    try {
      const { width: own, height } = testInfo.project.use.viewport!;
      const widths = own < 768 ? [own, 360] : [own];
      const link = page.getByTestId("note-body").locator("a");
      const card = page.getByTestId("link-popover");
      for (const width of widths) {
        await page.setViewportSize({ width, height });
        await scrollToTop(page);
        await link.click();
        await expect(card).toBeVisible();
        expect(await horizontalOverflow(page), `no sideways scroll at ${width}px`).toBeLessThanOrEqual(1);
        const box = (await card.boundingBox())!;
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(width);

        // A small scroll keeps the link in sight: the card moves with it.
        const before = box.y;
        await page.evaluate(() => window.scrollBy(0, 30));
        await expect.poll(async () => Math.round((await card.boundingBox())?.y ?? 0)).not.toBe(Math.round(before));
        await expect(card).toBeVisible();

        // Down until the link is gone: so is the card. Back up: a tap opens it again.
        // The wheel is turned over the note: over the card it scrolls the card
        // alone (overscroll-contain), which is the point of the card.
        await page.mouse.move(Math.round(width / 2), height - 40);
        await scrollPage(page, 3000);
        await expect(card).toHaveCount(0);
        await scrollPage(page, -6000);
        await scrollToTop(page);
        await link.click();
        await expect(card).toBeVisible();
        for (const id of ["link-open", "link-unlink", "link-popover-close"]) {
          await expectTappable(page.getByTestId(id), `${id} at ${width}px`);
        }
        await page.getByTestId("link-popover-close").click();
        await expect(card).toHaveCount(0);
      }
    } finally {
      await dropNote(path);
    }
  });
});
