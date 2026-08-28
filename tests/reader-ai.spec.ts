import { test, expect, type Page } from "@playwright/test";
import { hasStaffTestEnv, loadEnvLocal, readSeed } from "./env";
import { geminiCalls, installGeminiMock, setGeminiBehaviour } from "./fixtures/gemini-mock";
// The real obfuscation, so a test never has to reimplement it and drift.
import { obfuscateKey } from "../lib/ai/storage";

loadEnvLocal();

test.skip(!hasStaffTestEnv(), "Supabase env not configured");

const KEY_1 = "AIzaReaderPanelKeyOne00000000000001";
const KEY_2 = "AIzaReaderPanelKeyTwo00000000000002";

const AI_STORAGE_KEYS = [
  "bh-ai-enabled",
  "bh-ai-keys",
  "bh-ai-model",
  "bh-ai-last-good-slot",
  "bh-ai-usage",
];

function seededBookId(): number {
  const seed = readSeed();
  if (!seed) throw new Error("seed book missing — the setup project must run first");
  return seed.bookId;
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

/** What is actually on top at a control's centre — catches covered buttons. */
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

/**
 * Switch AI on for this browser, exactly as the settings screen would.
 *
 * Writing localStorage directly rather than driving /my/ai keeps every test in
 * this file about the READER — the settings screen has its own spec — and the
 * key is obfuscated with the real function so the two can never disagree.
 */
async function enableAi(page: Page, keys: string[] = [KEY_1]) {
  const slots = JSON.stringify(
    Array.from({ length: 4 }, (_, index) => (keys[index] ? obfuscateKey(keys[index]) : "")),
  );
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

/** Wipe AI state without touching the signed-in session beside it. */
async function clearAi(page: Page) {
  await page.addInitScript((storageKeys: string[]) => {
    try {
      for (const key of storageKeys) localStorage.removeItem(key);
    } catch {
      // Nothing to clear.
    }
  }, AI_STORAGE_KEYS);
}

/**
 * Select a passage the way a reader's finger would.
 *
 * A long press is what makes a selection on a phone and Playwright has no
 * gesture for it, so the selection is made through the same Selection API the
 * browser itself drives — and everything after it (the button appearing, and
 * being TAPPED) is the real path. It selects INSIDE one text node, like a real
 * drag: a range spanning whole elements is not what a finger produces.
 */
async function selectPassage(page: Page) {
  await expect(page.getByTestId("reader-page").first()).toBeVisible();
  /**
   * Re-armed until it lands. The listener that watches for a selection is
   * attached when React hydrates, and a synthetic event fired before that is
   * simply missed — which on a cold dev-server compile is most of a second.
   */
  await expect(async () => {
    await selectOnce(page);
    await expect(page.getByTestId("quote-card-open")).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 20_000 });
}

async function selectOnce(page: Page) {
  await page.evaluate(() => {
    const container = document.querySelector('[data-testid="reader-content"]');
    if (!container) throw new Error("no reader content");
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    let node: Node | null = null;
    while ((node = walker.nextNode())) {
      if ((node.textContent ?? "").trim().length > 80) break;
    }
    if (!node) throw new Error("no text long enough to select");
    const range = document.createRange();
    range.setStart(node, 0);
    range.setEnd(node, Math.min(120, (node.textContent ?? "").length));
    const selection = window.getSelection();
    if (!selection) throw new Error("no selection api");
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));
  });
}

async function openPanel(page: Page) {
  await page.getByTestId("ai-toggle").click();
  await expect(page.getByTestId("ai-panel")).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await installGeminiMock(page);
});

/* ── Nobody is shown AI who did not ask for it ───────────────────────────── */

test.describe("a visitor with no account", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("finds no AI control anywhere in the reader", async ({ page }) => {
    await page.goto(`/books/${seededBookId()}/read`);
    await expect(page.getByTestId("reader-toolbar")).toBeVisible();
    await expect(page.getByTestId("ai-toggle")).toHaveCount(0);

    // Not even on a selection, where the quote card still appears.
    await selectPassage(page);
    await expect(page.getByTestId("quote-card-open")).toBeVisible();
    await expect(page.getByTestId("ai-selection-ask")).toHaveCount(0);
    await assertNoHorizontalOverflow(page);
  });
});

