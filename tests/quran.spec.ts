import { test, expect, type Page } from "@playwright/test";
import { STAFF_STATE_PATH, hasStaffTestEnv, loadEnvLocal } from "./env";

loadEnvLocal();

test.skip(!hasStaffTestEnv(), "Supabase env not configured");

/** Both spellings normalize to the same tokens, so both must find 1:1. */
const BASMALA_PLAIN = '"بسم الله الرحمن الرحيم"';
const BASMALA_TASHKIL = '"بِسْمِ ٱللَّهِ ٱلرَّحْمَٰنِ ٱلرَّحِيمِ"';
/** Unique to the Uyghur translation of 1:2. */
const UYGHUR_PHRASE = '"جىمى ھەمدۇ سانا"';

async function assertNoHorizontalOverflow(page: Page) {
  const metrics = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(metrics.scrollWidth, "page must not scroll horizontally").toBeLessThanOrEqual(
    metrics.innerWidth + 1,
  );
}

async function scrollDownAndBackUp(page: Page) {
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await page.waitForTimeout(250);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(250);
}

/**
 * Reveal a verse's action row. Tapping the medallion TOGGLES it, and a deep
 * link (?aya=) already arrives with the verse selected, so tapping blindly
 * would close what we came to use.
 */
async function openAyaActions(page: Page, aya: number) {
  const actions = page.locator(`[data-testid="aya"][data-aya="${aya}"] [data-testid="aya-actions"]`);
  if (!(await actions.isVisible())) {
    await page.locator(`[data-testid="aya"][data-aya="${aya}"] [data-testid="aya-number"]`).click();
  }
  await expect(actions).toBeVisible();
  return actions;
}

/** The element actually on top at a control's centre — catches covered buttons. */
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

test.describe("quran index", () => {
  test("is reachable in one tap from the home page and lists all 114 suras", async ({ page }) => {
    await page.goto("/");
    const link = page.getByTestId("quran-link");
    await expect(link).toBeVisible();
    const box = await link.boundingBox();
    expect(box!.height, "touch target must be at least 44px tall").toBeGreaterThanOrEqual(44);

    await link.click();
    await expect(page).toHaveURL(/\/quran$/);
    await expect(page.getByRole("heading", { name: "قۇرئان كەرىم", level: 1 })).toBeVisible();
    await expect(page.getByTestId("sura-link")).toHaveCount(114);
    await assertNoHorizontalOverflow(page);
  });

  test("works without an account", async ({ page }) => {
    await page.goto("/quran");
    await expect(page.getByTestId("login-link")).toBeVisible();
    await expect(page.getByTestId("sura-link")).toHaveCount(114);
  });

  test("filters the sura list by Uyghur name, Arabic name and number", async ({ page }) => {
    await page.goto("/quran");
    const filter = page.getByTestId("sura-filter");

    await filter.fill("بەقەرە");
    await expect(page.getByTestId("sura-link")).toHaveCount(1);
    await expect(page.getByTestId("sura-link")).toHaveAttribute("data-sura", "2");

    await filter.fill("الفاتحة");
    await expect(page.getByTestId("sura-link")).toHaveAttribute("data-sura", "1");

    await filter.fill("114");
    await expect(page.getByTestId("sura-link")).toHaveAttribute("data-sura", "114");

    await filter.fill("zzz");
    await expect(page.getByTestId("sura-link")).toHaveCount(0);
  });

  test("no horizontal overflow after scrolling the whole sura list", async ({ page }) => {
    await page.goto("/quran");
    await assertNoHorizontalOverflow(page);
    await scrollDownAndBackUp(page);
    await assertNoHorizontalOverflow(page);
  });
});

