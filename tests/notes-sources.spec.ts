import { expect, test, type Page } from "@playwright/test";
import JSZip from "jszip";
import { SEED_NEEDLE, hasStaffTestEnv, loadEnvLocal } from "./env";

loadEnvLocal();

test.skip(!hasStaffTestEnv(), "Supabase env not configured");

/**
 * Citing the library from inside a note — the desktop app's strongest feature,
 * now on the web. These specs follow the whole path a writer takes: search,
 * insert, save, reload, export. A citation that does not survive that path is
 * not a citation.
 */

const BODY_TEXT = "بۇ مېنىڭ سىناق خاتىرەم.";
/** The verse the aya tests insert. Al-Fatiha, second verse. */
const AYA = { sura: 1, aya: 2 };

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

/** Put the caret in the note and type, so an insert has somewhere to land. */
async function startWriting(page: Page, text = BODY_TEXT) {
  await page.getByTestId("note-body").click();
  await page.keyboard.type(text);
}

async function openSourcePanel(page: Page) {
  await page.getByTestId("source-open").click();
  await expect(page.getByTestId("source-panel")).toBeVisible();
}

/**
 * Download the note as .docx and read what Word would open.
 *
 * The relationships part comes back too: a hyperlink's target is NOT in
 * document.xml — Word keeps it in word/_rels/document.xml.rels and the run
 * only carries a relationship id. Asserting on document.xml alone would prove
 * the citation's TEXT survived while saying nothing about the link.
 */
async function exportedDocx(page: Page): Promise<{ xml: string; rels: string }> {
  await page.getByTestId("toolbar-more").click();
  const download = page.waitForEvent("download", { timeout: 30_000 });
  await page.getByTestId("export-docx").click();
  const file = await download;

  const stream = await file.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  const zip = await JSZip.loadAsync(Buffer.concat(chunks));
  const xml = await zip.file("word/document.xml")!.async("string");
  const rels = (await zip.file("word/_rels/document.xml.rels")?.async("string")) ?? "";
  await page.getByTestId("toolbar-more").click();
  return { xml, rels };
}

test.describe("citing a book from a note", () => {
  test("searches the library, inserts a source, and it survives save, reload and export", async ({
    page,
  }) => {
    const path = await newNote(page);
    await startWriting(page);

    await openSourcePanel(page);
    await page.getByTestId("source-query").fill(SEED_NEEDLE);
    await page.getByTestId("source-search").click();

    const results = page.getByTestId("source-result");
    await expect(results.first()).toBeVisible({ timeout: 30_000 });
    // The snippet must show the phrase highlighted, by the same matcher the
    // rest of the site uses.
    await expect(results.first().locator("mark").first()).toContainText(SEED_NEEDLE);

    await results.first().getByTestId("source-insert").click();

    const body = page.getByTestId("note-body");
    await expect(body.locator("blockquote")).toHaveCount(1);
    const citation = body.locator('a[href^="/books/"]');
    await expect(citation).toHaveCount(1);
    const href = await citation.getAttribute("href");
    expect(href).toMatch(/^\/books\/\d+\/read\?page=\d+/);
    const label = (await citation.textContent()) ?? "";
    expect(label).toContain("«");

    // What was already written must still be there, before the quotation.
    await expect(body).toContainText(BODY_TEXT);

    await expect(page.getByTestId("save-state")).toHaveText("ساقلاندى", { timeout: 25_000 });
    await page.reload();

    const reloaded = page.getByTestId("note-body");
    await expect(reloaded.locator("blockquote")).toHaveCount(1);
    await expect(reloaded.locator(`a[href="${href}"]`)).toHaveCount(1);

    // And the link is real: following it opens the reader at that page.
    const opened = await page.request.get(href!);
    expect(opened.status()).toBe(200);

    const { xml, rels } = await exportedDocx(page);
    expect(xml).toContain(label.trim());
    // And the link is a real Word hyperlink, resolved to an absolute address
    // so it still opens from a file sitting on somebody's desktop.
    const bookPath = href!.split("?")[0];
    expect(rels, "the citation must survive as a hyperlink").toContain(bookPath);
    expect(rels).toContain("http");

    await deleteNote(page, path);
  });

  test("opens the book in a new tab without losing what was written", async ({ page, context }) => {
    const path = await newNote(page);
    await startWriting(page, "ساقلانمىغان يېزىق");

    await openSourcePanel(page);
    await page.getByTestId("source-query").fill(SEED_NEEDLE);
    await page.getByTestId("source-search").click();
    await expect(page.getByTestId("source-result").first()).toBeVisible({ timeout: 30_000 });

    const opened = context.waitForEvent("page");
    await page.getByTestId("source-result").first().getByTestId("source-goto").click();
    const reader = await opened;
    await reader.waitForLoadState("domcontentloaded");
    expect(new URL(reader.url()).pathname).toMatch(/^\/books\/\d+\/read$/);
    await reader.close();

    // The note itself never navigated, so nothing typed was lost.
    await expect(page.getByTestId("note-body")).toContainText("ساقلانمىغان يېزىق");

    await deleteNote(page, path);
  });

  test("pre-fills the query from the note's own selection", async ({ page }) => {
    const path = await newNote(page);
    await startWriting(page, SEED_NEEDLE);
    await page.keyboard.press("Control+A");

    await openSourcePanel(page);
    await expect(page.getByTestId("source-query")).toHaveValue(SEED_NEEDLE);

    await deleteNote(page, path);
  });
});