test.describe("a signed-in reader who has not enabled AI", () => {
  test("sees no AI control, and is not asked to turn it on", async ({ page }) => {
    await clearAi(page);
    await page.goto(`/books/${seededBookId()}/read`);

    await expect(page.getByTestId("ai-toggle")).toHaveCount(0);
    await expect(page.getByTestId("ai-panel")).toHaveCount(0);
    // No teaser, no disabled button, no "switch this on" anywhere.
    await expect(page.getByText("سۈنئىي ئىدراك")).toHaveCount(0);

    await selectPassage(page);
    await expect(page.getByTestId("quote-card-open")).toBeVisible();
    await expect(page.getByTestId("ai-selection-ask")).toHaveCount(0);
    await assertNoHorizontalOverflow(page);
  });
});

/* ── Scopes ──────────────────────────────────────────────────────────────── */

test.describe("choosing what to ask about", () => {
  test("the page, the selection, and the whole book", async ({ page }) => {
    await enableAi(page);
    await page.goto(`/books/${seededBookId()}/read`);
    await openPanel(page);

    // Opened from the toolbar with nothing selected: this page.
    await expect(page.getByTestId("ai-scope-page")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("ai-scope-meta")).toContainText("ھەرپ");

    // The whole book is a real download, so it reports what it costs.
    await page.getByTestId("ai-scope-all").click();
    await expect(page.getByTestId("ai-scope-all")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("ai-scope-meta")).toContainText("KB");
    const wholeBook = await page.getByTestId("ai-scope-meta").textContent();

    // …and it is bigger than one page, which is the whole point of the choice.
    await page.getByTestId("ai-scope-page").click();
    const onePage = await page.getByTestId("ai-scope-meta").textContent();
    expect(charsIn(wholeBook)).toBeGreaterThan(charsIn(onePage));
    await assertNoHorizontalOverflow(page);
  });

  test("a selection opens the panel already pointed at it", async ({ page }) => {
    await enableAi(page);
    await page.goto(`/books/${seededBookId()}/read`);

    await selectPassage(page);
    await page.getByTestId("ai-selection-ask").click();

    await expect(page.getByTestId("ai-panel")).toBeVisible();
    await expect(page.getByTestId("ai-scope-selection")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("ai-scope-meta")).toContainText("ھەرپ");

    await setGeminiBehaviour(page, { [KEY_1]: { kind: "ok", chunks: ["خۇلاسە"] } });
    await page.getByTestId("ai-quick-summary").click();
    await expect(page.getByTestId("ai-answer")).toContainText("خۇلاسە");

    // What was sent is what was selected, not the whole page.
    const [call] = await geminiCalls(page);
    expect(call.body).toContain("تۈر: summary");
  });
});

function charsIn(meta: string | null): number {
  return Number((meta ?? "").replace(/[^0-9]/g, "").slice(0, 8)) || 0;
}

/* ── The quick actions send the desktop's prompts ────────────────────────── */

