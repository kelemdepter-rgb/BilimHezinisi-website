import { expect, test, type Locator, type Page } from "@playwright/test";
import { hasStaffTestEnv, loadEnvLocal } from "./env";
import { dropNote, newNote } from "./fixtures/notes";
import { scrollPage, scrollToTop } from "./fixtures/scroll";

loadEnvLocal();

test.skip(!hasStaffTestEnv(), "Supabase env not configured");

/**
 * Spelling made comfortable (PROMPT-48, notebook stage 7): stepping through
 * the errors one at a time. Every note here is made straight in the database
 * (tests/fixtures/notes.ts) and every word is invented test text: the
 * misspellings are each one edit from a dictionary word, and the filler and
 * the words around them were checked against the shipped dictionary first —
 * and are checked again in place, by counting the marks.
 */

const FILLER = "بۇ بىر سىناق قۇرى، ئۇنىڭدا مۇھىم نەرسە يوق.";
/** Misspelled, in the order they stand in the note. */
const WRONG = ["خەزىنا", "ئۇيغور", "كىتاۋ"] as const;

function filler(lines: number): string {
  return Array.from({ length: lines }, () => `<div>${FILLER}</div>`).join("");
}

/** A note long enough to scroll at every viewport, with `words` far apart. */
function longNoteWith(words: readonly string[]): string {
  return filler(3) + words.map((word) => `<div>بۇ ${word} دېگەن سۆز.</div>${filler(30)}`).join("");
}

/** Switch the spellchecker on and wait for the dictionary. */
async function spellcheckOn(page: Page) {
  await page.getByTestId("spell-toggle").click();
  // The dictionary is 667 KB over the wire and unpacks in the worker.
  await expect(page.getByTestId("spell-summary")).toBeVisible({ timeout: 90_000 });
}

/** Where a word's underline is on screen, or null when it is not underlined. */
async function markBox(page: Page, word: string) {
  return page.evaluate((needle) => {
    const highlight = CSS.highlights?.get("bh-spell-error");
    if (!highlight) return null;
    for (const abstract of highlight) {
      const range = abstract as Range;
      if (range.toString() === needle) {
        const box = range.getBoundingClientRect();
        return { x: box.left + box.width / 2, y: box.top + box.height / 2, top: box.top, bottom: box.bottom };
      }
    }
    return null;
  }, word);
}

/** The word is on screen, below the sticky header and above the bottom edge. */
async function expectWordInView(page: Page, word: string) {
  const box = await markBox(page, word);
  expect(box, `${word} is underlined`).not.toBeNull();
  const header = (await page.getByTestId("note-toolbar").boundingBox())!;
  const height = await page.evaluate(() => window.visualViewport?.height ?? window.innerHeight);
  expect(box!.top, `${word} is below the header`).toBeGreaterThanOrEqual(header.y + header.height - 1);
  expect(box!.bottom, `${word} is above the bottom edge`).toBeLessThanOrEqual(height + 1);
}

/** The step row's count, the popup's word, and the word on screen. */
async function expectAt(page: Page, count: string, word: string) {
  await expect(page.getByTestId("spell-nav-count")).toHaveText(count);
  await expect(page.getByTestId("spell-popup")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("spell-popup-word")).toHaveText(word);
  await expectWordInView(page, word);
  await expect(page.getByTestId("spell-popup")).toBeInViewport();
}

