import { expect, test, type Page } from "@playwright/test";
import { hasStaffTestEnv, loadEnvLocal } from "./env";
import { geminiCalls, installGeminiMock, setGeminiBehaviour } from "./fixtures/gemini-mock";
// The real obfuscation, so a test never reimplements it and drifts.
import { obfuscateKey } from "../lib/ai/storage";

loadEnvLocal();

test.skip(!hasStaffTestEnv(), "Supabase env not configured");

const KEY_1 = "AIzaNotebookKeyOne000000000000001";

const AI_STORAGE_KEYS = [
  "bh-ai-enabled",
  "bh-ai-keys",
  "bh-ai-model",
  "bh-ai-last-good-slot",
  "bh-ai-usage",
];

/** A word the shipped dictionary does not contain, for the offline checker. */
const MISSPELLING = "ئۇيغور";

/**
 * Where a spellchecker mark is on screen.
 *
 * The marks are CSS Custom Highlight ranges, not elements — there is nothing
 * in the DOM to select — so this measures them the same way notes.spec.ts
 * does. Copied rather than shared because a spec that reaches into another
 * spec's helpers couples two files that should be able to change apart.
 */
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

async function assertNoHorizontalOverflow(page: Page) {
  const metrics = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(metrics.scrollWidth, "page must not scroll horizontally").toBeLessThanOrEqual(
    metrics.innerWidth + 1,
  );
}

async function topMostTestIdAt(page: Page, testId: string): Promise<string | null> {
  const box = await page.getByTestId(testId).boundingBox();
  expect(box, `${testId} must have a box`).not.toBeNull();
  return page.evaluate(
    ([x, y]) => {
      const element = document.elementFromPoint(x, y);
      return element?.closest("[data-testid]")?.getAttribute("data-testid") ?? null;
    },
    [box!.x + box!.width / 2, box!.y + box!.height / 2] as const,
  );
}

/** Switch AI on for this browser, exactly as the settings screen would. */
async function enableAi(page: Page) {
  const slots = JSON.stringify([obfuscateKey(KEY_1), "", "", ""]);
  await page.addInitScript(
    ({ slots: stored, storageKeys }: { slots: string; storageKeys: string[] }) => {
      try {
        for (const key of storageKeys) localStorage.removeItem(key);
        localStorage.setItem("bh-ai-enabled", "1");
        localStorage.setItem("bh-ai-keys", stored);
      } catch {
        // A browser blocking storage has nothing to set up.
      }
    },
    { slots, storageKeys: AI_STORAGE_KEYS },
  );
}

async function clearAi(page: Page) {
  await page.addInitScript((storageKeys: string[]) => {
    try {
      for (const key of storageKeys) localStorage.removeItem(key);
    } catch {
      // Nothing to clear.
    }
  }, AI_STORAGE_KEYS);
}

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

async function type(page: Page, text: string) {
  const body = page.getByTestId("note-body");
  await body.click();
  await page.keyboard.type(text);
}

async function openAi(page: Page) {
  await page.getByTestId("notes-ai-toggle").click();
  await expect(page.getByTestId("notes-ai-panel")).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await installGeminiMock(page);
});

/* ── Nobody is shown AI who did not ask for it ───────────────────────────── */

test.describe("a writer who has not enabled AI", () => {
  test("finds no AI control in the notebook, and is not asked to turn it on", async ({ page }) => {
    await clearAi(page);
    const path = await newNote(page);
    await type(page, "بۇ مېنىڭ خاتىرەم.");

    await expect(page.getByTestId("notes-ai-toggle")).toHaveCount(0);
    await expect(page.getByTestId("notes-ai-panel")).toHaveCount(0);
    // The offline spellchecker is a different thing and is still right there.
    await expect(page.getByTestId("spell-toggle")).toBeVisible();
    await assertNoHorizontalOverflow(page);

    await deleteNote(page, path);
  });
});

/* ── The offline spellchecker is untouched ───────────────────────────────── */