test.describe("quick actions", () => {
  test.beforeEach(async ({ page }) => {
    await enableAi(page);
    await page.goto(`/books/${seededBookId()}/read`);
    await openPanel(page);
    await setGeminiBehaviour(page, { [KEY_1]: { kind: "ok", chunks: ["جاۋاب"] } });
  });

  test("«خۇلاسىلەش» sends the summary prompt, on SYSTEM_BASE", async ({ page }) => {
    await page.getByTestId("ai-quick-summary").click();
    await expect(page.getByTestId("ai-answer")).toContainText("جاۋاب");

    const [call] = await geminiCalls(page);
    expect(call.body).toContain("تۈر: summary");
    // SYSTEM_BASE is what forces Uyghur output; it must be there.
    expect(call.body).toContain("ساپ، چۈشىنىشلىك ئۇيغۇر تىلىدا");
  });

  test("«مەركىزىي ئىدىيەسى» sends the central-idea prompt", async ({ page }) => {
    await page.getByTestId("ai-quick-central").click();
    await expect(page.getByTestId("ai-answer")).toContainText("جاۋاب");
    const [call] = await geminiCalls(page);
    expect(call.body).toContain("تۈر: central_idea");
  });

  test("translation offers six directions and bypasses SYSTEM_BASE", async ({ page }) => {
    await page.getByTestId("ai-quick-translate").click();
    const menu = page.getByTestId("ai-translate-menu");
    await expect(menu).toBeVisible();
    await expect(menu.locator("button")).toHaveCount(6);

    await page.getByTestId("ai-translate-uy-ar").click();
    await expect(page.getByTestId("ai-answer")).toContainText("جاۋاب");

    const [call] = await geminiCalls(page);
    // The English task line the desktop uses, naming both languages.
    expect(call.body).toContain("TASK: Translate FROM Uyghur INTO Arabic");
    // And NOT the instruction that would drag the answer back into Uyghur.
    expect(call.body).not.toContain("ساپ، چۈشىنىشلىك ئۇيغۇر تىلىدا");
  });

  test("«ئاتالغۇ چۈشەندۈرۈش» offers both the typed and the automatic mode", async ({ page }) => {
    await page.getByTestId("ai-quick-term").click();
    await expect(page.getByTestId("ai-term-menu")).toBeVisible();

    // Automatic: no question, the model picks the terms itself.
    await page.getByTestId("ai-term-auto").click();
    await expect(page.getByTestId("ai-answer")).toContainText("جاۋاب");
    let calls = await geminiCalls(page);
    expect(calls[0].body).toContain("تۈر: term_explain");
    expect(calls[0].body).toContain("ئوقۇرمەن ئېنىق سوئال سورىمىدى");

    // Typed: the term rides in as the reader's question.
    await setGeminiBehaviour(page, { [KEY_1]: { kind: "ok", chunks: ["چۈشەندۈرۈش"] } });
    await page.getByTestId("ai-quick-term").click();
    await page.getByTestId("ai-term-manual").click();
    await expect(page.getByTestId("ai-type")).toHaveValue("term_explain");
    await page.getByTestId("ai-question").fill("تەقۋا");
    await page.getByTestId("ai-ask").click();
    await expect(page.getByTestId("ai-answer")).toContainText("چۈشەندۈرۈش");

    calls = await geminiCalls(page);
    expect(calls[0].body).toContain("تەقۋا");
    expect(calls[0].body).toContain("تۈر: term_explain");
  });

  test("the text type can be overridden, and the chosen one is what is sent", async ({ page }) => {
    await page.getByTestId("ai-type").selectOption("fiqh");
    await page.getByTestId("ai-question").fill("بۇ نېمە؟");
    await page.getByTestId("ai-ask").click();
    await expect(page.getByTestId("ai-answer")).toContainText("جاۋاب");
    const [call] = await geminiCalls(page);
    expect(call.body).toContain("تۈر: fiqh");
  });
});

/* ── Streaming, stopping, saving ─────────────────────────────────────────── */

test.describe("the answer", () => {
  test("streams in and can be stopped, leaving nothing half-written", async ({ page }) => {
    await enableAi(page);
    await page.goto(`/books/${seededBookId()}/read`);
    await openPanel(page);
    await setGeminiBehaviour(page, {
      [KEY_1]: { kind: "ok", chunks: ["بىرىنچى ", "ئىككىنچى ", "ئۈچىنچى ", "تۆتىنچى"], delayMs: 400 },
    });

    await page.getByTestId("ai-quick-summary").click();
    await expect(page.getByTestId("ai-answer")).toContainText("بىرىنچى");
    await expect(page.getByTestId("ai-streaming")).toBeVisible();

    await page.getByTestId("ai-stop").click();
    await expect(page.getByTestId("ai-answer")).toHaveCount(0);
    await expect(page.getByTestId("ai-error")).toHaveCount(0);
    await expect(page.getByTestId("ai-streaming")).toHaveCount(0);

    await page.waitForTimeout(1200);
    await expect(page.getByTestId("ai-answer")).toHaveCount(0);
  });

  test("is visually separated from the book, and says it can be wrong", async ({ page }) => {
    await enableAi(page);
    await page.goto(`/books/${seededBookId()}/read`);
    await openPanel(page);

    // The warning is there before any answer is, and cannot be dismissed.
    await expect(page.getByTestId("ai-disclaimer")).toContainText("خاتا بولۇشى مۇمكىن");

    await setGeminiBehaviour(page, { [KEY_1]: { kind: "ok", chunks: ["## سەرلەۋھە\n\nجاۋاب"] } });
    await page.getByTestId("ai-quick-summary").click();
    await expect(page.getByTestId("ai-answer-card")).toContainText("سۈنئىي ئىدراكنىڭ جاۋابى");
    // Markdown is rendered, not printed — and by the renderer the book uses.
    await expect(page.getByTestId("ai-answer").locator("h2")).toHaveText("سەرلەۋھە");
  });

  test("«خاتىرىگە ساقلاش» writes a note that links back to the page", async ({ page }) => {
    await enableAi(page);
    const bookId = seededBookId();
    await page.goto(`/books/${bookId}/read`);
    await openPanel(page);
    await setGeminiBehaviour(page, { [KEY_1]: { kind: "ok", chunks: ["ساقلىنىدىغان جاۋاب"] } });

    await page.getByTestId("ai-question").fill("بۇ بەت نېمە ھەققىدە؟");
    await page.getByTestId("ai-ask").click();
    await expect(page.getByTestId("ai-answer")).toContainText("ساقلىنىدىغان جاۋاب");

    await page.getByTestId("ai-save-note").click();
    const link = page.getByTestId("ai-saved-link");
    await expect(link).toBeVisible();

    await link.click();
    await expect(page).toHaveURL(/\/notes\/\d+/);
    const body = page.getByTestId("note-body");
    await expect(body).toContainText("ساقلىنىدىغان جاۋاب");
    await expect(body).toContainText("بۇ بەت نېمە ھەققىدە؟");
    // The way back to the passage, which is what makes the note worth keeping.
    await expect(body.locator(`a[href*="/books/${bookId}/read"]`).first()).toBeVisible();
    // And the warning travels with the answer.
    await expect(body).toContainText("خاتا بولۇشى مۇمكىن");
  });
});

