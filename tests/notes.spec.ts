import { expect, test, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { READER_STATE_PATH, freshPassword, hasStaffTestEnv, loadEnvLocal, testEmail } from "./env";

loadEnvLocal();

test.skip(!hasStaffTestEnv(), "Supabase env not configured");

/** A word the shipped dictionary does not contain, for the spellcheck panel. */
const MISSPELLING = "ئۇيغور";
const BODY_TEXT = "بۇ مېنىڭ سىناق خاتىرەم.";

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
  await page.locator(`[data-testid="note-list"] li`).filter({
    has: page.locator(`a[href="/notes/${id}"]`),
  }).getByTestId("delete-note").click();
  await expect(page.locator(`a[href="/notes/${id}"]`)).toHaveCount(0, { timeout: 20_000 });
}

/**
 * Where the misspelled word is on screen.
 *
 * The marks are painted through the CSS Custom Highlight API, so there is no
 * element to locate — the ranges have to be asked for directly. This is also
 * what proves the underline exists at all: if nothing was painted, there is
 * no box to click.
 */
async function markBox(page: Page, word: string) {
  return page.evaluate((needle) => {
    const highlight = CSS.highlights?.get("bh-spell-error");
    if (!highlight) return null;
    // A Highlight yields AbstractRange; the ones we put in are real Ranges.
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

/** Every word the spellchecker has underlined, in the order it painted them. */
async function markedWords(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const highlight = CSS.highlights?.get("bh-spell-error");
    return highlight ? [...highlight].map((range) => (range as Range).toString()) : [];
  });
}

/**
 * The note's shape with every run of text replaced by «T»: its tags, their
 * nesting and its line breaks, and nothing that was written. A correction may
 * change the words; it must never change this.
 */
async function skeleton(page: Page): Promise<string> {
  return page.getByTestId("note-body").evaluate((editor) => {
    const clone = editor.cloneNode(true) as HTMLElement;
    // A replacement may leave the text in one node or in two side by side;
    // that is not a change anyone can see.
    clone.normalize();
    const walker = document.createTreeWalker(clone, NodeFilter.SHOW_TEXT);
    const texts: Text[] = [];
    for (let node = walker.nextNode(); node; node = walker.nextNode()) texts.push(node as Text);
    for (const text of texts) text.data = "T";
    return clone.innerHTML;
  });
}

/** What the writer sees, one entry per non-empty line. */
async function noteLines(page: Page): Promise<string[]> {
  return page.getByTestId("note-body").evaluate((editor) =>
    (editor as HTMLElement).innerText
      .replace(/ /g, " ")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean),
  );
}

/** Switch the spellchecker on and wait for the dictionary. */
async function spellcheckOn(page: Page) {
  await page.getByTestId("spell-toggle").click();
  // The dictionary is 667 KB over the wire and unpacks in the worker.
  await expect(page.getByTestId("spell-summary")).toBeVisible({ timeout: 90_000 });
}

/** Wait for a word's underline, then tap it and wait for its popup. */
async function tapMarked(page: Page, word: string) {
  await expect.poll(() => markBox(page, word), { timeout: 30_000 }).not.toBeNull();
  const box = (await markBox(page, word))!;
  await page.mouse.click(box.x, box.y);
  await expect(page.getByTestId("spell-popup")).toBeVisible({ timeout: 30_000 });
}

