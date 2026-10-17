import { expect, test, type Locator, type Page } from "@playwright/test";
import { SEED_NEEDLE, hasStaffTestEnv, loadEnvLocal } from "./env";
import { dropNote, newNote } from "./fixtures/notes";
import { scrollPage, scrollToTop } from "./fixtures/scroll";

loadEnvLocal();

test.skip(!hasStaffTestEnv(), "Supabase env not configured");

/**
 * Stage 8 of the notebook (PROMPT-49): a citation's link opened and unlinked
 * from inside the note, and the outline of a note's headings. Citations come
 * from the seeded test book and the Qur'an through the source panel, the way
 * a writer makes them; every other text is invented.
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

/** Lines of invented filler, so a heading further down has to be scrolled to. */
function filler(count: number): string {
  return Array.from({ length: count }, (_, n) => `<div>سىناق قۇرى ${n + 1}، مۇھىم نەرسە يوق.</div>`).join("");
}

async function openOutline(page: Page) {
  await page.getByTestId("toolbar-more").click();
  await page.getByTestId("outline-open").click();
  await expect(page.getByTestId("outline-panel")).toBeVisible();
}

test.describe("the outline", () => {
  test("lists the headings in order with their levels, and a tap goes to one", async ({ page }) => {
    const path = await newNote(page, {
      html: `<h2>بىرىنچى باب</h2>${filler(30)}<h3>ئىچكى پارچە</h3>${filler(30)}<h2>ئۈچىنچى باب</h2>${filler(30)}`,
    });
    try {
      await openOutline(page);
      const rows = page.getByTestId("outline-row");
      await expect(rows).toHaveText(["بىرىنچى باب", "ئىچكى پارچە", "ئۈچىنچى باب"]);
      expect(await rows.evaluateAll((all) => all.map((row) => row.getAttribute("data-level")))).toEqual(["2", "3", "2"]);
      // The h3 sits under the h2s, indented by its level.
      const indent = (n: number) => rows.nth(n).evaluate((row) => parseFloat(getComputedStyle(row).paddingInlineStart));
      expect(await indent(1)).toBeGreaterThan(await indent(0));
      expect(await indent(2)).toBe(await indent(0));

      await rows.nth(2).click();
      const heading = page.getByTestId("note-body").locator("h2").nth(1);
      // Just below the sticky header: in sight, and not under it.
      await expect
        .poll(async () => {
          const top = (await heading.boundingBox())!.y;
          const header = (await page.getByTestId("note-toolbar").boundingBox())!;
          return Math.round(top - (header.y + header.height));
        })
        .toBeGreaterThanOrEqual(0);
      const top = (await heading.boundingBox())!.y;
      const header = (await page.getByTestId("note-toolbar").boundingBox())!;
      expect(top - (header.y + header.height), "no further than a line below the header").toBeLessThan(40);
      await expect(heading).toBeInViewport();
      // The caret is at its start, so writing carries on there.
      const caretIn = await page.evaluate(() => {
        const node = document.getSelection()?.anchorNode ?? null;
        const element = node instanceof Element ? node : node?.parentElement;
        return element?.closest("h2, h3")?.textContent ?? null;
      });
      expect(caretIn).toBe("ئۈچىنچى باب");
    } finally {
      await dropNote(path);
    }
  });

  test("says how to make a heading when there is none", async ({ page }) => {
    const path = await newNote(page, { html: "<div>ماۋزۇسىز خاتىرە.</div>" });
    try {
      await openOutline(page);
      await expect(page.getByTestId("outline-empty")).toHaveText("بۇ خاتىرىدە ماۋزۇ يوق — «ماۋزۇ» نى تاللاپ قوشۇڭ.");
      await page.keyboard.press("Escape");
      await expect(page.getByTestId("outline-panel")).toHaveCount(0);
    } finally {
      await dropNote(path);
    }
  });

  test("keeps up with a heading written while it is open, beside the note", async ({ page }, testInfo) => {
    test.skip(testInfo.project.use.viewport!.width < 1024, "on a phone the sheet covers the note");
    const path = await newNote(page, { html: "<h2>بار ماۋزۇ</h2><div>بىر قۇر.</div>" });
    try {
      await openOutline(page);
      const rows = page.getByTestId("outline-row");
      await expect(rows).toHaveText(["بار ماۋزۇ"]);
      // Write a new line at the end of the note, and make it a heading.
      await page.evaluate(() => {
        const body = document.querySelector<HTMLElement>('[data-testid="note-body"]')!;
        body.focus();
        const end = document.createRange();
        end.selectNodeContents(body);
        end.collapse(false);
        document.getSelection()!.removeAllRanges();
        document.getSelection()!.addRange(end);
      });
      await page.keyboard.press("Enter");
      await page.keyboard.type("يېڭى ماۋزۇ");
      await page.getByTestId("block-style").click();
      await page.getByTestId("format-heading").click();
      await expect(rows).toHaveText(["بار ماۋزۇ", "يېڭى ماۋزۇ"]);
    } finally {
      await dropNote(path);
    }
  });

  test("fits, scrolls inside itself, and is in reach after scrolling down and up", async ({ page }, testInfo) => {
    const html = Array.from({ length: 40 }, (_, n) => `<h2>ماۋزۇ ${n + 1}</h2><div>قۇر ${n + 1}.</div>`).join("");
    const path = await newNote(page, { html });
    try {
      const { width: own, height } = testInfo.project.use.viewport!;
      const widths = own < 768 ? [own, 360] : [own];
      for (const width of widths) {
        await page.setViewportSize({ width, height });
        // Reached from the sticky toolbar with the page scrolled down, and back up.
        await scrollPage(page, 3000);
        await scrollPage(page, -6000);
        await scrollToTop(page);
        await expectTappable(page.getByTestId("toolbar-more"), "toolbar-more");
        await openOutline(page);
        const panel = page.getByTestId("outline-panel");
        const rows = page.getByTestId("outline-row");
        await expect(rows).toHaveCount(40);
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
          expect(Math.round((await row.boundingBox())!.height)).toBeGreaterThanOrEqual(44);
        }

        // The list scrolls inside the panel; the page behind it does not move.
        const scroller = page.getByTestId("outline-scroll");
        const pageY = await page.evaluate(() => window.scrollY);
        await scroller.evaluate((element) => element.scrollBy(0, 600));
        await expect.poll(() => scroller.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
        expect(await page.evaluate(() => window.scrollY)).toBe(pageY);
        await scroller.evaluate((element) => element.scrollTo(0, 0));
        await expectTappable(page.getByTestId("outline-close"), `outline-close at ${width}px`);
        await expectTappable(rows.first(), `the first heading at ${width}px`);
        await page.getByTestId("outline-close").click();
        await expect(panel).toHaveCount(0);
      }
    } finally {
      await dropNote(path);
    }
  });
});