test.describe("mushaf", () => {
  test("Al-Fatiha shows its 7 ayas in the Uthmanic face", async ({ page }) => {
    await page.goto("/quran/1");
    await expect(page.getByTestId("aya")).toHaveCount(7);

    const font = await page
      .getByTestId("aya-arabic")
      .first()
      .evaluate((node) => getComputedStyle(node).fontFamily);
    expect(font).toContain("Uthmanic Hafs");

    // Al-Fatiha opens with the basmala as its own first aya, so no heading.
    await expect(page.getByTestId("basmala")).toHaveCount(0);
    await assertNoHorizontalOverflow(page);
  });

  test("shows the basmala as a heading everywhere except Al-Fatiha and At-Tawba", async ({
    page,
  }) => {
    await page.goto("/quran/112");
    await expect(page.getByTestId("basmala")).toBeVisible();

    await page.goto("/quran/9");
    await expect(page.getByTestId("basmala")).toHaveCount(0);
  });

  test("aya numbers are written in Arabic-Indic digits", async ({ page }) => {
    await page.goto("/quran/1");
    const numbers = await page.getByTestId("aya-number").allInnerTexts();
    expect(numbers.slice(0, 7)).toEqual(["١", "٢", "٣", "٤", "٥", "٦", "٧"]);
  });

  test("the translation toggle cycles both → Arabic → Uyghur and persists", async ({ page }) => {
    await page.goto("/quran/1");
    const toggle = page.getByTestId("translation-toggle");

    await expect(page.getByTestId("aya-arabic").first()).toBeVisible();
    await expect(page.getByTestId("aya-uyghur").first()).toBeVisible();

    await toggle.click();
    await expect(page.getByTestId("aya-uyghur")).toHaveCount(0);
    await expect(page.getByTestId("aya-arabic").first()).toBeVisible();

    await toggle.click();
    await expect(page.getByTestId("aya-arabic")).toHaveCount(0);
    await expect(page.getByTestId("aya-uyghur").first()).toBeVisible();

    // The choice survives a reload.
    await page.reload();
    await expect(page.getByTestId("aya-arabic")).toHaveCount(0);
    await expect(page.getByTestId("aya-uyghur").first()).toBeVisible();

    await page.getByTestId("translation-toggle").click();
    await expect(page.getByTestId("aya-arabic").first()).toBeVisible();
    await expect(page.getByTestId("aya-uyghur").first()).toBeVisible();
  });

  test("the font-size control resizes the Arabic", async ({ page }) => {
    await page.goto("/quran/1");
    const arabic = page.getByTestId("aya-arabic").first();
    const size = () => arabic.evaluate((node) => parseFloat(getComputedStyle(node).fontSize));

    const before = await size();
    await page.getByTestId("quran-font-increase").click();
    expect(await size()).toBeGreaterThan(before);
    await page.getByTestId("quran-font-decrease").click();
    expect(await size()).toBeCloseTo(before, 0);
  });

  test("all three themes apply to the mushaf", async ({ page }) => {
    await page.goto("/quran/1");
    const html = page.locator("html");
    const toggle = page.getByTestId("theme-toggle");
    await toggle.click();
    await expect(html).toHaveAttribute("data-theme", "sepia");
    await toggle.click();
    await expect(html).toHaveAttribute("data-theme", "dark");
    await toggle.click();
    await expect(html).toHaveAttribute("data-theme", "light");
    await assertNoHorizontalOverflow(page);
  });

  test("a deep link scrolls to the aya and highlights it", async ({ page }) => {
    await page.goto("/quran/2?aya=255");
    const aya = page.locator('[data-testid="aya"][data-aya="255"]');
    await expect(aya).toHaveClass(/selected/);
    await expect(aya).toBeInViewport();
    await assertNoHorizontalOverflow(page);
  });

  test("the jump form moves to another sura and aya", async ({ page }) => {
    await page.goto("/quran/1");
    await page.getByTestId("jump-sura").fill("112");
    await page.getByTestId("jump-aya").fill("3");
    await page.getByTestId("jump-go").click();
    await expect(page).toHaveURL(/\/quran\/112\?aya=3/);
    await expect(page.locator('[data-testid="aya"][data-aya="3"]')).toHaveClass(/selected/);
  });

  test("previous and next move between suras", async ({ page }) => {
    await page.goto("/quran/2");
    await page.getByTestId("prev-sura").click();
    await expect(page).toHaveURL(/\/quran\/1$/);
    await page.getByTestId("next-sura").click();
    await expect(page).toHaveURL(/\/quran\/2$/);
  });

  test("copying an aya puts the verse on the clipboard", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.goto("/quran/112");

    const actions = await openAyaActions(page, 1);

    // Compare against what the page actually renders rather than a re-typed
    // string: Arabic has several encodings for the same-looking word.
    const aya = page.locator('[data-testid="aya"][data-aya="1"]');
    const arabicOnPage = (await aya.getByTestId("aya-arabic").innerText()).replace(/١\s*$/, "").trim();
    const uyghurOnPage = (await aya.getByTestId("aya-uyghur").innerText()).trim();

    await actions.getByTestId("copy-arabic").click();
    await expect(page.getByTestId("quran-toast")).toHaveText("ئايەت كۆچۈرۈلدى");

    const arabicOnly = await page.evaluate(() => navigator.clipboard.readText());
    // The desktop wraps copied verses in the ornate Quran brackets.
    expect(arabicOnly).toContain("﴿");
    expect(arabicOnly).toContain(arabicOnPage);
    expect(arabicOnly).not.toContain("«");

    await actions.getByTestId("copy-with-translation").click();
    await expect(page.getByTestId("quran-toast")).toHaveText("ئايەت تەرجىمىسى بىلەن كۆچۈرۈلدى");
    const withTranslation = await page.evaluate(() => navigator.clipboard.readText());
    expect(withTranslation).toContain(arabicOnPage);
    expect(withTranslation).toContain(`«${uyghurOnPage}»`);
  });

  test("anonymous visitors get everything except the bookmark button", async ({ page }) => {
    await page.goto("/quran/113");
    await page.locator('[data-testid="aya"][data-aya="1"] [data-testid="aya-number"]').click();
    await expect(page.getByTestId("copy-arabic")).toBeVisible();
    await expect(page.getByTestId("aya-bookmark")).toHaveCount(0);
  });

  test("every control survives scrolling down and back up", async ({ page }) => {
    await page.goto("/quran/2");
    await scrollDownAndBackUp(page);

    for (const testId of [
      "quran-back",
      "quran-font-decrease",
      "quran-font-increase",
      "translation-toggle",
      "theme-toggle",
      "jump-sura",
      "jump-aya",
      "jump-go",
    ]) {
      const control = page.getByTestId(testId);
      await expect(control, `${testId} must stay visible`).toBeVisible();
      expect(await topMostTestIdAt(page, testId), `${testId} must not be covered`).toBe(testId);
      const box = await control.boundingBox();
      expect(box!.height, `${testId} touch target`).toBeGreaterThanOrEqual(44);
    }

    // Still usable, not merely visible.
    await page.getByTestId("translation-toggle").click();
    await expect(page.getByTestId("aya-uyghur")).toHaveCount(0);
    await assertNoHorizontalOverflow(page);
  });
});

