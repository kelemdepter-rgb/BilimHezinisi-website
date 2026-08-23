import { test, expect, type Locator, type Page } from "@playwright/test";
import { hasStaffTestEnv, loadEnvLocal, readSeed } from "./env";

loadEnvLocal();

test.skip(!hasStaffTestEnv(), "Supabase env not configured");

/**
 * The on-screen Uyghur keyboard, and the searches a reader has already made.
 *
 * Both exist for a phone: one for the phones with no Uyghur keyboard
 * installed, which without it cannot search this library at all, and one for
 * not having to type the same thing twice. Anonymous throughout.
 */

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

/** Open the keyboard belonging to one field, by TAP where there is touch. */
async function openKeyboard(page: Page, toggle: Locator) {
  await toggle.tap({ timeout: 5000 }).catch(() => toggle.click());
  await expect(page.getByTestId("uyghur-keyboard")).toBeVisible();
}

/** The toggle that sits with a particular input. */
function toggleFor(page: Page, inputTestId: string): Locator {
  return page
    .locator(`xpath=//*[@data-testid='${inputTestId}']/following::*[@data-testid='keyboard-toggle'][1]`)
    .first();
}

async function typeWord(page: Page, letters: string[]) {
  for (const letter of letters) {
    await page.getByTestId("keyboard-key").filter({ hasText: new RegExp(`^${letter}$`) }).first().click();
  }
}

test.describe("the on-screen keyboard", () => {
  test("types Uyghur into the library search box", async ({ page }) => {
    await page.goto("/search");
    const input = page.getByTestId("search-input");
    await openKeyboard(page, toggleFor(page, "search-input"));

    await typeWord(page, ["ئ", "ۇ", "ي", "غ", "ۇ", "ر"]);
    await expect(input).toHaveValue("ئۇيغۇر");

    await page.getByTestId("keyboard-space").click();
    await page.getByTestId("keyboard-backspace").click();
    await expect(input, "backspace removes exactly one character").toHaveValue("ئۇيغۇر");

    // Closing keeps what was typed — this is a keyboard, not a dialog.
    await page.getByTestId("keyboard-close").click();
    await expect(page.getByTestId("uyghur-keyboard")).toHaveCount(0);
    await expect(input).toHaveValue("ئۇيغۇر");
  });

  test("types into the Qur'an search box", async ({ page }) => {
    await page.goto("/quran");
    const input = page.getByTestId("quran-search-input");
    await openKeyboard(page, toggleFor(page, "quran-search-input"));
    await typeWord(page, ["ا", "ل", "ل", "ھ"]);
    await expect(input).toHaveValue("اللھ");
  });

  test("types into the in-book search box, which React controls", async ({ page }) => {
    await page.goto(`/books/${seededBookId()}/read`);
    await page.getByTestId("find-toggle").click();
    const input = page.getByTestId("find-input");
    await expect(input).toBeVisible();

    await openKeyboard(page, toggleFor(page, "find-input"));
    await typeWord(page, ["ب", "ا", "ر"]);
    // A controlled input snaps back unless the key press looks like a real
    // keystroke to React; this is the assertion that proves it does.
    await expect(input).toHaveValue("بار");
  });

  test("has keys a finger can hit, and never scrolls sideways", async ({ page }) => {
    await page.goto("/search");
    await openKeyboard(page, toggleFor(page, "search-input"));

    const keys = page.getByTestId("keyboard-key");
    const count = await keys.count();
    // The whole alphabet, plus the hamza carrier a word cannot start without.
    expect(count).toBe(33);

    for (let index = 0; index < count; index += 1) {
      const box = (await keys.nth(index).boundingBox())!;
      expect(box.width, `key ${index} is too narrow to hit`).toBeGreaterThanOrEqual(44);
      expect(box.height, `key ${index} is too short to hit`).toBeGreaterThanOrEqual(44);
    }
    await assertNoHorizontalOverflow(page);
  });

  test("never covers the box it is typing into, and never locks the page", async ({ page }) => {
    await page.goto("/search");
    const input = page.getByTestId("search-input");
    await openKeyboard(page, toggleFor(page, "search-input"));

    const inputBox = (await input.boundingBox())!;
    const sheetBox = (await page.getByTestId("uyghur-keyboard").boundingBox())!;
    expect(
      inputBox.y + inputBox.height,
      "the keyboard must not sit on top of its own input",
    ).toBeLessThanOrEqual(sheetBox.y + 1);

    // Body scroll stays free: a reader must be able to move the page while
    // typing to see what they are typing about.
    const overflow = await page.evaluate(
      () => getComputedStyle(document.documentElement).overflow,
    );
    expect(overflow).not.toBe("hidden");
    const moved = await page.evaluate(() => {
      const before = window.scrollY;
      window.scrollBy(0, 200);
      const after = window.scrollY;
      window.scrollTo(0, before);
      return after !== before || document.documentElement.scrollHeight <= window.innerHeight;
    });
    expect(moved, "the page must still scroll behind the keyboard").toBe(true);
  });

  test("is closed until it is asked for", async ({ page }) => {
    await page.goto("/search");
    await expect(page.getByTestId("uyghur-keyboard")).toHaveCount(0);
    // And a reader who has their own keyboard is never forced through it.
    await page.getByTestId("search-input").fill("ھەدىس");
    await expect(page.getByTestId("uyghur-keyboard")).toHaveCount(0);
  });
});