test.describe("citing a verse from a note", () => {
  test("inserts Arabic, translation and both, and the Arabic survives reload and export", async ({
    page,
  }) => {
    const path = await newNote(page);
    await startWriting(page);

    await openSourcePanel(page);
    await page.getByTestId("source-tab-quran").click();
    await page.getByTestId("aya-sura").fill(String(AYA.sura));
    await page.getByTestId("aya-number-input").fill(String(AYA.aya));
    await page.getByTestId("aya-preview").click();
    await expect(page.getByTestId("aya-preview-box")).toBeVisible({ timeout: 30_000 });

    const body = page.getByTestId("note-body");
    const uthmanic = body.locator('[style*="Uthmanic Hafs"]');

    // Arabic only.
    await page.getByTestId("aya-mode-ar").click();
    await page.getByTestId("aya-insert").click();
    await expect(uthmanic).toHaveCount(1);
    const arabic = ((await uthmanic.first().textContent()) ?? "").trim();
    expect(arabic.startsWith("﴿")).toBe(true);
    expect(arabic.endsWith("﴾")).toBe(true);

    // Translation only — no Arabic added by this one.
    await page.getByTestId("aya-mode-ug").click();
    await page.getByTestId("aya-insert").click();
    await expect(uthmanic).toHaveCount(1);

    // Both.
    await page.getByTestId("aya-mode-both").click();
    await page.getByTestId("aya-insert").click();
    await expect(uthmanic).toHaveCount(2);

    // Every insertion says which verse it is.
    await expect(body.locator(`a[href="/quran/${AYA.sura}?aya=${AYA.aya}"]`)).toHaveCount(3);

    await expect(page.getByTestId("save-state")).toHaveText("ساقلاندى", { timeout: 25_000 });
    await page.reload();

    const reloaded = page.getByTestId("note-body");
    await expect(reloaded.locator('[style*="Uthmanic Hafs"]')).toHaveCount(2);
    await expect(reloaded.locator('[style*="Uthmanic Hafs"]').first()).toHaveText(arabic);

    const { xml } = await exportedDocx(page);
    // The verse itself, its face, and the credit its licence requires.
    expect(xml).toContain(arabic.replace(/^﴿/, "").replace(/﴾$/, "").slice(0, 12));
    expect(xml).toContain("Uthmanic Hafs");
    expect(xml).toContain("Tanzil Project");

    await deleteNote(page, path);
  });

  test("finds a verse by searching the Qur'an text", async ({ page }) => {
    const path = await newNote(page);
    await startWriting(page);

    await openSourcePanel(page);
    await page.getByTestId("source-tab-quran").click();
    await page.getByTestId("quran-source-query").fill("ٱلۡحَمۡدُ");
    await page.getByTestId("quran-source-search").click();

    const hits = page.getByTestId("quran-source-results").locator("li");
    await expect(hits.first()).toBeVisible({ timeout: 30_000 });
    await hits.first().getByTestId("quran-source-insert").click();

    await expect(page.getByTestId("note-body").locator('[style*="Uthmanic Hafs"]')).toHaveCount(1);

    await deleteNote(page, path);
  });
});