test.describe("the offline spellchecker", () => {
  for (const withAi of [false, true]) {
    test(`still underlines and still suggests, with AI ${withAi ? "on" : "off"}`, async ({
      page,
    }) => {
      if (withAi) await enableAi(page);
      else await clearAi(page);
      const path = await newNote(page);
      await type(page, `بۇ ${MISSPELLING} دېگەن سۆز خاتا.`);

      await page.getByTestId("spell-toggle").click();
      // The dictionary is 667 KB over the wire and unpacks in the worker.
      await expect(page.getByTestId("spell-summary")).toBeVisible({ timeout: 90_000 });

      // Still underlined in place…
      await expect.poll(() => markBox(page, MISSPELLING), { timeout: 30_000 }).not.toBeNull();
      const box = (await markBox(page, MISSPELLING))!;

      // …and still offering a correction, which is the half that matters.
      await page.mouse.click(box.x, box.y);
      await expect(page.getByTestId("spell-popup")).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId("spell-suggestion").first()).toContainText("ئۇيغۇر", {
        timeout: 30_000,
      });

      await deleteNote(page, path);
    });
  }
});

/* ── What is about to be sent ────────────────────────────────────────────── */

test.describe("before anything leaves the browser", () => {
  test("says whether the selection or the whole note is going, and how big", async ({ page }) => {
    await enableAi(page);
    const path = await newNote(page);
    await type(page, "بىرىنچى ئابزاس.");

    await openAi(page);
    const scope = page.getByTestId("notes-ai-scope");
    await expect(scope).toContainText("پۈتۈن خاتىرە");
    await expect(scope).toContainText("ھەرپ");

    // Warned, once, before the first thing is sent.
    const notice = page.getByTestId("notes-ai-notice");
    await expect(notice).toBeVisible();
    await expect(notice).toContainText("Google غا");
    await expect(notice).toContainText("ئادەم");
    await expect(notice.getByRole("link")).toHaveAttribute("href", "/my/ai");
    await page.getByTestId("notes-ai-notice-dismiss").click();
    await expect(notice).toHaveCount(0);

    // Select part of it, and the panel says THAT is what goes.
    await page.getByTestId("notes-ai-close").click();
    await page.getByTestId("note-body").click();
    await page.keyboard.press("Control+A");
    await openAi(page);
    await expect(page.getByTestId("notes-ai-scope")).toContainText("تاللانغان بۆلەك");

    await expect(page.getByTestId("notes-ai-disclaimer")).toContainText("خاتا بولۇشى مۇمكىن");
    await assertNoHorizontalOverflow(page);
    await deleteNote(page, path);
  });

  test("refuses a note too long to translate, and offers the selection", async ({ page }) => {
    await enableAi(page);
    const path = await newNote(page);

    // Past the one-request output budget, written straight into the editor —
    // typing 7,000 characters would take longer than the test is worth.
    await page.getByTestId("note-body").click();
    await page.evaluate(() => {
      const body = document.querySelector('[data-testid="note-body"]') as HTMLElement;
      body.innerHTML = `<div>${"ئا".repeat(7000)}</div>`;
      body.dispatchEvent(new Event("input", { bubbles: true }));
    });

    await openAi(page);
    await page.getByTestId("notes-ai-tab-translate").click();
    await page.getByTestId("notes-ai-translate-uy-ar").click();

    const error = page.getByTestId("notes-ai-error");
    await expect(error).toBeVisible();
    await expect(error).toContainText("بەك ئۇزۇن");
    await expect(error).toContainText("خاتىرىڭىز ئۆزگەرتىلمىدى");
    await expect(error).toContainText("تاللاپ");
    // Uyghur, not a raw API string.
    expect(await error.innerText()).not.toMatch(/[A-Za-z]{5,}/);

    // Nothing was sent, and nothing was truncated behind the writer's back.
    expect(await geminiCalls(page)).toEqual([]);
    await deleteNote(page, path);
  });
});

/* ── Chat ────────────────────────────────────────────────────────────────── */