test.describe("quran search", () => {
  test("finds an aya by Arabic, with or without tashkil", async ({ page }) => {
    for (const query of [BASMALA_PLAIN, BASMALA_TASHKIL]) {
      await page.goto(`/quran?q=${encodeURIComponent(query)}`);
      await expect(page.getByTestId("quran-search-results")).toBeVisible();
      const hit = page.locator('[data-testid="quran-search-result"][data-sura="1"][data-aya="1"]');
      await expect(hit, `«${query}» must find 1:1`).toHaveCount(1);

      // Results must show the Uthmani verse as it is written, vowel marks and
      // all — the highlight is applied to the original text, not to the
      // stripped form the index matched on. Asserted by counting the combining
      // marks rather than against a re-typed verse, which would only test
      // whether two encodings of the same-looking word happen to agree.
      const marked = hit.locator("mark").first();
      await expect(marked, "the match must be highlighted").toBeVisible();
      const markedText = await marked.innerText();
      const withoutTashkil = markedText.replace(/[ً-ٰٟۖ-ۭـ]/g, "");
      expect(
        markedText.length - withoutTashkil.length,
        `«${query}» must keep the verse's tashkil`,
      ).toBeGreaterThan(5);
    }
  });

  test("finds an aya by its Uyghur translation and opens it", async ({ page }) => {
    await page.goto("/quran");
    await page.getByTestId("quran-search-input").fill(UYGHUR_PHRASE);
    await page.getByTestId("quran-search-submit").click();

    const hit = page.locator('[data-testid="quran-search-result"][data-sura="1"][data-aya="2"]');
    await expect(hit).toHaveCount(1);
    await hit.click();

    await expect(page).toHaveURL(/\/quran\/1\?aya=2/);
    const aya = page.locator('[data-testid="aya"][data-aya="2"]');
    await expect(aya).toHaveClass(/selected/);
    await expect(aya).toBeInViewport();
  });

  test("reports an empty result rather than failing", async ({ page }) => {
    await page.goto("/quran?q=zzzqqq");
    await expect(page.getByTestId("quran-search-empty")).toBeVisible();
    await assertNoHorizontalOverflow(page);
  });

  test("book search stays separate from Quran search", async ({ page }) => {
    await page.goto("/search?q=%D9%82%D9%88%D8%B1%D8%A6%D8%A7%D9%86");
    // The book page never renders Quran hits…
    await expect(page.getByTestId("quran-search-results")).toHaveCount(0);
    // …it links to the Quran search instead, carrying the query across.
    const link = page.getByTestId("search-quran-link");
    await expect(link).toBeVisible();
    await link.click();
    await expect(page).toHaveURL(/\/quran\?q=/);
    await expect(page.getByTestId("search-results")).toHaveCount(0);
  });
});