test.describe("notebook", () => {
  test("writes, formats and saves, and the text survives a reload", async ({ page }) => {
    const path = await newNote(page);

    await page.getByTestId("note-title").fill("سىناق خاتىرىسى");
    const body = page.getByTestId("note-body");
    await body.click();
    await page.keyboard.type(BODY_TEXT);

    // Select what was typed, then bold it through the toolbar.
    await page.keyboard.press("Control+A");
    await page.getByTestId("format-bold").click();

    await expect(page.getByTestId("save-state")).toHaveText("ساقلاندى", { timeout: 20_000 });

    await page.reload();
    await expect(page.getByTestId("note-body")).toContainText(BODY_TEXT);
    // The bold has to have reached the database, not just the DOM.
    await expect(page.locator('[data-testid="note-body"] b, [data-testid="note-body"] strong'))
      .toHaveCount(1);
    await expect(page.getByTestId("note-title")).toHaveValue("سىناق خاتىرىسى");

    // The list shows it, with the title it was given.
    await page.goto("/notes");
    await expect(page.getByTestId("note-list")).toContainText("سىناق خاتىرىسى");

    await deleteNote(page, path);
  });

  test("a heading survives the round trip too", async ({ page }) => {
    const path = await newNote(page);
    await page.getByTestId("note-body").click();
    await page.keyboard.type("ماۋزۇ قۇرى");
    await page.keyboard.press("Control+A");
    await page.getByTestId("format-heading").click();
    await expect(page.getByTestId("save-state")).toHaveText("ساقلاندى", { timeout: 20_000 });

    await page.reload();
    await expect(page.locator('[data-testid="note-body"] h2')).toContainText("ماۋزۇ قۇرى");

    await deleteNote(page, path);
  });

  test("the toolbar stays put and nothing scrolls sideways", async ({ page }, testInfo) => {
    const path = await newNote(page);
    await page.getByTestId("note-body").click();
    // Enough text to make the page scroll at every viewport height.
    await page.keyboard.type(`${BODY_TEXT}\n`.repeat(40));

    const width = testInfo.project.use.viewport!.width;
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, `no horizontal scroll at ${width}px`).toBeLessThanOrEqual(1);

    // Scroll down, then back up: the mobile rule is that every control is still
    // there and tappable afterwards.
    await page.mouse.wheel(0, 4000);
    await page.waitForTimeout(200);
    await expect(page.getByTestId("note-toolbar")).toBeInViewport();
    await expect(page.getByTestId("format-bold")).toBeVisible();

    await page.mouse.wheel(0, -6000);

    await page.waitForTimeout(200);
    for (const id of ["notes-back", "note-title", "format-bold", "toolbar-more", "spell-toggle"]) {
      await expect(page.getByTestId(id), id).toBeVisible();
    }
    // Still clickable, not merely painted.
    await page.getByTestId("toolbar-more").click();
    await expect(page.getByTestId("toolbar-overflow")).toBeVisible();

    await deleteNote(page, path);
  });

  test("exports a Word file", async ({ page }) => {
    const path = await newNote(page);
    await page.getByTestId("note-body").click();
    await page.keyboard.type(BODY_TEXT);
    await page.getByTestId("note-title").fill("چىقىرىش سىنىقى");

    await page.getByTestId("toolbar-more").click();
    const download = page.waitForEvent("download", { timeout: 30_000 });
    await page.getByTestId("export-docx").click();
    const file = await download;

    expect(file.suggestedFilename()).toMatch(/\.docx$/);
    const stream = await file.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);
    const bytes = Buffer.concat(chunks);
    expect(bytes.length).toBeGreaterThan(1000);
    // Every .docx is a zip; "PK" is the signature Word looks for.
    expect(bytes.subarray(0, 2).toString("latin1")).toBe("PK");

    await deleteNote(page, path);
  });

  test("underlines a misspelled word in place and corrects it from the popup", async ({
    page,
  }) => {
    const path = await newNote(page);
    await page.getByTestId("note-body").click();
    await page.keyboard.type(`بۇ ${MISSPELLING} دېگەن سۆز خاتا.`);

    await page.getByTestId("spell-toggle").click();
    // The dictionary is 667 KB over the wire and unpacks in the worker.
    await expect(page.getByTestId("spell-summary")).toBeVisible({ timeout: 90_000 });

    // The word is marked in the text itself, not listed in a panel.
    await expect
      .poll(() => markBox(page, MISSPELLING), { timeout: 30_000 })
      .not.toBeNull();
    const box = (await markBox(page, MISSPELLING))!;

    await page.mouse.click(box.x, box.y);
    const popup = page.getByTestId("spell-popup");
    await expect(popup).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("spell-popup-word")).toHaveText(MISSPELLING);
    await expect(page.getByTestId("spell-suggestion").first()).toContainText("ئۇيغۇر", {
      timeout: 30_000,
    });

    // Anchored at the word and clear of the toolbar — the rule that matters on
    // a phone, where the popup used to have nowhere to go.
    const popupBox = (await popup.boundingBox())!;
    const toolbar = (await page.getByTestId("note-toolbar").boundingBox())!;
    expect(popupBox.y, "popup must sit below the toolbar").toBeGreaterThanOrEqual(
      toolbar.y + toolbar.height,
    );
    const viewport = page.viewportSize()!;
    expect(popupBox.y + popupBox.height, "popup must be fully on screen").toBeLessThanOrEqual(
      viewport.height + 1,
    );

    // Choosing a correction replaces that word and nothing else.
    await page.getByTestId("spell-suggestion").first().click();
    await expect(page.getByTestId("note-body")).toContainText("ئۇيغۇر");
    await expect(page.getByTestId("note-body")).not.toContainText(MISSPELLING);
    await expect(popup).toHaveCount(0);

    await deleteNote(page, path);
  });

  /**
   * The two errors that started this work.
   *
   * Neither intended word was in the shipped dictionary, so no edit-distance
   * search could ever have reached them. They arrive by different routes and
   * that is the point: «قالدۇرمىغۇدەك» is found by correcting the STEM and
   * putting the suffix back, «تەۋەلەنگەن» by correcting the SUFFIX and leaving
   * the stem alone. Asserted through the real UI because the unit tests
   * exercise the ranking, not the worker, the popup, or the trip between them.
   */
  for (const [typed, intended] of [
    ["تەۋەلىنگەن", "تەۋەلەنگەن"],
    ["قالدورمىغۇدەك", "قالدۇرمىغۇدەك"],
  ]) {
    test(`offers ${intended} first for ${typed}`, async ({ page }) => {
      const path = await newNote(page);
      await page.getByTestId("note-body").click();
      await page.keyboard.type(`بۇ ${typed} دېگەن سۆز.`);

      await page.getByTestId("spell-toggle").click();
      await expect(page.getByTestId("spell-summary")).toBeVisible({ timeout: 90_000 });
      await expect.poll(() => markBox(page, typed), { timeout: 30_000 }).not.toBeNull();

      const box = (await markBox(page, typed))!;
      await page.mouse.click(box.x, box.y);
      await expect(page.getByTestId("spell-popup")).toBeVisible({ timeout: 30_000 });

      // The word lives in its own span; the row also carries the «ئەڭ يېقىن»
      // badge, which the popup only renders on the top-ranked suggestion. Both
      // are asserted: the first one for the word, the second because it is what
      // proves the ranking put it first rather than merely somewhere in view.
      const top = page.getByTestId("spell-suggestion").first();
      await expect(top.locator("span").first()).toHaveText(intended, { timeout: 30_000 });
      await expect(top).toContainText("ئەڭ يېقىن");

      // Taking it replaces that word and nothing else.
      await page.getByTestId("spell-suggestion").first().click();
      await expect(page.getByTestId("note-body")).toContainText(intended);
      await expect(page.getByTestId("note-body")).not.toContainText(typed);

      await deleteNote(page, path);
    });
  }

  test("adding a word to the personal dictionary clears its underline", async ({ page }) => {
    const path = await newNote(page);
    await page.getByTestId("note-body").click();
    await page.keyboard.type(`بۇ ${MISSPELLING} دېگەن سۆز.`);

    await page.getByTestId("spell-toggle").click();
    await expect(page.getByTestId("spell-summary")).toBeVisible({ timeout: 90_000 });
    await expect.poll(() => markBox(page, MISSPELLING), { timeout: 30_000 }).not.toBeNull();

    const box = (await markBox(page, MISSPELLING))!;
    await page.mouse.click(box.x, box.y);
    await expect(page.getByTestId("spell-popup")).toBeVisible({ timeout: 30_000 });

    await page.getByTestId("spell-popup-add").click();
    // The mark goes immediately, and the word itself stays in the text.
    await expect.poll(() => markBox(page, MISSPELLING), { timeout: 15_000 }).toBeNull();
    await expect(page.getByTestId("note-body")).toContainText(MISSPELLING);

    await deleteNote(page, path);
  });
});

