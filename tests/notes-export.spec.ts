import { expect, test, type Download, type Locator, type Page } from "@playwright/test";
import JSZip from "jszip";
import { hasStaffTestEnv, loadEnvLocal } from "./env";
import { dropNote, newNote } from "./fixtures/notes";
import { scrollPage, scrollToTop } from "./fixtures/scroll";

loadEnvLocal();

test.skip(!hasStaffTestEnv(), "Supabase env not configured");

/**
 * Stage 9 of the notebook (PROMPT-50): «چىقىرىش» — Word, PDF (the browser's
 * own print), Markdown and text, every one made in the browser. Runs at the
 * three Chromium sizes and in Firefox and WebKit. Every text is invented; the
 * citation points at a book id nothing is fetched from, because an export
 * never follows a link — it only writes it down.
 */

const TITLE = "چىقىرىش سىنىقى";
const LABEL = "«ئويدۇرما كىتاب» — 3-بەت";
const NOTE =
  "<h2>سىناق بابى</h2>" +
  "<div>بىرىنچى قۇر<br>ئىككىنچى قۇر</div>" +
  "<ul><li>سىرتقى<ul><li>ئىچكى</li></ul></li></ul>" +
  '<blockquote dir="rtl">ئويدۇرما نەقىل.</blockquote>' +
  `<p dir="rtl" style="font-size: 13px; color: #8a8a8a"><a href="/books/1/read?page=3">${LABEL}</a></p>` +
  "<p><br></p>" +
  "<table><tbody><tr><td>ئىسىم</td><td>سان</td></tr><tr><td>بىر</td><td>1</td></tr></tbody></table>" +
  `<p dir="rtl"><span style="font-family: 'Uthmanic Hafs', serif; font-size: 20pt">﴿سىناق ئايىتى﴾</span></p>`;

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

/** A note holding NOTE, titled TITLE, open in the editor. */
async function openNote(page: Page): Promise<string> {
  const path = await newNote(page, { html: NOTE });
  await page.getByTestId("note-title").fill(TITLE);
  return path;
}

/** «باشقا ئىقتىدارلار» → «چىقىرىش». */
async function openExport(page: Page) {
  await page.getByTestId("toolbar-more").click();
  await page.getByTestId("export-open").click();
  await expect(page.getByTestId("export-menu")).toBeVisible();
  // It took the overflow's place.
  await expect(page.getByTestId("toolbar-overflow")).toHaveCount(0);
}

async function bytesOf(download: Download): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of await download.createReadStream()) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

/** Choose one file from the menu and return what was downloaded. */
async function exportAs(page: Page, kind: "docx" | "md" | "txt") {
  await openExport(page);
  const download = page.waitForEvent("download", { timeout: 30_000 });
  await page.getByTestId(`export-${kind}`).click();
  const file = await download;
  await expect(page.getByTestId("export-menu")).toHaveCount(0);
  return { name: file.suggestedFilename(), bytes: await bytesOf(file) };
}