test.describe("sura drawer", () => {
  test.skip(({ isMobile }) => !isMobile, "mobile viewports only");

  test("opens, closes and never traps page scroll", async ({ page }) => {
    await page.goto("/quran/1");
    const drawer = page.getByTestId("sura-drawer");
    await expect(drawer).not.toBeVisible();

    await page.getByTestId("sura-drawer-open").click();
    await expect(drawer).toBeVisible();
    await expect(drawer.getByTestId("sura-link")).toHaveCount(114);
    await expect(page.locator("html")).toHaveCSS("overflow", "hidden");

    await page.getByTestId("sura-drawer-close").click();
    await expect(drawer).not.toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.style.overflow);
    expect(overflow, "page scroll lock must be released").not.toBe("hidden");

    // The overlay tap closes it too, and a sura link navigates.
    await page.getByTestId("sura-drawer-open").click();
    await expect(drawer).toBeVisible();
    await page.getByTestId("sura-drawer-overlay").click({ position: { x: 10, y: 300 } });
    await expect(drawer).not.toBeVisible();

    await page.getByTestId("sura-drawer-open").click();
    await drawer.locator('[data-testid="sura-link"][data-sura="114"]').click();
    await expect(page).toHaveURL(/\/quran\/114$/);
    await expect(drawer).not.toBeVisible();
  });

  test("the drawer button still works after scrolling down and up", async ({ page }) => {
    await page.goto("/quran/2");
    await scrollDownAndBackUp(page);
    await page.getByTestId("sura-drawer-open").click();
    await expect(page.getByTestId("sura-drawer")).toBeVisible();
  });
});

test.describe("desktop mushaf", () => {
  test.skip(({ isMobile }) => !!isMobile, "desktop viewport only");

  test("the sura panel is permanently visible at 1280px", async ({ page }) => {
    await page.goto("/quran/1");
    await expect(page.getByTestId("sura-panel")).toBeVisible();
    await expect(page.getByTestId("sura-drawer-open")).not.toBeVisible();
  });
});

test.describe("aya bookmarks (signed in)", () => {
  test.use({ storageState: STAFF_STATE_PATH });

  test("bookmarks an aya, lists it under my bookmarks, then removes it", async ({ page }) => {
    await page.goto("/quran/113");
    const bookmark = (await openAyaActions(page, 1)).getByTestId("aya-bookmark");
    await expect(bookmark).toBeVisible();

    // Start from a known state — an earlier run may have left it bookmarked.
    // Wait for that toast to clear too, or the assertion below can read the
    // "removed" message instead of the "added" one it is looking for.
    if ((await bookmark.getAttribute("aria-pressed")) === "true") {
      await bookmark.click();
      await expect(bookmark).toHaveAttribute("aria-pressed", "false");
      await expect(page.getByTestId("quran-toast")).toHaveText("", { timeout: 5000 });
    }

    await bookmark.click();
    await expect(bookmark).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("quran-toast")).toHaveText("خەتكۈچ قوشۇلدى");

    // It survives a reload, so it really reached the database.
    await page.reload();
    await expect((await openAyaActions(page, 1)).getByTestId("aya-bookmark")).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    await page.goto("/my/bookmarks");
    const entry = page.getByTestId("quran-bookmark-jump").filter({ hasText: "فەلەق" });
    await expect(entry).toHaveCount(1);
    await entry.click();
    await expect(page).toHaveURL(/\/quran\/113\?aya=1/);

    // Clean up so the next viewport's run starts from the same state. The
    // button flips optimistically, so waiting on aria-pressed alone would let
    // the test end before the DELETE reached the database — the toast is
    // posted only after that write resolves.
    const again = (await openAyaActions(page, 1)).getByTestId("aya-bookmark");
    await again.click();
    await expect(again).toHaveAttribute("aria-pressed", "false");
    await expect(page.getByTestId("quran-toast")).toHaveText("خەتكۈچ ئېلىۋېتىلدى");
  });
});