/** Visible, a 44 px target, and the thing under its centre is itself. */
async function expectTappable(control: Locator, name: string) {
  await expect(control, name).toBeInViewport({ ratio: 1 });
  const box = (await control.boundingBox())!;
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

test.describe("stepping through the errors", () => {
  test("goes from error to error, wraps, and counts down as they are fixed", async ({ page }) => {
    const path = await newNote(page, { html: longNoteWith(WRONG) });
    try {
      await spellcheckOn(page);
      await expect(page.getByTestId("spell-summary")).toContainText("ئىملا: 3 خاتالىق");
      // Never open by default.
      await expect(page.getByTestId("spell-nav")).toHaveCount(0);

      // From the summary under the note — the caret is nowhere yet, so the
      // first error is the first one in the note.
      await page.getByTestId("spell-nav-open").click();
      await expect(page.getByTestId("spell-nav")).toBeVisible();
      await expectAt(page, "1 / 3", WRONG[0]);

      await page.getByTestId("spell-nav-next").click();
      await expectAt(page, "2 / 3", WRONG[1]);
      await page.getByTestId("spell-nav-next").click();
      await expectAt(page, "3 / 3", WRONG[2]);
      // Past the last, back to the first; before the first, the last.
      await page.getByTestId("spell-nav-next").click();
      await expectAt(page, "1 / 3", WRONG[0]);
      await page.getByTestId("spell-nav-prev").click();
      await expectAt(page, "3 / 3", WRONG[2]);

      // Fixing it counts it off, and «كېيىنكى» carries on from there.
      await page.getByTestId("spell-suggestion").first().click();
      await expect(page.getByTestId("spell-popup")).toHaveCount(0);
      await expect(page.getByTestId("spell-nav-count")).toHaveText(/ \/ 2$/);
      await expect(page.getByTestId("note-body")).not.toContainText(WRONG[2]);
      await page.getByTestId("spell-nav-next").click();
      await expectAt(page, "1 / 2", WRONG[0]);

      await page.getByTestId("spell-suggestion").first().click();
      await expect(page.getByTestId("spell-nav-count")).toHaveText(/ \/ 1$/);
      await page.getByTestId("spell-nav-next").click();
      await expectAt(page, "1 / 1", WRONG[1]);

      // The last one: the row says so, and goes by itself.
      await page.getByTestId("spell-suggestion").first().click();
      await expect(page.getByTestId("spell-nav-done")).toHaveText("ئىملا خاتالىقى قالمىدى.");
      await expect(page.getByTestId("spell-nav")).toHaveCount(0, { timeout: 5_000 });
      await expect(page.getByTestId("spell-summary")).toContainText("ئىملا: خاتالىق يوق");
    } finally {
      await dropNote(path);
    }
  });

  test("starts after the caret, and from the overflow switches the checker on", async ({ page }) => {
    const path = await newNote(page, { html: longNoteWith(WRONG) });
    try {
      // The caret just after the second misspelling, the checker still off.
      await page.getByTestId("note-body").evaluate((editor, word) => {
        (editor as HTMLElement).focus();
        const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          const at = (node as Text).data.indexOf(word);
          if (at < 0) continue;
          const caret = document.createRange();
          caret.setStart(node, at + word.length);
          const selection = getSelection()!;
          selection.removeAllRanges();
          selection.addRange(caret);
          return;
        }
      }, WRONG[1]);

      await page.getByTestId("toolbar-more").click();
      await page.getByTestId("spell-nav-open-menu").click();
      await expect(page.getByTestId("toolbar-overflow")).toHaveCount(0);
      await expect(page.getByTestId("spell-toggle")).toHaveAttribute("aria-pressed", "true");
      // Waits for the dictionary, then goes to the first error after the caret.
      await expect(page.getByTestId("spell-popup-word")).toHaveText(WRONG[2], { timeout: 90_000 });
      await expectAt(page, "3 / 3", WRONG[2]);

      await page.getByTestId("spell-nav-close").click();
      await expect(page.getByTestId("spell-nav")).toHaveCount(0);
    } finally {
      await dropNote(path);
    }
  });

  test("the row fits a phone and stays in reach after scrolling", async ({ page }, testInfo) => {
    const own = testInfo.project.use.viewport!;
    const path = await newNote(page, { html: longNoteWith(WRONG) });
    try {
      await spellcheckOn(page);
      await page.getByTestId("spell-nav-open").click();
      await expectAt(page, "1 / 3", WRONG[0]);
      await page.getByTestId("spell-popup-close").click();

      for (const width of own.width < 640 ? [own.width, 360] : [own.width]) {
        await page.setViewportSize({ width, height: own.height });
        expect(await horizontalOverflow(page), `no sideways scroll at ${width} px`).toBeLessThanOrEqual(1);
        await scrollPage(page, 4000);
        await scrollPage(page, -6000);
        await scrollToTop(page);
        for (const id of ["spell-nav-prev", "spell-nav-next", "spell-nav-close", "spell-toggle", "toolbar-more"]) {
          await expectTappable(page.getByTestId(id), `${id} at ${width} px`);
        }
        // Still working, not merely painted.
        await page.getByTestId("spell-nav-next").click();
        await expect(page.getByTestId("spell-popup")).toBeVisible({ timeout: 30_000 });
        await page.getByTestId("spell-popup-close").click();
      }
    } finally {
      await dropNote(path);
    }
  });
});