test.describe("asking a question", () => {
  test("streams, cancels cleanly, and inserts at the caret when asked", async ({ page }) => {
    await enableAi(page);
    const path = await newNote(page);
    await type(page, "باشلىنىش.");

    await openAi(page);
    await page.getByTestId("notes-ai-notice-dismiss").click();

    // Cancelling first: a stopped answer leaves nothing behind.
    await setGeminiBehaviour(page, {
      [KEY_1]: { kind: "ok", chunks: ["بىر ", "ئىككى ", "ئۈچ ", "تۆت"], delayMs: 400 },
    });
    await page.getByTestId("notes-ai-input").fill("سوئال");
    await page.getByTestId("notes-ai-send").click();
    await expect(page.getByTestId("notes-ai-streaming-reply")).toContainText("بىر");
    await page.getByTestId("notes-ai-stop").click();
    await expect(page.getByTestId("notes-ai-streaming-reply")).toHaveCount(0);
    await expect(page.getByTestId("notes-ai-reply")).toHaveCount(0);

    // Then a real answer, and the writer chooses to put it in the note.
    await setGeminiBehaviour(page, { [KEY_1]: { kind: "ok", chunks: ["قىستۇرۇلىدىغان جاۋاب"] } });
    await page.getByTestId("notes-ai-input").fill("يەنە بىر سوئال");
    await page.getByTestId("notes-ai-send").click();
    await expect(page.getByTestId("notes-ai-reply")).toContainText("قىستۇرۇلىدىغان جاۋاب");

    // Nothing has entered the note yet — that is the rule.
    await expect(page.getByTestId("note-body")).not.toContainText("قىستۇرۇلىدىغان جاۋاب");

    await page.getByTestId("notes-ai-chat-insert").click();
    await expect(page.getByTestId("note-body")).toContainText("قىستۇرۇلىدىغان جاۋاب");
    // And it reached the database, so the panel did not bypass autosave.
    await expect(page.getByTestId("save-state")).toHaveText("ساقلاندى", { timeout: 20_000 });
    await page.reload();
    await expect(page.getByTestId("note-body")).toContainText("قىستۇرۇلىدىغان جاۋاب");

    await deleteNote(page, path);
  });
});

/* ── Proofreading ────────────────────────────────────────────────────────── */