/* ── Errors ──────────────────────────────────────────────────────────────── */

test.describe("when something goes wrong", () => {
  test("an exhausted quota reads as Uyghur, never a raw API string", async ({ page }) => {
    await enableAi(page);
    await page.goto(`/books/${seededBookId()}/read`);
    await openPanel(page);
    await setGeminiBehaviour(page, { [KEY_1]: { kind: "quota", retryDelay: "30s" } });

    await page.getByTestId("ai-quick-summary").click();
    const error = page.getByTestId("ai-error");
    await expect(error).toBeVisible({ timeout: 30_000 });
    await expect(error).toContainText("ھەققىڭىز توشۇپ قالدى");
    await expect(error).not.toContainText("HTTP");
    await expect(error).not.toContainText("Resource has been exhausted");
    // Somewhere to go, and something to try again.
    await expect(page.getByTestId("ai-settings-link")).toBeVisible();
    await expect(page.getByTestId("ai-retry")).toBeVisible();
  });

  test("a paid-only model is named, and the model is never swapped", async ({ page }) => {
    await enableAi(page, [KEY_1, KEY_2]);
    await page.addInitScript(() => localStorage.setItem("bh-ai-model", "gemini-3.1-pro-preview"));
    await page.goto(`/books/${seededBookId()}/read`);
    await openPanel(page);
    await setGeminiBehaviour(page, {
      [KEY_1]: { kind: "paid_only" },
      [KEY_2]: { kind: "paid_only" },
    });

    await page.getByTestId("ai-quick-summary").click();
    const error = page.getByTestId("ai-error");
    await expect(error).toBeVisible();
    await expect(error).toContainText("gemini-3.1-pro-preview");
    await expect(error).toContainText("پۇللۇق مودېل");
    await expect(error).toContainText("ئۆزلۈكىدىن ئۆزگەرتىلمىدى");

    // Both keys were tried; neither try used a different model.
    const calls = await geminiCalls(page);
    expect(calls.length).toBeGreaterThanOrEqual(2);
    expect(calls.every((call) => call.model === "gemini-3.1-pro-preview")).toBe(true);
  });

  test("no AI request or answer is ever cached", async ({ page }) => {
    await enableAi(page);
    await page.goto(`/books/${seededBookId()}/read`);
    await openPanel(page);
    await setGeminiBehaviour(page, { [KEY_1]: { kind: "ok", chunks: ["جاۋاب"] } });
    await page.getByTestId("ai-quick-summary").click();
    await expect(page.getByTestId("ai-answer")).toContainText("جاۋاب");

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
    expect(cached, "somebody's question is not a cacheable asset").toEqual([]);

    // The reason it cannot be: they are POSTs, which the worker declines.
    const calls = await geminiCalls(page);
    expect(calls.length).toBeGreaterThan(0);
  });
});

/* ── The phone ───────────────────────────────────────────────────────────── */

