import { expect, test, type Locator, type Page } from "@playwright/test";
import { hasStaffTestEnv, loadEnvLocal } from "./env";
import { dropNote, newNote, signedInUserId } from "./fixtures/notes";
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

/** Switch the spellchecker on, unless it already is, and wait for the dictionary. */
async function spellcheckOn(page: Page) {
  const toggle = page.getByTestId("spell-toggle");
  if ((await toggle.getAttribute("aria-pressed")) !== "true") await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  // The dictionary is 667 KB over the wire and unpacks in the worker.
  await expect(page.getByTestId("spell-summary")).toBeVisible({ timeout: 90_000 });
}

/** Every word the spellchecker has underlined, in the order it painted them. */
async function markedWords(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const highlight = CSS.highlights?.get("bh-spell-error");
    return highlight ? [...highlight].map((range) => (range as Range).toString()) : [];
  });
}

/** Wait for a word's underline, then tap it and wait for its popup. */
async function tapMarked(page: Page, word: string) {
  await expect.poll(() => markBox(page, word), { timeout: 30_000 }).not.toBeNull();
  const box = (await markBox(page, word))!;
  await page.mouse.click(box.x, box.y);
  await expect(page.getByTestId("spell-popup")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("spell-popup-word")).toHaveText(word);
}