test.describe("find and replace", () => {
  test("counts, steps, replaces all, and one undo puts it all back", async ({ page }) => {
    const path = await newNote(page);
    await page.getByTestId("note-body").click();
    await page.keyboard.type("كىتاب بىر");
    await page.keyboard.press("Enter");
    await page.keyboard.type("كىتاب ئىككى");
    await page.keyboard.press("Enter");
    await page.keyboard.type("كىتاب ئۈچ");

    const body = page.getByTestId("note-body");
    const before = await body.innerHTML();

    await page.getByTestId("find-open").click();
    await expect(page.getByTestId("find-bar")).toBeVisible();
    await page.getByTestId("find-input").fill("كىتاب");
    await expect(page.getByTestId("find-count")).toHaveText("1 / 3");

    await page.getByTestId("find-next").click();
    await expect(page.getByTestId("find-count")).toHaveText("2 / 3");
    await page.getByTestId("find-prev").click();
    await expect(page.getByTestId("find-count")).toHaveText("1 / 3");

    await page.getByTestId("find-toggle-replace").click();
    await page.getByTestId("replace-input").fill("دەپتەر");
    await page.getByTestId("replace-all").click();

    await expect(body).toContainText("دەپتەر بىر");
    await expect(body).not.toContainText("كىتاب");
    await expect(page.getByTestId("find-notice")).toContainText("3");

    // ONE undo. A replace-all that cannot be taken back in a single press will
    // eventually destroy somebody's work.
    await body.click();
    await page.keyboard.press("Control+Z");
    await expect(body).not.toContainText("دەپتەر");
    expect(await body.innerHTML()).toBe(before);

    await deleteNote(page, path);
  });

  test("replaces just the current hit", async ({ page }) => {
    const path = await newNote(page);
    await page.getByTestId("note-body").click();
    await page.keyboard.type("كىتاب بىر");
    await page.keyboard.press("Enter");
    await page.keyboard.type("كىتاب ئىككى");

    await page.getByTestId("find-open").click();
    await page.getByTestId("find-input").fill("كىتاب");
    await page.getByTestId("find-toggle-replace").click();
    await page.getByTestId("replace-input").fill("دەپتەر");
    await page.getByTestId("replace-one").click();

    const body = page.getByTestId("note-body");
    await expect(body).toContainText("دەپتەر بىر");
    await expect(body).toContainText("كىتاب ئىككى");

    await deleteNote(page, path);
  });

  test("leaves the saved note free of anything it inserted to show a match", async ({ page }) => {
    const path = await newNote(page);
    await page.getByTestId("note-body").click();
    await page.keyboard.type("كىتاب ئوقۇش");
    await expect(page.getByTestId("save-state")).toHaveText("ساقلاندى", { timeout: 25_000 });

    await page.getByTestId("find-open").click();
    await page.getByTestId("find-input").fill("كىتاب");
    await expect(page.getByTestId("find-count")).toHaveText("1 / 1");

    // Nothing is added to the document to paint a hit — see lib/notes/find.ts.
    await expect(page.locator('[data-testid="note-body"] mark')).toHaveCount(0);

    await deleteNote(page, path);
  });
});