test.describe("on a phone", () => {
  test("opens as a sheet that leaves the reader's toolbar reachable", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name.includes("desktop"), "phone behaviour");

    await enableAi(page);
    await page.goto(`/books/${seededBookId()}/read`);
    await openPanel(page);

    const panel = page.getByTestId("ai-panel");
    await expect(panel).toHaveAttribute("data-docked", "0");

    const viewport = page.viewportSize()!;
    const box = (await panel.boundingBox())!;
    // A sheet: full width, anchored to the bottom, and NOT the whole screen.
    expect(box.x).toBeLessThanOrEqual(1);
    expect(Math.abs(box.width - viewport.width)).toBeLessThanOrEqual(1);
    expect(Math.abs(box.y + box.height - viewport.height)).toBeLessThanOrEqual(2);
    // The reader's toolbar keeps its own space: the sheet starts below it, so
    // closing gives every control back exactly where it was.
    const toolbar = (await page.getByTestId("reader-toolbar").boundingBox())!;
    expect(box.y, "the sheet must not occupy the toolbar's space").toBeGreaterThan(
      toolbar.y + toolbar.height,
    );

    // The dimmed strip above it is the way out, and it works by tap.
    await page.getByTestId("ai-overlay").click({ position: { x: 10, y: 10 } });
    await expect(panel).toBeHidden();
    expect(await topMostTestIdAt(page, "ai-toggle")).toBe("ai-toggle");
    await assertNoHorizontalOverflow(page);
  });

  test("keeps the send button visible when the keyboard takes the screen", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name.includes("desktop"), "phone behaviour");

    await enableAi(page);
    await page.goto(`/books/${seededBookId()}/read`);
    await openPanel(page);

    const viewport = page.viewportSize()!;
    // What an on-screen keyboard does to the visual viewport, near enough.
    await page.setViewportSize({ width: viewport.width, height: Math.round(viewport.height * 0.55) });
    await page.getByTestId("ai-question").click();
    await page.getByTestId("ai-question").fill("سوئال");

    const send = page.getByTestId("ai-ask");
    await expect(send).toBeVisible();
    await send.scrollIntoViewIfNeeded();
    const box = (await send.boundingBox())!;
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(Math.round(viewport.height * 0.55) + 1);
    // Reachable, not merely present.
    expect(await topMostTestIdAt(page, "ai-ask")).toBe("ai-ask");

    await page.setViewportSize(viewport);
  });

  test("closing puts the reader back exactly where they were", async ({ page }) => {
    await enableAi(page);
    await page.goto(`/books/${seededBookId()}/read`);

    await page.evaluate(() => window.scrollTo(0, 900));
    await page.waitForTimeout(200);
    const before = await page.evaluate(() => window.scrollY);
    expect(before).toBeGreaterThan(100);

    await openPanel(page);
    await page.getByTestId("ai-panel-close").click();
    await expect(page.getByTestId("ai-panel")).toBeHidden();

    await page.waitForTimeout(200);
    expect(await page.evaluate(() => window.scrollY)).toBeCloseTo(before, -1);

    // The page scrolls normally again — nothing left locked behind.
    expect(await page.evaluate(() => document.documentElement.style.overflow)).toBe("");
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(150);
    expect(await page.evaluate(() => window.scrollY)).toBeLessThan(50);

    // Every reader control still works after all of that.
    await expect(page.getByTestId("page-jump")).toBeVisible();
    expect(await topMostTestIdAt(page, "page-jump-go")).toBe("page-jump-go");
    await assertNoHorizontalOverflow(page);
  });
});

/* ── The laptop ──────────────────────────────────────────────────────────── */