test.describe("exporting a note", () => {
  test("Word, Markdown and text each download, named after the note, with the note inside", async ({ page }) => {
    const path = await openNote(page);
    try {
      const word = await exportAs(page, "docx");
      expect(word.name).toBe(`${TITLE}.docx`);
      expect(word.bytes.subarray(0, 2).toString("latin1")).toBe("PK");
      const zip = await JSZip.loadAsync(word.bytes);
      const xml = await zip.file("word/document.xml")!.async("string");
      for (const text of [TITLE, "بىرىنچى قۇر", "ئىچكى", "ئويدۇرما نەقىل.", "ئىسىم"]) expect(xml).toContain(text);
      // The lines, the list levels and the table are Word's own.
      expect(xml).toContain("<w:br/>");
      expect(xml).toContain('<w:ilvl w:val="1"/>');
      expect(xml).toContain("<w:bidiVisual/>");
      // The notebook's face is the document's.
      const styles = await zip.file("word/styles.xml")!.async("string");
      expect(styles).toContain('w:cs="UKIJ Ekran"');
      // The Qur'an's credit, because a verse is quoted.
      expect(xml).toContain("Tanzil Project");

      const markdown = await exportAs(page, "md");
      expect(markdown.name).toBe(`${TITLE}.md`);
      const md = markdown.bytes.toString("utf8");
      expect(md.startsWith(`# ${TITLE}\n`)).toBe(true);
      expect(md).toContain("## سىناق بابى");
      expect(md).toContain("    -   ئىچكى");
      expect(md).toMatch(new RegExp(`\\[${LABEL}\\]\\(https?://[^)]+/books/1/read\\?page=3\\)`));
      expect(md).toContain("Tanzil Project");

      const text = await exportAs(page, "txt");
      expect(text.name).toBe(`${TITLE}.txt`);
      // UTF-8 with a byte-order mark, Windows line ends, the title first.
      expect([...text.bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
      const lines = text.bytes.toString("utf8").slice(1).split("\r\n");
      expect(lines.slice(0, 7)).toEqual([TITLE, "", "سىناق بابى", "", "بىرىنچى قۇر", "ئىككىنچى قۇر", ""]);
      expect(lines).toContain("   • ئىچكى");
      expect(lines).toContain("ئىسىم | سان");
    } finally {
      await dropNote(path);
    }
  });

  test("with «مەنبەلەرنى ئاستى ئىزاھات قىلىش» on, the citation is a footnote — and the switch is remembered", async ({
    page,
  }) => {
    const path = await openNote(page);
    try {
      await openExport(page);
      const toggle = page.getByTestId("export-footnotes");
      await expect(toggle).toHaveAttribute("aria-checked", "false");
      await toggle.click();
      await expect(toggle).toHaveAttribute("aria-checked", "true");
      // The switch does not close the menu; the close button does.
      await page.getByTestId("export-close").click();
      await expect(page.getByTestId("export-menu")).toHaveCount(0);

      await page.reload();
      await expect(page.getByTestId("note-body")).toHaveAttribute("contenteditable", "true");
      await openExport(page);
      await expect(page.getByTestId("export-footnotes")).toHaveAttribute("aria-checked", "true");
      await page.keyboard.press("Escape");
      await expect(page.getByTestId("export-menu")).toHaveCount(0);

      const word = await exportAs(page, "docx");
      const zip = await JSZip.loadAsync(word.bytes);
      const body = await zip.file("word/document.xml")!.async("string");
      const notes = (await zip.file("word/footnotes.xml")?.async("string")) ?? "";
      expect(notes).toContain(LABEL);
      expect(notes).toMatch(/https?:\/\/[^<]+\/books\/1\/read\?page=3/);
      expect(body).not.toContain(LABEL);
      expect(body).toContain("<w:footnoteReference");

      const markdown = (await exportAs(page, "md")).bytes.toString("utf8");
      expect(markdown).toContain("ئويدۇرما نەقىل.[^1]");
      expect(markdown).toMatch(new RegExp(`\\[\\^1\\]: ${LABEL} — <https?://[^>]+/books/1/read\\?page=3>`));
    } finally {
      await dropNote(path);
    }
  });

  test("PDF / print: the browser prints, with only the note, its title and its credit on paper", async ({ page }) => {
    const path = await openNote(page);
    try {
      // The browser's print dialog cannot be driven from a test; that it is asked for can.
      await page.evaluate(() => {
        const counted = window as unknown as { printed: number };
        counted.printed = 0;
        window.print = () => {
          counted.printed += 1;
        };
      });
      await openExport(page);
      await page.getByTestId("export-print").click();
      await expect.poll(() => page.evaluate(() => (window as unknown as { printed: number }).printed)).toBe(1);
      await expect(page.getByTestId("export-menu")).toHaveCount(0);

      // A panel open and the counts on screen, then the page as the printer sees it.
      await page.getByTestId("toolbar-more").click();
      await page.getByTestId("outline-open").click();
      await expect(page.getByTestId("outline-panel")).toBeVisible();
      await expect(page.getByTestId("note-print-title")).toBeHidden();
      await page.emulateMedia({ media: "print" });

      await expect(page.getByTestId("note-toolbar")).toBeHidden();
      await expect(page.getByTestId("note-notices")).toBeHidden();
      await expect(page.getByTestId("outline-panel")).toBeHidden();
      await expect(page.getByTestId("note-counts")).toBeHidden();
      await expect(page.getByTestId("note-print-title")).toBeVisible();
      await expect(page.getByTestId("note-print-title")).toHaveText(TITLE);
      await expect(page.getByTestId("note-body")).toBeVisible();
      await expect(page.getByTestId("note-quran-attribution")).toBeVisible();

      // The note's own face, and the verse's Uthmani one.
      const faces = await page.getByTestId("note-body").evaluate((body) => ({
        body: getComputedStyle(body).fontFamily,
        verse: getComputedStyle(body.querySelector("span")!).fontFamily,
      }));
      expect(faces.body).toContain("UKIJ Ekran");
      expect(faces.verse).toContain("Uthmanic Hafs");

      // Dark ink on white paper even when the screen is in the dark theme.
      await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
      const ink = await page.getByTestId("note-body").evaluate((body) => {
        const channels = (css: string) => (css.match(/\d+(\.\d+)?/g) ?? []).slice(0, 3).map(Number);
        return {
          text: channels(getComputedStyle(body).color),
          paper: channels(getComputedStyle(body).backgroundColor),
          page: channels(getComputedStyle(document.body).backgroundColor),
        };
      });
      for (const channel of ink.text) expect(channel, "ink is dark").toBeLessThan(80);
      for (const channel of [...ink.paper, ...ink.page]) expect(channel, "paper is white").toBeGreaterThan(240);

      await page.emulateMedia({ media: "screen" });
      await expect(page.getByTestId("note-print-title")).toBeHidden();
      await expect(page.getByTestId("note-toolbar")).toBeVisible();
    } finally {
      await page.emulateMedia({ media: "screen" });
      await dropNote(path);
    }
  });

  test("the menu fits the screen, and every item is in reach after scrolling down and back up", async ({
    page,
  }, testInfo) => {
    const own = testInfo.project.use.viewport!;
    const path = await newNote(page, { html: NOTE.repeat(12) });
    try {
      const ITEMS = ["export-docx", "export-print", "export-md", "export-txt", "export-footnotes", "export-close"];
      for (const width of own.width < 640 ? [own.width, 375, 360] : [own.width]) {
        await page.setViewportSize({ width, height: own.height });
        await scrollToTop(page);
        await openExport(page);
        expect(await horizontalOverflow(page), `no sideways scroll at ${width} px`).toBeLessThanOrEqual(1);
        // The whole sticky header, menu and all, fits the screen: a sticky
        // header's last rows below the screen's edge could never be reached.
        const bottom = await page.getByTestId("note-toolbar").evaluate((header) => header.getBoundingClientRect().bottom);
        expect(bottom, `the header ends on screen at ${width} px`).toBeLessThanOrEqual(own.height);
        for (const id of ITEMS) await expectTappable(page.getByTestId(id), `${id} at ${width} px`);

        await scrollPage(page, 4000);
        await expect(page.getByTestId("export-menu")).toBeInViewport();
        await scrollPage(page, -6000);
        await scrollToTop(page);
        for (const id of ITEMS) await expectTappable(page.getByTestId(id), `${id} at ${width} px after scrolling`);

        await page.getByTestId("export-close").click();
        await expect(page.getByTestId("export-menu")).toHaveCount(0);
      }
    } finally {
      await dropNote(path);
    }
  });
});