test.describe("proofreading", () => {
  test("shows a diff, applies in one tap and undoes in one tap", async ({ page }) => {
    await enableAi(page);
    const path = await newNote(page);
    await type(page, "بىرىنچى ئابزاس");

    await openAi(page);
    await page.getByTestId("notes-ai-notice-dismiss").click();
    await page.getByTestId("notes-ai-tab-proofread").click();

    // It is labelled as the ONLINE one, beside the offline checker.
    await expect(page.getByTestId("notes-ai-panel")).toContainText("تور ئارقىلىق");

    await setGeminiBehaviour(page, {
      [KEY_1]: { kind: "ok", chunks: ["⟦1⟧ بىرىنچى ئابزاس."] },
    });
    await page.getByTestId("notes-ai-proofread-run").click();

    const diff = page.getByTestId("notes-ai-diff");
    await expect(diff).toBeVisible();
    await expect(diff).toContainText("بىرىنچى ئابزاس.");
    // Still untouched while the diff is on screen.
    await expect(page.getByTestId("note-body")).not.toContainText("بىرىنچى ئابزاس.");

    await page.getByTestId("notes-ai-proofread-apply").click();
    await expect(page.getByTestId("note-body")).toContainText("بىرىنچى ئابزاس.");

    // One tap back, and the document is exactly as it was.
    await page.getByTestId("notes-ai-proofread-undo").click();
    const afterUndo = await page.getByTestId("note-body").innerText();
    expect(afterUndo.trim()).toBe("بىرىنچى ئابزاس");

    await deleteNote(page, path);
  });

  test("rejecting leaves the document byte-identical", async ({ page }) => {
    await enableAi(page);
    const path = await newNote(page);
    await type(page, "ئۆزگەرمەيدىغان ئابزاس");

    const before = await page.getByTestId("note-body").innerHTML();

    await openAi(page);
    await page.getByTestId("notes-ai-notice-dismiss").click();
    await page.getByTestId("notes-ai-tab-proofread").click();
    await setGeminiBehaviour(page, {
      [KEY_1]: { kind: "ok", chunks: ["⟦1⟧ ئۆزگەرمەيدىغان ئابزاس."] },
    });
    await page.getByTestId("notes-ai-proofread-run").click();
    await expect(page.getByTestId("notes-ai-diff")).toBeVisible();

    await page.getByTestId("notes-ai-proofread-reject").click();
    await expect(page.getByTestId("notes-ai-diff")).toHaveCount(0);
    expect(await page.getByTestId("note-body").innerHTML()).toBe(before);

    await deleteNote(page, path);
  });

  test("a malformed reply changes nothing and says so in Uyghur", async ({ page }) => {
    await enableAi(page);
    const path = await newNote(page);
    await type(page, "بىرىنچى");
    await page.keyboard.press("Enter");
    await page.keyboard.type("ئىككىنچى");

    const before = await page.getByTestId("note-body").innerHTML();

    await openAi(page);
    await page.getByTestId("notes-ai-notice-dismiss").click();
    await page.getByTestId("notes-ai-tab-proofread").click();
    // Two segments went out; one comes back.
    await setGeminiBehaviour(page, { [KEY_1]: { kind: "ok", chunks: ["⟦1⟧ بىرىنچى."] } });
    await page.getByTestId("notes-ai-proofread-run").click();

    const error = page.getByTestId("notes-ai-error");
    await expect(error).toBeVisible();
    await expect(error).toContainText("جاۋاب فورماتى خاتا");
    await expect(error).toContainText("ھېچقانداق ئۆزگەرتىش قىلىنمىدى");
    await expect(page.getByTestId("notes-ai-diff")).toHaveCount(0);
    expect(await page.getByTestId("note-body").innerHTML()).toBe(before);

    await deleteNote(page, path);
  });

  test("never sends a cited passage or a Qur'an verse", async ({ page }) => {
    await enableAi(page);
    const path = await newNote(page);
    await page.getByTestId("note-body").click();
    // One ordinary paragraph and one carrying a citation link, as the source
    // panel inserts them.
    await page.evaluate(() => {
      const body = document.querySelector('[data-testid="note-body"]') as HTMLElement;
      body.innerHTML =
        "<div>ئادەتتىكى ئابزاس</div>" +
        '<blockquote dir="rtl">نەقىل قىلىنغان پارچە</blockquote>' +
        '<p dir="rtl"><a href="/books/1/read?page=2">«كىتاب» — 2-بەت</a></p>';
      body.dispatchEvent(new Event("input", { bubbles: true }));
    });

    await openAi(page);
    await page.getByTestId("notes-ai-notice-dismiss").click();
    await page.getByTestId("notes-ai-tab-proofread").click();
    await setGeminiBehaviour(page, {
      [KEY_1]: { kind: "ok", chunks: ["⟦1⟧ ئادەتتىكى ئابزاس.\n⟦2⟧ نەقىل قىلىنغان پارچە."] },
    });
    await page.getByTestId("notes-ai-proofread-run").click();
    await expect(page.getByTestId("notes-ai-diff")).toBeVisible();

    // The citation line was never sent — correcting a quotation is not a fix.
    const [call] = await geminiCalls(page);
    expect(call.body).not.toContain("كىتاب");
    await expect(page.getByTestId("notes-ai-skipped")).toBeVisible();

    await deleteNote(page, path);
  });
});

/* ── Nothing is kept ─────────────────────────────────────────────────────── */

