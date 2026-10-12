import { expect, test, type Locator, type Page } from "@playwright/test";
import { hasStaffTestEnv, loadEnvLocal } from "./env";
import { dropNote, newNote, openFind } from "./fixtures/notes";

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
