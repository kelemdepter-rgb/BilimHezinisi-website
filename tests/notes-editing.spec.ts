import { expect, test, type Locator, type Page } from "@playwright/test";
import { hasStaffTestEnv, loadEnvLocal } from "./env";
import { dropNote, newNote, openFind } from "./fixtures/notes";
import { scrollPage, scrollToTop } from "./fixtures/scroll";

loadEnvLocal();

test.skip(!hasStaffTestEnv(), "Supabase env not configured");

/**
 * Editing that does what it says (PROMPT-45, notebook stage 4).
 *
 * Every note here is made straight in the database with the shape under test
 * already in it — a note that starts with a heading, a citation, a list — so
 * what is asserted is the editor's own HTML, byte for byte, in each engine.
 * All the text is invented.
 */

const OLD = "ئالما";
const NEW = "ئۆرۈك";

/** The shapes a whole-document rewrite used to corrupt (N7). */
const SHAPES: [label: string, html: string][] = [
  [
    "a heading",
    '<h2>ئالما باغچىسى</h2><div>بۇ يىل ئالما كۆپ.</div><div style="text-align: center;">ئالما ۋە ئۆرۈك</div>',
  ],
  [
    "a citation",
    '<blockquote dir="rtl">ئالما دەرىخى ئېگىز.</blockquote><p dir="rtl" style="font-size:13px;color:#8a8a8a"><a href="/books/1/read?page=2">«ئالما» — 2-بەت</a></p><p><br></p>',
  ],
  ["a list", "<ul><li>ئالما</li><li>نەشپۈت ۋە ئالما</li></ul><div>ئالما يېگىنىم.</div>"],
  ["plain text", "ئالما بىر<div>ئالما ئىككى</div><div>ئالما ئۈچ</div>"],
];

function bodyHtml(page: Page): Promise<string> {
  return page.getByTestId("note-body").evaluate((editor) => editor.innerHTML);
}

/** `html` with only its `ordinal`-th occurrence of `word` replaced. */
function replaceNth(html: string, word: string, ordinal: number, replacement: string): string {
  let at = -1;
  for (let seen = 0; seen <= ordinal; seen += 1) at = html.indexOf(word, at + 1);
  return html.slice(0, at) + replacement + html.slice(at + word.length);
}

async function openReplace(page: Page, query: string, replacement: string) {
  await openFind(page);
  await page.getByTestId("find-input").fill(query);
  await page.getByTestId("find-toggle-replace").click();
  await page.getByTestId("replace-input").fill(replacement);
}