/**
 * Line ends and the spellchecker (PROMPT-42).
 *
 * The owner's report of 2026-10-07: a misspelled word at the end of a line,
 * Enter, a word on the next line — the popup showed the two as one glued word,
 * and taking its suggestion deleted the next line's word together with the
 * line break (N1). And a tap made just after typing could put a correction on
 * the wrong letters (N8). Every word here is invented test text; the ones used
 * as "correct" were checked against the shipped dictionary first, and are
 * checked again in place below.
 */
test.describe("the spellchecker at line ends", () => {
  const FIRST_LINE = "ئۇسۇلى بىلەن سىلىشتۇرسۇ";
  const MISSPELLED = "سىلىشتۇرسۇ";
  const SECOND_LINE = "كىشىلەر ياخشى";

  // Shift+Enter is a <br> in Chromium and Firefox; Playwright's WebKit makes
  // it a new paragraph. Either way it is a line end, and either way the line
  // after it must survive the correction.
  for (const key of ["Enter", "Shift+Enter"]) {
    test(`corrects the last word before ${key} and leaves the next line alone`, async ({
      page,
    }) => {
      const path = await newNote(page);
      try {
        await page.getByTestId("note-body").click();
        await page.keyboard.type(FIRST_LINE);
        await page.keyboard.press(key);
        await page.keyboard.type(SECOND_LINE);
        expect(await noteLines(page)).toEqual([FIRST_LINE, SECOND_LINE]);
        const shape = await skeleton(page);

        await spellcheckOn(page);
        // The underline covers the misspelled word alone — never it and the
        // next line's first word glued together.
        await tapMarked(page, MISSPELLED);
        await expect(page.getByTestId("spell-popup-word")).toHaveText(MISSPELLED);

        const top = page.getByTestId("spell-suggestion").first();
        await expect(top).toBeVisible({ timeout: 30_000 });
        const replacement = (await top.locator("span").first().innerText()).trim();
        expect(replacement).not.toBe("");
        await top.click();
        await expect(page.getByTestId("spell-popup")).toHaveCount(0);

        await expect
          .poll(() => noteLines(page))
          .toEqual([`ئۇسۇلى بىلەن ${replacement}`, SECOND_LINE]);
        // The same blocks and the same line breaks: only the word changed.
        expect(await skeleton(page)).toBe(shape);
      } finally {
        await deleteNote(page, path);
      }
    });
  }

  /** Correct on their own, wrong when glued — measured on the shipped dictionary. */
  const APPLE = "ئالما";
  const APRICOT = "ئۆرۈك";
  /**
   * Misspelled, and typed LAST: a check that has underlined it has read every
   * line above it, so "nothing else is underlined" is a finished answer, not
   * an early look at a check still in flight.
   */
  const SENTINEL = "ئۇيغور";

  const layouts: [label: string, write: (page: Page) => Promise<void>][] = [
    [
      "two lines split by Enter",
      async (page) => {
        await page.keyboard.type(APPLE);
        await page.keyboard.press("Enter");
        await page.keyboard.type(APRICOT);
        await page.keyboard.press("Enter");
        await page.keyboard.type(SENTINEL);
      },
    ],
    [
      "a heading followed by a paragraph",
      async (page) => {
        await page.keyboard.type(APPLE);
        await page.keyboard.press("Control+A");
        await page.getByTestId("format-heading").click();
        await page.keyboard.press("End");
        await page.keyboard.press("Enter");
        await page.keyboard.type(APRICOT);
        await page.keyboard.press("Enter");
        await page.keyboard.type(SENTINEL);
        await expect(page.locator('[data-testid="note-body"] h2')).toHaveText(APPLE);
      },
    ],
  ];

  for (const [label, write] of layouts) {
    test(`underlines nothing across ${label}`, async ({ page }) => {
      const path = await newNote(page);
      try {
        const body = page.getByTestId("note-body");
        await body.click();

        // First, in place: both words are correct on one line, beside a
        // misspelling that proves the check has run.
        await page.keyboard.type(`${APPLE} ${APRICOT} ${SENTINEL}`);
        await spellcheckOn(page);
        await expect.poll(() => markBox(page, SENTINEL), { timeout: 30_000 }).not.toBeNull();
        expect(await markedWords(page)).toEqual([SENTINEL]);

        // Then on separate lines. The toggle took the focus; give it back first.
        await body.focus();
        await page.keyboard.press("Control+A");
        await page.keyboard.press("Delete");
        await write(page);
        expect(await noteLines(page)).toEqual([APPLE, APRICOT, SENTINEL]);

        await expect.poll(() => markedWords(page), { timeout: 30_000 }).toEqual([SENTINEL]);
        await expect(page.getByTestId("spell-summary")).toContainText("ئىملا: 1 خاتالىق");

        // With the misspelling accepted, the note has no errors at all.
        await tapMarked(page, SENTINEL);
        await page.getByTestId("spell-popup-add").click();
        await expect(page.getByTestId("spell-summary")).toContainText("ئىملا: خاتالىق يوق");
        expect(await markedWords(page)).toEqual([]);
      } finally {
        await deleteNote(page, path);
      }
    });
  }

  test("a tap right after typing opens, and corrects, the word that is there now", async ({
    page,
  }) => {
    const path = await newNote(page);
    try {
      const body = page.getByTestId("note-body");
      await body.click();
      await page.keyboard.type(`بۇ ${SENTINEL} دېگەن سۆز`);
      await spellcheckOn(page);
      await expect.poll(() => markBox(page, SENTINEL), { timeout: 30_000 }).not.toBeNull();

      // Two letters at the very start of the same line, ahead of the marked
      // word: every offset after them moves by two, and the next check is
      // still 450 ms away.
      await body.evaluate((editor) => {
        const first = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT).nextNode()!;
        const caret = document.createRange();
        caret.setStart(first, 0);
        caret.collapse(true);
        const selection = getSelection()!;
        selection.removeAllRanges();
        selection.addRange(caret);
      });
      await page.keyboard.type("ۋە");
      const typed = Date.now();
      // The painted range moved with the text, so this is where the word is now.
      const box = (await markBox(page, SENTINEL))!;
      await page.mouse.click(box.x, box.y);
      expect(Date.now() - typed, "the tap must land before the debounced check").toBeLessThan(450);

      await expect(page.getByTestId("spell-popup")).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId("spell-popup-word")).toHaveText(SENTINEL);
      const top = page.getByTestId("spell-suggestion").first();
      await expect(top).toBeVisible({ timeout: 30_000 });
      const replacement = (await top.locator("span").first().innerText()).trim();
      await top.click();

      // Only that word changed: the two new letters and everything else stay.
      await expect.poll(() => noteLines(page)).toEqual([`ۋەبۇ ${replacement} دېگەن سۆز`]);
    } finally {
      await deleteNote(page, path);
    }
  });

  test("«لۇغەتكە قوش» on the last word of a line stores exactly that word", async ({ page }) => {
    const path = await newNote(page);
    try {
      await page.getByTestId("note-body").click();
      await page.keyboard.type(FIRST_LINE);
      await page.keyboard.press("Enter");
      await page.keyboard.type(SECOND_LINE);

      const read = () =>
        page.evaluate(
          () => JSON.parse(localStorage.getItem("bh-personal-dictionary") ?? "[]") as string[],
        );
      const before = await read();

      await spellcheckOn(page);
      await tapMarked(page, MISSPELLED);
      await expect(page.getByTestId("spell-popup-word")).toHaveText(MISSPELLED);
      await page.getByTestId("spell-popup-add").click();
      await expect.poll(() => markBox(page, MISSPELLED), { timeout: 15_000 }).toBeNull();

      expect(await read()).toEqual([...before, MISSPELLED]);
      expect(await noteLines(page)).toEqual([FIRST_LINE, SECOND_LINE]);
    } finally {
      await deleteNote(page, path);
    }
  });

  test("nothing scrolls sideways, and every control and popup button stays reachable", async ({
    page,
  }, testInfo) => {
    const path = await newNote(page);
    try {
      const body = page.getByTestId("note-body");
      await body.click();
      await page.keyboard.type(FIRST_LINE);
      await page.keyboard.press("Enter");
      // Enough lines to make the page scroll at every viewport height.
      await page.keyboard.type(`${SECOND_LINE}\n`.repeat(30));
      await spellcheckOn(page);
      await expect.poll(() => markBox(page, MISSPELLED), { timeout: 30_000 }).not.toBeNull();

      const overflow = () =>
        page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
      const viewport = testInfo.project.use.viewport!;
      expect(await overflow(), `no horizontal scroll at ${viewport.width}px`).toBeLessThanOrEqual(1);
      // Phones: the narrowest screen the site promises, too.
      if (viewport.width < 768) {
        await page.setViewportSize({ width: 360, height: viewport.height });
        expect(await overflow(), "no horizontal scroll at 360px").toBeLessThanOrEqual(1);
      }

      await page.mouse.wheel(0, 4000);

      await page.waitForTimeout(200);
      await expect(page.getByTestId("note-toolbar")).toBeInViewport();
      await page.mouse.wheel(0, -6000);
      await page.waitForTimeout(200);
      for (const id of ["notes-back", "note-title", "format-bold", "toolbar-more", "spell-toggle"]) {
        await expect(page.getByTestId(id), id).toBeVisible();
      }

      await tapMarked(page, MISSPELLED);
      await expect(page.getByTestId("spell-suggestion").first()).toBeVisible({ timeout: 30_000 });
      expect(await overflow(), "no horizontal scroll with the popup open").toBeLessThanOrEqual(1);

      for (const button of [
        page.getByTestId("spell-suggestion").first(),
        page.getByTestId("spell-popup-add"),
        page.getByTestId("spell-popup-close"),
      ]) {
        await expect(button).toBeInViewport({ ratio: 1 });
        const box = (await button.boundingBox())!;
        expect(box.height, "a touch target is at least 44 px tall").toBeGreaterThanOrEqual(44);
        // Nothing — no bar, no other layer — sits on top of it.
        const onTop = await button.evaluate((element) => {
          const rect = element.getBoundingClientRect();
          const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
          return hit !== null && element.contains(hit);
        });
        expect(onTop).toBe(true);
      }

      // And it is tappable, not merely painted.
      await page.getByTestId("spell-popup-close").click();
      await expect(page.getByTestId("spell-popup")).toHaveCount(0);
    } finally {
      await deleteNote(page, path);
    }
  });
});