test.describe("nothing about AI is kept", () => {
  test("no request or answer is cached, and none is sent to our own server", async ({ page }) => {
    const leaks: string[] = [];
    page.on("request", (request) => {
      const url = request.url();
      if (url.startsWith("https://generativelanguage.googleapis.com")) return;
      const body = request.postData() ?? "";
      if (url.includes(KEY_1) || body.includes(KEY_1)) leaks.push(`${request.method()} ${url}`);
    });

    await enableAi(page);
    const path = await newNote(page);
    await type(page, "سىناق");
    await openAi(page);
    await page.getByTestId("notes-ai-notice-dismiss").click();
    await setGeminiBehaviour(page, { [KEY_1]: { kind: "ok", chunks: ["جاۋاب"] } });
    await page.getByTestId("notes-ai-input").fill("سوئال");
    await page.getByTestId("notes-ai-send").click();
    await expect(page.getByTestId("notes-ai-reply")).toContainText("جاۋاب");

    expect(leaks, "the key must never reach our own origin").toEqual([]);

    const cached = await page.evaluate(async () => {
      if (typeof caches === "undefined") return [];
      const found: string[] = [];
      for (const name of await caches.keys()) {
        const cache = await caches.open(name);
        for (const request of await cache.keys()) {
          if (request.url.includes("generativelanguage")) found.push(request.url);
        }
      }
      return found;
    });
    expect(cached, "somebody's private note is not a cacheable asset").toEqual([]);

    // The answer only reaches the database if the writer puts it in the note.
    await page.reload();
    await expect(page.getByTestId("note-body")).not.toContainText("جاۋاب");

    await deleteNote(page, path);
  });
});

/* ── The phone ───────────────────────────────────────────────────────────── */

test.describe("on a phone", () => {
  test("opens as a sheet below the toolbar and does not trap scrolling", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name.includes("desktop"), "phone behaviour");

    await enableAi(page);
    const path = await newNote(page);
    await type(page, "خاتىرە مەزمۇنى");

    await openAi(page);
    const panel = page.getByTestId("notes-ai-panel");
    await expect(panel).toHaveAttribute("data-docked", "0");

    const viewport = page.viewportSize()!;
    const box = (await panel.boundingBox())!;
    expect(Math.abs(box.width - viewport.width)).toBeLessThanOrEqual(1);
    expect(Math.abs(box.y + box.height - viewport.height)).toBeLessThanOrEqual(2);

    // The editor's own toolbar keeps its space — it is the bar a writer needs
    // with the keyboard up, which is why it is at the top in the first place.
    const toolbar = (await page.getByTestId("note-toolbar").boundingBox())!;
    expect(box.y).toBeGreaterThan(toolbar.y + toolbar.height);

    await page.getByTestId("notes-ai-close").click();
    await expect(panel).toBeHidden();
    // Nothing left locked: the page scrolls again.
    expect(await page.evaluate(() => document.documentElement.style.overflow)).toBe("");
    expect(await topMostTestIdAt(page, "notes-ai-toggle")).toBe("notes-ai-toggle");
    await assertNoHorizontalOverflow(page);

    await deleteNote(page, path);
  });

  test("keeps the send button reachable when the keyboard takes the screen", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name.includes("desktop"), "phone behaviour");

    await enableAi(page);
    const path = await newNote(page);
    await type(page, "خاتىرە");
    await openAi(page);
    await page.getByTestId("notes-ai-notice-dismiss").click();

    const viewport = page.viewportSize()!;
    const shrunk = Math.round(viewport.height * 0.55);
    await page.setViewportSize({ width: viewport.width, height: shrunk });
    await page.getByTestId("notes-ai-input").click();
    await page.getByTestId("notes-ai-input").fill("سوئال");

    const send = page.getByTestId("notes-ai-send");
    await send.scrollIntoViewIfNeeded();
    await expect(send).toBeVisible();
    const box = (await send.boundingBox())!;
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(shrunk + 1);
    expect(await topMostTestIdAt(page, "notes-ai-send")).toBe("notes-ai-send");

    await page.setViewportSize(viewport);
    await deleteNote(page, path);
  });

  test("does not disturb what was typed, or the save that follows it", async ({ page }) => {
    await enableAi(page);
    const path = await newNote(page);
    await type(page, "ساقلىنىشى كېرەك بولغان تېكىست");

    // Open and close the panel while the save is still in flight.
    await openAi(page);
    await page.getByTestId("notes-ai-close").click();

    await expect(page.getByTestId("save-state")).toHaveText("ساقلاندى", { timeout: 20_000 });
    await page.reload();
    await expect(page.getByTestId("note-body")).toContainText("ساقلىنىشى كېرەك بولغان تېكىست");

    await deleteNote(page, path);
  });
});