test.describe("typography", () => {
  test("changes the face and the size, and remembers the choice", async ({ page }) => {
    const path = await newNote(page);
    await startWriting(page);

    await page.getByTestId("toolbar-more").click();
    await page.getByTestId("note-font").selectOption("tuzkitab");
    await page.getByTestId("note-size-up").click();
    const size = await page.getByTestId("note-size-value").textContent();

    const style = await page
      .getByTestId("note-body")
      .evaluate((node) => ({
        font: node.style.fontFamily,
        size: node.style.fontSize,
      }));
    expect(style.font).toContain("UKIJ Tuz Kitab");
    expect(style.size).toBe(`${size?.trim()}px`);

    // The choice is the writer's, and it is still theirs after a reload.
    await page.reload();
    await page.getByTestId("toolbar-more").click();
    await expect(page.getByTestId("note-font")).toHaveValue("tuzkitab");
    await expect(page.getByTestId("note-size-value")).toHaveText(size!.trim());

    await deleteNote(page, path);
  });
});

test.describe("on every screen", () => {
  test("the panel and the find bar never cover the editor or trap the page", async ({
    page,
  }, testInfo) => {
    const marker = "ئاخىرقىسۆز";
    const path = await newNote(page);
    await page.getByTestId("note-body").click();
    await page.keyboard.type(`${BODY_TEXT}\n`.repeat(40));
    await page.keyboard.type(marker);

    const width = testInfo.project.use.viewport!.width;
    const overflow = () =>
      page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );

    // The find bar is a row in the header, not a box over the text, so at the
    // top of the document the editor simply starts further down.
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.getByTestId("find-open").click();
    await expect(page.getByTestId("find-bar")).toBeVisible();
    expect(await overflow(), `no horizontal scroll at ${width}px`).toBeLessThanOrEqual(1);

    const header = (await page.getByTestId("note-toolbar").boundingBox())!;
    const editorBox = (await page.getByTestId("note-body").boundingBox())!;
    expect(editorBox.y, "the editor starts below the header").toBeGreaterThanOrEqual(
      header.y + header.height - 1,
    );

    /**
     * And the real guarantee: stepping to a match brings it clear of the
     * sticky header rather than leaving it hiding underneath. The marker sits
     * at the very bottom of a long note, so finding it has to scroll.
     */
    await page.getByTestId("find-input").fill(marker);
    await expect(page.getByTestId("find-count")).toHaveText("1 / 1");
    await page.getByTestId("find-next").click();
    await page.waitForTimeout(600);

    const found = page.getByTestId("note-body").getByText(marker, { exact: false }).last();
    const foundBox = (await found.boundingBox())!;
    const headerNow = (await page.getByTestId("note-toolbar").boundingBox())!;
    expect(foundBox.y, "the match is not hidden under the header").toBeGreaterThanOrEqual(
      headerNow.y + headerNow.height - 1,
    );
    expect(foundBox.y).toBeLessThan(testInfo.project.use.viewport!.height);

    await page.getByTestId("find-close").click();

    await openSourcePanel(page);
    expect(await overflow(), "the drawer must not widen the page").toBeLessThanOrEqual(1);

    // Scrolling inside the drawer must not scroll the page behind it.
    const scrollBefore = await page.evaluate(() => window.scrollY);
    await page.getByTestId("source-panel").hover();
    await page.mouse.wheel(0, 600);
    await page.waitForTimeout(200);
    expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore);

    await page.getByTestId("source-close").click();
    await expect(page.getByTestId("source-panel")).toBeHidden();

    // The page scrolls again, and every control comes back after down-and-up.
    await page.mouse.wheel(0, 4000);
    await page.waitForTimeout(200);
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
    await page.mouse.wheel(0, -6000);
    await page.waitForTimeout(200);
    for (const id of ["notes-back", "note-title", "format-bold", "source-open", "find-open", "toolbar-more"]) {
      await expect(page.getByTestId(id), id).toBeVisible();
    }
    await page.getByTestId("source-open").click();
    await expect(page.getByTestId("source-panel")).toBeVisible();
    await page.getByTestId("source-close").click();

    await deleteNote(page, path);
  });
});