/**
 * The bug this exists for: «يېڭى خاتىرە» answered 500 in production while every
 * local test passed. The tests were wrong, not lucky — they all ran against an
 * account the suite had already used, and they all ran against `next dev`.
 *
 * So this one signs in as an account created seconds ago that has never held a
 * note, and walks the whole first-run path: press the button, land in the
 * editor, type, reload, and find the writing still there.
 */
test.describe("a brand-new account's first note", () => {
  // Its own session, not the shared signed-in state every other spec reuses.
  test.use({ storageState: { cookies: [], origins: [] } });

  const admin = () =>
    createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false } },
    );

  test("creates, opens and keeps a note", async ({ page }, testInfo) => {
    const email = testEmail(`fresh-${testInfo.project.name}-${Date.now()}`);
    const password = freshPassword();
    const supabase = admin();

    const { data: created, error } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (error || !created.user) throw new Error(`could not create a fresh user: ${error?.message}`);

    try {
      await page.goto("/login");
      await page.locator('input[name="email"]').fill(email);
      await page.locator('input[name="password"]').fill(password);
      await page.getByRole("button", { name: "كىرىش" }).click();
      await expect(page.getByRole("button", { name: /چىقىش/ })).toBeVisible({ timeout: 20_000 });

      // An empty notebook, which is the state the bug happened in.
      await page.goto("/notes");
      await expect(page.getByTestId("notes-empty")).toBeVisible({ timeout: 20_000 });

      await page.getByTestId("new-note").click();

      // No server error screen — the exact failure being guarded against.
      await expect(page.locator("body")).not.toContainText("A server error occurred");
      await expect(page.getByTestId("notes-error-retry")).toHaveCount(0);

      await expect(page).toHaveURL(/\/notes\/\d+$/, { timeout: 20_000 });
      const editor = page.getByTestId("note-body");
      await expect(editor).toBeVisible();

      // And it saves, which needs the sanitizer the same module used to break on.
      await editor.click();
      await page.keyboard.type("تۇنجى خاتىرەم.");
      await expect(page.getByTestId("save-state")).toHaveText("ساقلاندى", { timeout: 20_000 });

      const path = new URL(page.url()).pathname;
      await page.reload();
      await expect(page.getByTestId("note-body")).toContainText("تۇنجى خاتىرەم.");

      // It is really in the database, not just in the tab.
      const { count } = await supabase
        .from("note_documents")
        .select("id", { count: "exact", head: true })
        .eq("user_id", created.user.id);
      expect(count).toBe(1);

      // Nobody else can open it, however new it is.
      const other = await page.context().browser()!.newContext({ storageState: READER_STATE_PATH });
      const otherPage = await other.newPage();
      const response = await otherPage.goto(path);
      expect(response?.status()).toBe(404);
      await expect(otherPage.locator("body")).not.toContainText("تۇنجى خاتىرەم.");
      await other.close();
    } finally {
      await supabase.auth.admin.deleteUser(created.user.id);
    }
  });
});