/** A localStorage value, parsed, or null. */
function stored(page: Page, key: string): Promise<unknown> {
  return page.evaluate((name) => {
    const raw = localStorage.getItem(name);
    return raw === null ? null : (JSON.parse(raw) as unknown);
  }, key);
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

test.describe("ignoring a word in one note", () => {
  test("«بۇ خاتىرىدە سەل قارا» clears it in this note, for good, and nowhere else", async ({ page }) => {
    const sentence = (word: string) => `<div>بۇ ${word} دېگەن سۆز.</div>`;
    // Twice the word to ignore, and once a misspelling that stays: its mark
    // is what proves a check has run before "nothing else is marked" is read.
    const here = await newNote(page, { html: sentence(WRONG[1]) + sentence(WRONG[1]) + sentence(WRONG[0]) });
    let elsewhere: string | null = null;
    try {
      const userId = await signedInUserId(page);
      const noteId = Number(here.split("/").pop());
      const personalBefore = await stored(page, "bh-personal-dictionary");

      await spellcheckOn(page);
      await expect(page.getByTestId("spell-summary")).toContainText("ئىملا: 3 خاتالىق");
      await tapMarked(page, WRONG[1]);
      await expectTappable(page.getByTestId("spell-popup-ignore"), "«بۇ خاتىرىدە سەل قارا»");
      await page.getByTestId("spell-popup-ignore").click();

      // Both of its marks go at once; the word stays in the text.
      await expect(page.getByTestId("spell-popup")).toHaveCount(0);
      await expect.poll(() => markedWords(page)).toEqual([WRONG[0]]);
      await expect(page.getByTestId("spell-summary")).toContainText("ئىملا: 1 خاتالىق");
      await expect(page.getByTestId("note-body")).toContainText(WRONG[1]);
      expect(await stored(page, `bh-spell-ignore:${userId}:${noteId}`)).toEqual([WRONG[1]]);
      // The personal dictionary is not touched.
      expect(await stored(page, "bh-personal-dictionary")).toEqual(personalBefore);

      // Still ignored after a reload.
      await page.reload();
      await expect(page.getByTestId("note-body")).toHaveAttribute("contenteditable", "true");
      await spellcheckOn(page);
      await expect.poll(() => markedWords(page), { timeout: 30_000 }).toEqual([WRONG[0]]);

      // Another note: the same word is marked there.
      elsewhere = await newNote(page, { html: sentence(WRONG[1]) });
      await spellcheckOn(page);
      await expect.poll(() => markedWords(page), { timeout: 30_000 }).toEqual([WRONG[1]]);
    } finally {
      await dropNote(here);
      if (elsewhere) await dropNote(elsewhere);
    }
  });
});

test.describe("the personal dictionary", () => {
  async function openDictionary(page: Page) {
    await page.getByTestId("toolbar-more").click();
    await page.getByTestId("dictionary-open").click();
    await expect(page.getByTestId("dictionary-panel")).toBeVisible();
    await expect(page.getByTestId("toolbar-overflow")).toHaveCount(0);
  }

  const listed = (page: Page) => page.getByTestId("dictionary-word").allTextContents();

  /** Choose a file for «كىرگۈزۈش», as the writer's file picker would hand it over. */
  async function importFile(page: Page, content: unknown) {
    await page.getByTestId("dictionary-file").setInputFiles({
      name: "words.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(content)),
    });
  }

  test("lists a word added from the popup, and deleting it brings its mark back", async ({ page }) => {
    const path = await newNote(page, {
      html: `<div>بۇ ${WRONG[1]} دېگەن سۆز.</div><div>بۇ ${WRONG[0]} دېگەن سۆز.</div>`,
    });
    try {
      await spellcheckOn(page);
      await tapMarked(page, WRONG[1]);
      await page.getByTestId("spell-popup-add").click();
      await expect.poll(() => markedWords(page)).toEqual([WRONG[0]]);

      await openDictionary(page);
      await expect(page.getByTestId("dictionary-device-only")).toHaveText(
        "بۇ لۇغەت پەقەت مۇشۇ تور كۆرگۈچتە ساقلىنىدۇ. باشقا ئۈسكۈنىگە يۆتكىمەكچى بولسىڭىز، بۇ يەردىن چىقىرىپ، ئۇ يەردە كىرگۈزۈڭ.",
      );
      expect(await listed(page)).toContain(WRONG[1]);
      const before = (await listed(page)).length;
      await expect(page.getByTestId("dictionary-count")).toHaveText(`${before} سۆز`);

      // Deleted here, marked again in the note behind — at once.
      await page.getByRole("button", { name: `«${WRONG[1]}» نى ئۆچۈرۈش` }).click();
      expect(await listed(page)).not.toContain(WRONG[1]);
      await expect(page.getByTestId("dictionary-count")).toHaveText(`${before - 1} سۆز`);
      await expect.poll(() => markedWords(page), { timeout: 30_000 }).toEqual([WRONG[1], WRONG[0]]);
      expect(await stored(page, "bh-personal-dictionary")).not.toContain(WRONG[1]);
    } finally {
      await dropNote(path);
    }
  });

  test("imports a file word by word, points out glued entries, exports, and clears in two steps", async ({
    page,
  }) => {
    const path = await newNote(page, { html: `<div>بۇ ${WRONG[0]} دېگەن سۆز.</div>` });
    try {
      await spellcheckOn(page);
      await openDictionary(page);

      await importFile(page, [
        "تەستسۆز",
        "ئالمائۆرۈك", // two words stuck together
        "ئابدۇلباقى", // a compound the dictionary itself lists
        "تەستسۆز", // twice
        "ئىككى سۆز",
        "<b>سۆز</b>",
        7,
        "ا",
        "ب".repeat(65),
        WRONG[0],
      ]);
      await expect(page.getByTestId("dictionary-report")).toHaveText("4 سۆز قوشۇلدى، 5 سۆز رەت قىلىندى.");
      for (const word of ["تەستسۆز", "ئالمائۆرۈك", "ئابدۇلباقى", WRONG[0]]) expect(await listed(page)).toContain(word);
      // Nothing from the file reached the page as markup.
      await expect(page.locator('[data-testid="dictionary-panel"] b')).toHaveCount(0);
      // An imported word counts at once in the note.
      await expect.poll(() => markedWords(page), { timeout: 30_000 }).toEqual([]);

      // The hint, on the glued entry only — and nothing is removed for it.
      const row = (word: string) =>
        page
          .getByTestId("dictionary-row")
          .filter({ has: page.getByTestId("dictionary-word").getByText(word, { exact: true }) });
      await expect(row("ئالمائۆرۈك").getByTestId("dictionary-glued")).toHaveText(
        "بەلكىم ئىككى سۆز چاپلىشىپ قالغان — تەكشۈرۈپ بېقىڭ",
        { timeout: 30_000 },
      );
      await expect(row("ئابدۇلباقى").getByTestId("dictionary-glued")).toHaveCount(0);
      await expect(row("تەستسۆز").getByTestId("dictionary-glued")).toHaveCount(0);

      // The filter.
      await page.getByTestId("dictionary-filter").fill("تەست");
      expect(await listed(page)).toEqual(["تەستسۆز"]);
      await page.getByTestId("dictionary-filter").fill("");

      // «چىقىرىش»: a JSON array of the words, in the order shown.
      const shown = await listed(page);
      const download = page.waitForEvent("download", { timeout: 30_000 });
      await page.getByTestId("dictionary-export").click();
      const file = await download;
      expect(file.suggestedFilename()).toBe("bilim-hezinisi-lughet.json");
      const chunks: Buffer[] = [];
      for await (const chunk of await file.createReadStream()) chunks.push(chunk as Buffer);
      expect(JSON.parse(Buffer.concat(chunks).toString("utf8"))).toEqual(shown);

      // «ھەممىنى ئۆچۈرۈش» asks first, inline, and «بىكار قىلىش» keeps everything.
      await page.getByTestId("dictionary-clear").click();
      await expect(page.getByTestId("dictionary-clear-box")).toBeVisible();
      await page.getByTestId("dictionary-clear-cancel").click();
      expect(await listed(page)).toEqual(shown);
      await page.getByTestId("dictionary-clear").click();
      await page.getByTestId("dictionary-clear-confirm").click();
      await expect(page.getByTestId("dictionary-empty")).toBeVisible();
      await expect(page.getByTestId("dictionary-count")).toHaveText("0 سۆز");
      expect(await stored(page, "bh-personal-dictionary")).toEqual([]);
      // The note's misspelling is a misspelling again.
      await expect.poll(() => markedWords(page), { timeout: 30_000 }).toEqual([WRONG[0]]);

      // A file that is not a list of words changes nothing.
      await importFile(page, { words: ["سۆز"] });
      await expect(page.getByTestId("dictionary-report")).toContainText("كىرگۈزگىلى بولمىدى");
      await expect(page.getByTestId("dictionary-count")).toHaveText("0 سۆز");
    } finally {
      await dropNote(path);
    }
  });

  test("the panel fits a phone, and its list scrolls inside it", async ({ page }, testInfo) => {
    const own = testInfo.project.use.viewport!;
    const path = await newNote(page, { html: longNoteWith(WRONG) });
    try {
      await openDictionary(page);
      // Enough words to scroll, and a long one that must wrap, not widen the page.
      const many = Array.from(
        { length: 120 },
        (_, index) => `سىناقسۆز${"ا".repeat(index % 7)}${"ب".repeat(Math.floor(index / 7))}`,
      );
      expect(new Set(many).size).toBe(120);
      await importFile(page, [...many, "ق".repeat(64)]);
      await expect(page.getByTestId("dictionary-report")).toHaveText("121 سۆز قوشۇلدى، 0 سۆز رەت قىلىندى.");

      for (const width of own.width < 640 ? [own.width, 360] : [own.width]) {
        await page.setViewportSize({ width, height: own.height });
        expect(await horizontalOverflow(page), `no sideways scroll at ${width} px`).toBeLessThanOrEqual(1);

        const scroller = page.getByTestId("dictionary-scroll");
        const sizes = await scroller.evaluate((element) => ({
          scroll: element.scrollHeight,
          client: element.clientHeight,
        }));
        expect(sizes.scroll, "the list is longer than its box").toBeGreaterThan(sizes.client);
        // It scrolls inside itself, and the page behind it does not move.
        const pageBefore = await page.evaluate(() => window.scrollY);
        await scroller.evaluate((element) => element.scrollTo(0, element.scrollHeight));
        await expect.poll(() => scroller.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
        expect(await page.evaluate(() => window.scrollY)).toBe(pageBefore);
        await scroller.evaluate((element) => element.scrollTo(0, 0));

        for (const id of [
          "dictionary-close",
          "dictionary-export",
          "dictionary-import",
          "dictionary-clear",
          "dictionary-filter",
        ]) {
          await expectTappable(page.getByTestId(id), `${id} at ${width} px`);
        }
        await expectTappable(page.getByTestId("dictionary-delete").first(), `a delete button at ${width} px`);
      }

      // Escape closes it, and the page scrolls again.
      await page.keyboard.press("Escape");
      await expect(page.getByTestId("dictionary-panel")).toHaveCount(0);
      expect(await page.evaluate(() => document.documentElement.style.overflow)).toBe("");
    } finally {
      await dropNote(path);
    }
  });
});

test.describe("the header on a phone", () => {
  test("keeps its two rows with the checker on, until the step row is asked for", async ({ page }, testInfo) => {
    test.skip(testInfo.project.use.viewport!.width >= 640, "phones only");
    const path = await newNote(page, { html: longNoteWith(WRONG) });
    try {
      await spellcheckOn(page);
      for (const width of [360, 375, 390]) {
        await page.setViewportSize({ width, height: 740 });
        await scrollToTop(page);
        const height = await page
          .getByTestId("note-toolbar")
          .evaluate((header) => header.getBoundingClientRect().height);
        expect(height, `header at ${width} px with the checker on`).toBeLessThanOrEqual(112);
      }
    } finally {
      await dropNote(path);
    }
  });
});