/** Put the caret two letters into the first text inside `selector`. */
async function caretIn(page: Page, selector: string) {
  await page.getByTestId("note-body").evaluate((editor, inside) => {
    (editor as HTMLElement).focus();
    const text = document.createTreeWalker(editor.querySelector(inside)!, NodeFilter.SHOW_TEXT).nextNode()!;
    const caret = document.createRange();
    caret.setStart(text, 2);
    caret.collapse(true);
    const selection = getSelection()!;
    selection.removeAllRanges();
    selection.addRange(caret);
  }, selector);
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

/** Lines of invented text, so the page scrolls at every viewport. */
function longNote(lines: number): string {
  const filler = "بۇ بىر سىناق قۇرى، ئۇنىڭدا مۇھىم نەرسە يوق.";
  return Array.from({ length: lines }, () => `<div>${filler}</div>`).join("");
}

test.describe("find and replace keep the note's shape", () => {
  for (const [label, html] of SHAPES) {
    test(`replace-all in a note that starts with ${label}, and «ھەممىنى يېنىۋېلىش» puts it back`, async ({
      page,
    }) => {
      const path = await newNote(page, { html });
      try {
        const before = await bodyHtml(page);
        const count = before.split(OLD).length - 1;
        await openReplace(page, OLD, NEW);
        await expect(page.getByTestId("find-count")).toHaveText(`1 / ${count}`);

        await page.getByTestId("replace-all").click();
        // Only the words changed: every tag, attribute and line where it was.
        await expect.poll(() => bodyHtml(page)).toBe(before.split(OLD).join(NEW));
        await expect(page.getByTestId("find-notice")).toHaveText(`${count} ئورۇن ئالماشتۇرۇلدى.`);

        const undoAll = page.getByTestId("find-undo-all");
        await expectTappable(undoAll, "find-undo-all");
        await undoAll.click();
        await expect.poll(() => bodyHtml(page)).toBe(before);
        await expect(undoAll).toHaveCount(0);
        // The note as it was is what reaches the server.
        await expect(page.getByTestId("save-state")).toHaveText("ساقلاندى", { timeout: 20_000 });
      } finally {
        await dropNote(path);
      }
    });
  }

  test("«ھەممىنى يېنىۋېلىش» goes with the next keystroke", async ({ page }) => {
    const path = await newNote(page, { html: SHAPES[3][1] });
    try {
      await openReplace(page, OLD, NEW);
      await page.getByTestId("replace-all").click();
      const undoAll = page.getByTestId("find-undo-all");
      await expect(undoAll).toBeVisible();

      // Into the note, which by itself changes nothing …
      await page.getByTestId("note-body").click();
      await page.keyboard.press("End");
      await expect(undoAll).toBeVisible();
      // … and one letter, which does.
      await page.keyboard.type("ب");
      await expect(undoAll).toHaveCount(0);
      // The notice that stays names no keyboard shortcut.
      await expect(page.getByTestId("note-toolbar")).not.toContainText("Ctrl");
    } finally {
      await dropNote(path);
    }
  });

  test("replace-one changes only the current hit, and one «يېنىۋېلىش» reverts it", async ({ page }) => {
    const path = await newNote(page, { html: SHAPES[3][1] });
    try {
      const before = await bodyHtml(page);
      await openReplace(page, OLD, NEW);
      await expect(page.getByTestId("find-count")).toHaveText("1 / 3");
      await page.getByTestId("find-next").click();
      await expect(page.getByTestId("find-count")).toHaveText("2 / 3");

      await page.getByTestId("replace-one").click();
      await expect.poll(() => bodyHtml(page)).toBe(replaceNth(before, OLD, 1, NEW));
      // The place is kept: the next hit is now the current one.
      await expect(page.getByTestId("find-count")).toHaveText("2 / 2");
      const notice = page.getByTestId("find-notice");
      await expect(notice).toContainText("1 ئورۇن ئالماشتۇرۇلدى.");
      await expect(notice).toContainText("«يېنىۋېلىش»");
      await expect(notice).not.toContainText("Ctrl");

      await page.getByTestId("format-undo").click();
      await expect.poll(() => bodyHtml(page)).toBe(before);
    } finally {
      await dropNote(path);
    }
  });

  test("replace-all of 300 hits in a 60,000-character note is quick, and the page holds still", async ({
    page,
    browserName,
  }, testInfo) => {
    test.skip(
      browserName !== "chromium" || testInfo.project.use.viewport?.width !== 1280,
      "timed once, in Chromium at 1280×800",
    );
    // 300 lines of about 198 characters, one hit in each: just under the
    // 60,000 characters a note may hold. Single spaces only — a double one
    // is a different shape of whitespace for the engine to keep.
    const filler = "بۇ بىر سىناق جۈملىسى، ئۇنىڭدا ھېچقانداق مۇھىم نەرسە يوق. ";
    const line = `${filler.repeat(4).slice(0, 198 - OLD.length - 1).trimEnd()} ${OLD}`;
    const html = Array.from({ length: 300 }, () => `<div>${line}</div>`).join("");
    const path = await newNote(page, { html });
    try {
      const chars = await page.getByTestId("note-body").evaluate((editor) => editor.textContent!.length);
      const before = await bodyHtml(page);
      await openReplace(page, OLD, NEW);
      await expect(page.getByTestId("find-count")).toHaveText("1 / 300");

      /**
       * Time a replace-all from the middle of the note, and see whether the
       * line under the middle of the screen moved. Not scrollY: the find bar
       * grows by a row for the notice, and the browser's scroll anchoring
       * moves scrollY by that much precisely so the text stays put.
       */
      const timeReplaceAll = () =>
        page.evaluate(async () => {
          window.scrollTo(0, 3000);
          const editor = document.querySelector('[data-testid="note-body"]')!;
          const line = [...editor.children].find((child) => {
            const box = child.getBoundingClientRect();
            return box.top > window.innerHeight / 2;
          })!;
          const before = line.getBoundingClientRect().top;
          const button = document.querySelector<HTMLButtonElement>('[data-testid="replace-all"]')!;
          const started = performance.now();
          button.click();
          while (!document.querySelector('[data-testid="find-undo-all"]')) {
            await new Promise((done) => requestAnimationFrame(done));
          }
          const ms = Math.round(performance.now() - started);
          await new Promise((done) => requestAnimationFrame(done));
          return { ms, moved: line.getBoundingClientRect().top - before };
        });

      const plain = await timeReplaceAll();
      console.log(`replace-all, 300 hits in ${chars} characters, Chromium 1280×800: ${plain.ms} ms`);
      testInfo.annotations.push({ type: "replace-all 300 hits", description: `${plain.ms} ms` });
      expect(plain.ms).toBeLessThan(1000);
      expect(Math.abs(plain.moved), "the page did not jump").toBeLessThanOrEqual(2);
      expect(await bodyHtml(page)).toBe(before.split(OLD).join(NEW));

      // 300 native undos — or the snapshot — bring the note back exactly.
      await page.getByTestId("find-undo-all").click();
      await expect.poll(() => bodyHtml(page)).toBe(before);
      await expect(page.getByTestId("find-count")).toHaveText(/ \/ 300$/);

      const cdp = await page.context().newCDPSession(page);
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
      try {
        const slow = await timeReplaceAll();
        console.log(`replace-all, 300 hits, 4× CPU throttling: ${slow.ms} ms`);
        testInfo.annotations.push({ type: "replace-all 300 hits, 4× CPU", description: `${slow.ms} ms` });
        expect(slow.ms).toBeLessThan(3000);
      } finally {
        await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
      }
      expect(await bodyHtml(page)).toBe(before.split(OLD).join(NEW));
    } finally {
      await dropNote(path);
    }
  });
});

test.describe("block style", () => {
  const CASES: [label: string, html: string, at: string, style: "heading" | "quote", normal: string][] = [
    [
      "a heading",
      "<div>بىرىنچى</div><h2>ماۋزۇ قۇرى</h2><div>ئاخىرى</div>",
      "h2",
      "heading",
      "<div>بىرىنچى</div><div>ماۋزۇ قۇرى</div><div>ئاخىرى</div>",
    ],
    [
      "a quote",
      "<div>بىرىنچى</div><blockquote>نەقىل قۇرى</blockquote><div>ئاخىرى</div>",
      "blockquote",
      "quote",
      "<div>بىرىنچى</div><div>نەقىل قۇرى</div><div>ئاخىرى</div>",
    ],
    [
      "a quote of several lines",
      "<div>بىرىنچى</div><blockquote>بىر قۇر<br>ئىككى قۇر</blockquote><div>ئاخىرى</div>",
      "blockquote",
      "quote",
      "<div>بىرىنچى</div><div>بىر قۇر<br>ئىككى قۇر</div><div>ئاخىرى</div>",
    ],
    [
      "a heading that opens the note",
      "<h2>ماۋزۇ قۇرى</h2><div>ئاخىرى</div>",
      "h2",
      "heading",
      "<div>ماۋزۇ قۇرى</div><div>ئاخىرى</div>",
    ],
  ];

  for (const [label, html, at, style, normal] of CASES) {
    test(`«ئادەتتىكى تېكىست» turns ${label} back into normal text, in one undoable step`, async ({
      page,
    }) => {
      const path = await newNote(page, { html });
      try {
        expect(await bodyHtml(page)).toBe(html);
        await caretIn(page, at);

        // The control says where the caret is.
        await page.getByTestId("block-style").click();
        const menu = page.getByTestId("block-style-menu");
        await expect(menu).toBeVisible();
        await expect(page.getByTestId(`format-${style}`)).toHaveAttribute("aria-checked", "true");
        await expect(page.getByTestId("format-normal")).toHaveAttribute("aria-checked", "false");

        await page.getByTestId("format-normal").click();
        await expect(menu).toHaveCount(0);
        await expect.poll(() => bodyHtml(page)).toBe(normal);
        await expect(page.getByTestId("block-style")).toHaveAttribute("data-style", "normal");

        await page.getByTestId("format-undo").click();
        await expect.poll(() => bodyHtml(page)).toBe(html);
      } finally {
        await dropNote(path);
      }
    });
  }

  test("makes a line a quote and a heading from the same menu", async ({ page }) => {
    const path = await newNote(page, { html: "<div>بىرىنچى</div><div>ئىككىنچى</div>" });
    try {
      await caretIn(page, "div:nth-child(2)");
      await page.getByTestId("block-style").click();
      await page.getByTestId("format-quote").click();
      await expect(page.locator('[data-testid="note-body"] blockquote')).toHaveText("ئىككىنچى");
      await expect(page.getByTestId("block-style")).toHaveAttribute("data-style", "quote");

      await page.getByTestId("block-style").click();
      await page.getByTestId("format-heading").click();
      await expect(page.locator('[data-testid="note-body"] h2')).toHaveText("ئىككىنچى");
      await expect(page.getByTestId("block-style")).toHaveAttribute("data-style", "heading");
    } finally {
      await dropNote(path);
    }
  });
});

test.describe("undo in reach", () => {
  test("the back link and undo look different, and both work", async ({ page }) => {
    const path = await newNote(page);
    try {
      const icon = (testId: string) => page.getByTestId(testId).locator("use").getAttribute("href");
      const back = await icon("notes-back");
      const undo = await icon("format-undo");
      expect(back).toBeTruthy();
      expect(undo).toBeTruthy();
      expect(back, "back must not wear the undo icon").not.toBe(undo);
      await expect(page.getByTestId("notes-back")).toHaveAttribute("aria-label", "خاتىرىلەر تىزىملىكى");

      const body = page.getByTestId("note-body");
      await body.click();
      await page.keyboard.type("سىناق");
      await expect(body).toContainText("سىناق");
      await page.getByTestId("format-undo").click();
      await expect(body).not.toContainText("سىناق");
      await page.getByTestId("format-redo").click();
      await expect(body).toContainText("سىناق");

      await expect(page.getByTestId("save-state")).toHaveText("ساقلاندى", { timeout: 20_000 });
      await page.getByTestId("notes-back").click();
      await expect(page).toHaveURL(/\/notes$/);
    } finally {
      await dropNote(path);
    }
  });
});

test.describe("the spell popup", () => {
  /** Not in the shipped dictionary, so it is underlined. */
  const MISSPELLED = "ئۇيغور";

  async function markBox(page: Page, word: string) {
    return page.evaluate((needle) => {
      const highlight = CSS.highlights?.get("bh-spell-error");
      if (!highlight) return null;
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

  test("stays open while its word is on screen, follows it, and closes once it is not", async ({
    page,
  }) => {
    // The word sits a few lines down, so a short scroll keeps it on screen.
    const html = longNote(4) + `<div>بۇ ${MISSPELLED} دېگەن سۆز.</div>` + longNote(60);
    const path = await newNote(page, { html });
    try {
      await page.getByTestId("spell-toggle").click();
      await expect(page.getByTestId("spell-summary")).toBeVisible({ timeout: 90_000 });
      await scrollToTop(page);
      await expect.poll(() => markBox(page, MISSPELLED), { timeout: 30_000 }).not.toBeNull();
      const box = (await markBox(page, MISSPELLED))!;
      await page.mouse.click(box.x, box.y);

      const popup = page.getByTestId("spell-popup");
      await expect(popup).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId("spell-popup-word")).toHaveText(MISSPELLED);
      // Two seconds untouched — the keyboard rising on a phone scrolls the
      // page, and that used to close it the moment it opened.
      await page.waitForTimeout(2000);
      await expect(popup).toBeVisible();

      // A short scroll: the word is still there, so the popup is too, and it
      // moved with it.
      const top = (await popup.boundingBox())!.y;
      await page.evaluate(() => window.scrollBy(0, 40));
      await expect.poll(async () => (await popup.boundingBox())?.y ?? Infinity).toBeLessThan(top - 20);
      await expect(popup).toBeVisible();

      // Scrolled away: the word left the screen, and the popup with it.
      await page.evaluate(() => window.scrollBy(0, 3000));
      await expect(popup).toHaveCount(0);
    } finally {
      await dropNote(path);
    }
  });
});

test.describe("the toolbar on a phone", () => {
  /** Every control a writer reaches without opening anything. */
  const ALWAYS = [
    "notes-back",
    "note-title",
    "spell-toggle",
    "format-undo",
    "format-redo",
    "format-bold",
    "block-style",
    "list-style",
    "source-open",
    "toolbar-more",
  ];
  /** Inside «باشقا ئىقتىدارلار» on a phone; some sit in the tool row when there is room. */
  const OVERFLOW = [
    "find-open",
    "format-italic",
    "format-underline",
    "format-align-right",
    "format-align-center",
    "format-align-left",
    "format-eraser",
    "note-color",
    "export-open",
    "spell-nav-open-menu",
    "dictionary-open",
    "note-font",
    "note-size-down",
    "note-size-up",
    "note-line-height",
  ];

  async function headerHeight(page: Page): Promise<number> {
    await scrollToTop(page);
    return page.getByTestId("note-toolbar").evaluate((header) => header.getBoundingClientRect().height);
  }

  test("a title row and one tool row, ≤ 112 px, and every control reachable after scrolling", async ({
    page,
  }, testInfo) => {
    const own = testInfo.project.use.viewport!;
    const phone = own.width < 640;
    const path = await newNote(page, { html: longNote(80) });
    try {
      // The measurements the report records.
      const sizes: [number, number][] = testInfo.project.use.isMobile
        ? [[360, 740], [375, 667], [390, 844]]
        : [[360, 740], [375, 667], [390, 844], [1280, 800]];
      for (const [width, height] of sizes) {
        await page.setViewportSize({ width, height });
        const closed = await headerHeight(page);
        await openFind(page);
        const withFind = await headerHeight(page);
        await page.getByTestId("find-close").click();
        await expect(page.getByTestId("find-bar")).toHaveCount(0);
        console.log(
          `[${testInfo.project.name}] header at ${width}×${height}: ${closed.toFixed(1)} px; with the find bar open: ${withFind.toFixed(1)} px`,
        );
        if (width < 640) {
          // Soft, so a failing run still prints every size.
          expect
            .soft(closed, `header at ${width} px with overflow and find closed`)
            .toBeLessThanOrEqual(112);
        }
        if (width === 360) {
          expect(await horizontalOverflow(page), "no sideways scroll at 360 px").toBeLessThanOrEqual(1);
        }
      }

      // Every control, at this project's own size and — on a phone — at 360.
      for (const width of phone ? [own.width, 360] : [own.width]) {
        await page.setViewportSize({ width, height: own.height });
        await scrollPage(page, 4000);
        await expect(page.getByTestId("note-toolbar")).toBeInViewport();
        await scrollPage(page, -6000);
        await scrollToTop(page);

        for (const id of ALWAYS) await expectTappable(page.getByTestId(id), `${id} at ${width}px`);

        for (const [menu, items] of [
          ["block-style", ["format-normal", "format-heading", "format-quote"]],
          ["list-style", ["format-list", "format-list-ordered"]],
        ] as const) {
          await page.getByTestId(menu).click();
          await expect(page.getByTestId(`${menu}-menu`)).toBeVisible();
          for (const id of items) await expectTappable(page.getByTestId(id), `${id} at ${width}px`);
          expect(await horizontalOverflow(page), `${menu} stays on screen`).toBeLessThanOrEqual(1);
          await page.keyboard.press("Escape");
          await expect(page.getByTestId(`${menu}-menu`)).toHaveCount(0);
        }

        await page.getByTestId("toolbar-more").click();
        await expect(page.getByTestId("toolbar-overflow")).toBeVisible();
        for (const id of OVERFLOW) await expectTappable(page.getByTestId(id), `${id} at ${width}px`);
        expect(await horizontalOverflow(page), "the overflow stays on screen").toBeLessThanOrEqual(1);
        await page.getByTestId("toolbar-more").click();
        await expect(page.getByTestId("toolbar-overflow")).toHaveCount(0);
      }
    } finally {
      await dropNote(path);
    }
  });
});