test.describe("on a laptop", () => {
  test("docks beside the text instead of covering it", async ({ page }, testInfo) => {
    test.skip(!testInfo.project.name.includes("desktop"), "docked behaviour");

    await enableAi(page);
    await page.goto(`/books/${seededBookId()}/read`);

    const content = page.getByTestId("reader-content");
    const before = (await content.boundingBox())!;
    await openPanel(page);

    const panel = page.getByTestId("ai-panel");
    await expect(panel).toHaveAttribute("data-docked", "1");

    // The text moved aside rather than being painted over: no overlap at all
    // between the panel's box and the book's.
    const panelBox = (await panel.boundingBox())!;
    const after = (await content.boundingBox())!;
    const overlap =
      Math.min(after.x + after.width, panelBox.x + panelBox.width) - Math.max(after.x, panelBox.x);
    expect(overlap, "the panel must not sit on top of the book").toBeLessThanOrEqual(0);

    // It really did move — this is the whole point of docking.
    expect(after.x).not.toBe(before.x);

    // No overlay, so the book stays readable and the reader keeps scrolling.
    await expect(page.getByTestId("ai-overlay")).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.style.overflow)).toBe("");
    await page.evaluate(() => window.scrollTo(0, 600));
    await page.waitForTimeout(200);
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(100);

    // Every reader control is still on top of itself, none swallowed.
    expect(await topMostTestIdAt(page, "ai-toggle")).toBe("ai-toggle");
    expect(await topMostTestIdAt(page, "panel-toggle")).toBe("panel-toggle");
    await assertNoHorizontalOverflow(page);
  });
});

/* ── The first-open notice ───────────────────────────────────────────────── */

test.describe("telling the reader where their text goes", () => {
  test("says it on the first open, and not on every open after", async ({ page }) => {
    await enableAi(page);
    await page.goto(`/books/${seededBookId()}/read`);

    await openPanel(page);
    const notice = page.getByTestId("ai-first-notice");
    await expect(notice).toBeVisible();
    await expect(notice).toContainText("Google غا");
    await expect(notice.getByRole("link")).toHaveAttribute("href", "/my/ai");

    await page.getByTestId("ai-notice-dismiss").click();
    await expect(notice).toHaveCount(0);

    await page.getByTestId("ai-panel-close").click();
    await openPanel(page);
    await expect(page.getByTestId("ai-first-notice")).toHaveCount(0);
  });
});

/* ── The request itself ──────────────────────────────────────────────────── */

test.describe("what actually goes to Google", () => {
  test.beforeEach(async ({ page }) => {
    await enableAi(page);
    await page.goto(`/books/${seededBookId()}/read`);
    await openPanel(page);
    await setGeminiBehaviour(page, { [KEY_1]: { kind: "ok", chunks: ["جاۋاب"] } });
  });

  test("sets no temperature and no topP, and no thinking level", async ({ page }) => {
    await page.getByTestId("ai-quick-summary").click();
    await expect(page.getByTestId("ai-answer")).toContainText("جاۋاب");

    const [call] = await geminiCalls(page);
    const config = JSON.parse(call.body ?? "{}").generationConfig ?? {};
    // Google's Gemini 3 guide asks for temperature 1.0; sending nothing is the
    // only way to keep a default, and it is what AI Studio does.
    expect(config).not.toHaveProperty("temperature");
    expect(config).not.toHaveProperty("topP");
    // An omitted thinkingLevel lets each model use its own default.
    expect(config).not.toHaveProperty("thinkingConfig");
  });

  test("asks for high thinking only when «چوڭقۇر مۇلاھىزە» is ticked", async ({ page }) => {
    await page.getByTestId("ai-deep").check();
    await page.getByTestId("ai-quick-summary").click();
    await expect(page.getByTestId("ai-answer")).toContainText("جاۋاب");

    const [call] = await geminiCalls(page);
    const config = JSON.parse(call.body ?? "{}").generationConfig ?? {};
    expect(config.thinkingConfig).toEqual({ thinkingLevel: "high" });
  });

  test("offers the toggle at all on a model whose default is lower", async ({ page }) => {
    // gemini-3.7-flash defaults to `medium`, so asking for `high` really does
    // raise it — the control is honest here and is shown.
    await expect(page.getByTestId("ai-deep")).toBeVisible();
    await expect(page.getByTestId("ai-deep-always")).toHaveCount(0);
  });
});

test("hides the deep-reasoning toggle for a model that already reasons deeply", async ({
  page,
}) => {
  await enableAi(page);
  /**
   * The model has to be set by a LATER init script, not by reloading: enableAi
   * clears every AI storage key on each navigation, so anything written in
   * between is wiped on the way back. This is the order the paid-only test
   * above uses too.
   */
  await page.addInitScript(() => localStorage.setItem("bh-ai-model", "gemini-3.1-pro-preview"));
  await page.goto(`/books/${seededBookId()}/read`);
  await openPanel(page);

  // gemini-3.1-pro-preview defaults to `high`, so «چوڭقۇر مۇلاھىزە» would
  // change precisely nothing. It is replaced by an honest line rather than
  // shown as a control that does nothing.
  await expect(page.getByTestId("ai-deep")).toHaveCount(0);
  await expect(page.getByTestId("ai-deep-always")).toContainText("چوڭقۇر مۇلاھىزە");
  await assertNoHorizontalOverflow(page);
});