test.describe("who may read a note", () => {
  test("an anonymous visitor is sent to sign in", async ({ browser }) => {
    const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const page = await context.newPage();
    await page.goto("/notes");
    await expect(page).toHaveURL(/\/login/);
    await context.close();
  });

  test("the notebook link is hidden until you have an account", async ({ browser }) => {
    const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const page = await context.newPage();
    await page.goto("/");
    await expect(page.getByTestId("notes-link")).toHaveCount(0);
    await expect(page.getByTestId("notes-sidebar-link")).toHaveCount(0);
    await context.close();
  });

  test("one signed-in user cannot open another's note", async ({ page, browser }) => {
    const path = await newNote(page);
    await page.getByTestId("note-body").click();
    await page.keyboard.type("مەخپىي مەزمۇن");
    await expect(page.getByTestId("save-state")).toHaveText("ساقلاندى", { timeout: 20_000 });

    // A different real account, not a logged-out one: this is the case RLS is
    // actually there for.
    const other = await browser.newContext({ storageState: READER_STATE_PATH });
    const otherPage = await other.newPage();
    const response = await otherPage.goto(path);
    expect(response?.status()).toBe(404);
    await expect(otherPage.locator("body")).not.toContainText("مەخپىي مەزمۇن");
    // And their own notebook is empty — they see none of it in the list.
    await otherPage.goto("/notes");
    await expect(otherPage.getByTestId("notes-empty")).toBeVisible();
    await other.close();

    await deleteNote(page, path);
  });
});