test.describe("recent searches", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/search");
    await page.evaluate(() => window.localStorage.removeItem("bh-search-history"));
  });

  test("offers what was searched before, and only for an empty box", async ({ page }) => {
    await page.goto("/search?q=%D9%87%DB%95%D8%AF%DB%89%D8%B3");
    // Arriving with a query in the box: nothing is offered, because the box is
    // not empty.
    await page.getByTestId("search-input").click();
    await expect(page.getByTestId("search-history")).toHaveCount(0);

    // Search once, so there is something to remember.
    await page.getByTestId("search-input").fill("ئالتۇنكۆۋرۈك");
    await page.getByTestId("search-submit").click();
    await page.waitForLoadState("load");

    await page.getByTestId("search-input").fill("");
    await page.getByTestId("search-input").click();
    const list = page.getByTestId("search-history");
    await expect(list).toBeVisible();
    await expect(page.getByTestId("search-history-item").first()).toContainText("ئالتۇنكۆۋرۈك");
    await assertNoHorizontalOverflow(page);
  });

  test("removes one entry, and clears the lot", async ({ page }) => {
    await page.evaluate(() => {
      window.localStorage.setItem(
        "bh-search-history",
        JSON.stringify([
          { query: "بىرىنچى", at: Date.now() },
          { query: "ئىككىنچى", at: Date.now() - 1000 },
        ]),
      );
    });
    await page.reload();

    await page.getByTestId("search-input").fill("");
    await page.getByTestId("search-input").click();
    await expect(page.getByTestId("search-history-item")).toHaveCount(2);

    await page.getByTestId("search-history-remove").first().click();
    await expect(page.getByTestId("search-history-item")).toHaveCount(1);

    await page.getByTestId("search-history-clear").click();
    await expect(page.getByTestId("search-history")).toHaveCount(0);
    // Cleared means gone, not an empty list left behind.
    const left = await page.evaluate(() => window.localStorage.getItem("bh-search-history"));
    expect(left).toBeNull();
  });

  test("records nothing for a reader who has never searched", async ({ page }) => {
    await page.getByTestId("search-input").click();
    await expect(page.getByTestId("search-history")).toHaveCount(0);
    const left = await page.evaluate(() => window.localStorage.getItem("bh-search-history"));
    expect(left).toBeNull();
  });

  test("can be erased from the account page too", async ({ browser }) => {
    const context = await browser.newContext({ storageState: "tests/.auth/staff.json" });
    const page = await context.newPage();
    await page.goto("/search");
    await page.evaluate(() => {
      window.localStorage.setItem(
        "bh-search-history",
        JSON.stringify([{ query: "ئۆچۈرۈلىدىغان", at: Date.now() }]),
      );
    });

    await page.goto("/my/account");
    await expect(page.getByTestId("search-history-count")).toContainText("1");
    await page.getByTestId("clear-search-history").click();
    await expect(page.getByTestId("search-history-cleared")).toBeVisible();
    await expect(page.getByTestId("search-history-count")).toContainText("0");

    const left = await page.evaluate(() => window.localStorage.getItem("bh-search-history"));
    expect(left).toBeNull();
    await context.close();
  });
});