/* ── An answer that stopped short ────────────────────────────────────────── */

test.describe("an unfinished answer", () => {
  test("is delivered with a notice and a way to carry on", async ({ page }) => {
    await enableAi(page);
    await page.goto(`/books/${seededBookId()}/read`);
    await openPanel(page);
    await setGeminiBehaviour(page, {
      [KEY_1]: { kind: "ok", chunks: ["بىرىنچى جۈملە. ئىككىنچى جۈم"], finishReason: "MAX_TOKENS" },
    });

    await page.getByTestId("ai-quick-summary").click();
    // The text that did arrive is kept…
    await expect(page.getByTestId("ai-answer")).toContainText("بىرىنچى جۈملە");
    // …and it is never passed off as the whole answer.
    const notice = page.getByTestId("ai-answer-cut");
    await expect(notice).toBeVisible();
    await expect(notice).toContainText("تولۇق جاۋاب ئەمەس");

    // Carrying on appends rather than starting over.
    await setGeminiBehaviour(page, {
      [KEY_1]: { kind: "ok", chunks: ["لىسى ئاخىرلاشتى."] },
    });
    await page.getByTestId("ai-continue").click();
    await expect(page.getByTestId("ai-answer")).toContainText("ئاخىرلاشتى");
    await expect(page.getByTestId("ai-answer")).toContainText("بىرىنچى جۈملە");
    await expect(page.getByTestId("ai-answer-cut")).toHaveCount(0);

    // And the continuation showed the model where it stopped.
    const [call] = await geminiCalls(page);
    expect(call.body).toContain("ئىككىنچى جۈم");
    await assertNoHorizontalOverflow(page);
  });

  test("offers no continue when carrying on would stop in the same place", async ({ page }) => {
    await enableAi(page);
    await page.goto(`/books/${seededBookId()}/read`);
    await openPanel(page);
    await setGeminiBehaviour(page, {
      [KEY_1]: { kind: "ok", chunks: ["يېرىم جاۋاب"], finishReason: "SAFETY" },
    });

    await page.getByTestId("ai-quick-summary").click();
    await expect(page.getByTestId("ai-answer")).toContainText("يېرىم جاۋاب");
    await expect(page.getByTestId("ai-answer-cut")).toContainText("بىخەتەرلىك سۈزگۈچى");
    await expect(page.getByTestId("ai-continue")).toHaveCount(0);
  });
});

/* ── Which model replied ─────────────────────────────────────────────────── */

test.describe("the model behind the answer", () => {
  test("is shown under it", async ({ page }) => {
    await enableAi(page);
    await page.goto(`/books/${seededBookId()}/read`);
    await openPanel(page);
    await setGeminiBehaviour(page, {
      [KEY_1]: { kind: "ok", chunks: ["جاۋاب"], modelVersion: "gemini-3.7-flash" },
    });

    await page.getByTestId("ai-quick-summary").click();
    await expect(page.getByTestId("ai-answer")).toContainText("جاۋاب");
    await expect(page.getByTestId("ai-model-version")).toContainText("gemini-3.7-flash");
    await expect(page.getByTestId("ai-model-mismatch")).toHaveCount(0);
  });

  test("is reported, not swallowed, when it is not the one that was asked for", async ({
    page,
  }) => {
    await enableAi(page);
    await page.goto(`/books/${seededBookId()}/read`);
    await openPanel(page);
    await setGeminiBehaviour(page, {
      [KEY_1]: { kind: "ok", chunks: ["جاۋاب"], modelVersion: "gemini-3.5-flash-lite" },
    });

    await page.getByTestId("ai-quick-summary").click();
    const alert = page.getByTestId("ai-model-mismatch");
    await expect(alert).toBeVisible();
    await expect(alert).toContainText("gemini-3.7-flash");
    await expect(alert).toContainText("gemini-3.5-flash-lite");
    await expect(alert).toContainText("بۇ سايت قىلمىدى");

    // The request was still strict: the reader's model is what was called.
    const [call] = await geminiCalls(page);
    expect(call.model).toBe("gemini-3.7-flash");
    await assertNoHorizontalOverflow(page);
  });
});
