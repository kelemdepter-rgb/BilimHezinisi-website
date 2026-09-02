import { test, expect, type Locator, type Page } from "@playwright/test";
import { hasStaffTestEnv, loadEnvLocal } from "./env";

loadEnvLocal();

test.skip(!hasStaffTestEnv(), "Supabase env not configured");

/**
 * Choosing WHERE to search, before searching.
 *
 * The scope control lives inside the search box on every page, so a reader who
 * only wants «ھەدىسلەر» does not have to search the whole library first and
 * narrow it afterwards. Anonymous throughout — most of this audience has no
 * account, and the picker has to work for them.
 */

/** The header box is hidden below md; there the magnifier opens its own panel. */
function narrow(page: Page): boolean {
  return (page.viewportSize()?.width ?? 0) < 768;
}

function scopeTestId(page: Page): string {
  return narrow(page) ? "header-scope-mobile" : "header-scope";
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

/** Bring the header's search box into view, whatever the width. */
async function revealHeaderBox(page: Page): Promise<Locator> {
  if (narrow(page)) {
    const opener = page.getByRole("button", { name: "ئىزدەش رامكىسىنى ئېچىش" });
    if ((await opener.getAttribute("aria-expanded")) !== "true") await opener.click();
  }
  const button = page.getByTestId(scopeTestId(page));
  await expect(button).toBeVisible();
  return button;
}

/** Open the picker and hand back its button and its panel. */
async function openScope(page: Page): Promise<{ button: Locator; panel: Locator }> {
  const button = await revealHeaderBox(page);
  await button.click();
  const panel = page.getByTestId(`${scopeTestId(page)}-panel`);
  await expect(panel).toBeVisible();
  return { button, panel };
}

/**
 * The category list is rendered twice — the desktop aside and the mobile
 * drawer — and both are always in the DOM. Assertions read the aside, so a
 * count is a count and not a count of two copies.
 */
function sidebar(page: Page): Locator {
  return page.getByTestId("sidebar-desktop");
}

/** A category id that actually holds books, read off the sidebar. */
async function categoryWithBooks(page: Page): Promise<string> {
  const link = sidebar(page).getByTestId("category-link").first();
  const id = await link.getAttribute("data-category-id");
  expect(id, "the library must have at least one category holding books").toBeTruthy();
  return id!;
}

test.describe("the scope control in the search box", () => {
  for (const path of ["/", "/quran"]) {
    test(`reads «بارلىق كىتابلار» by default on ${path}`, async ({ page }) => {
      await page.goto(path);
      const button = await revealHeaderBox(page);
      await expect(button).toHaveAttribute("data-scope", "all");
      // The label collapses to an icon below lg, so the full name is asserted
      // where it always lives: the accessible name.
      await expect(button).toHaveAttribute("aria-label", "ئىزدەش دائىرىسى: بارلىق كىتابلار");
    });
  }

  test("still reads «بارلىق كىتابلار» while browsing inside a category", async ({ page }) => {
    await page.goto("/");
    const categoryId = await categoryWithBooks(page);

    await page.goto(`/?cat=${categoryId}`);
    const button = await revealHeaderBox(page);
    await expect(button).toHaveAttribute("data-scope", "all");
    await expect(button).toHaveAttribute("aria-label", "ئىزدەش دائىرىسى: بارلىق كىتابلار");
  });

  test("opens a panel listing every category with its book count", async ({ page }) => {
    await page.goto("/");
    // The sidebar is the reference: the panel must show the same categories.
    const inSidebar =
      (await sidebar(page).getByTestId("category-link").count()) +
      (await sidebar(page).getByTestId("category-empty").count());
    expect(inSidebar, "the library must have categories to scope by").toBeGreaterThan(0);

    const { panel } = await openScope(page);
    await expect(panel.getByTestId(`${scopeTestId(page)}-all`)).toBeVisible();
    await expect(panel.getByTestId(`${scopeTestId(page)}-all`)).toContainText("ھەممە كىتابلار");

    const options = panel.getByTestId(`${scopeTestId(page)}-option`);
    await expect(options).toHaveCount(inSidebar);

    // Every row ends in a number — the count of published books it holds.
    for (const text of await options.allInnerTexts()) {
      expect(text.trim(), `«${text.trim()}» must carry a count`).toMatch(/\d+\s*$/);
    }
  });

  test("greys out a category holding nothing, and refuses to scope by it", async ({ page }) => {
    await page.goto("/");
    const { button, panel } = await openScope(page);

    const empty = panel.locator('[role="option"][aria-disabled="true"]').first();
    const emptyCount = await panel.locator('[role="option"][aria-disabled="true"]').count();
    test.skip(emptyCount === 0, "no empty category in the library right now");

    await expect(empty).toBeVisible();
    await expect(empty).toContainText(/\b0\s*$/);
    // Playwright refuses to click an aria-disabled control, which is the first
    // half of the proof; force the tap anyway for the second half.
    await expect(empty).toBeDisabled();
    await empty.click({ force: true });

    // Nothing happened: the panel is still open and the scope is untouched.
    await expect(panel).toBeVisible();
    await expect(button).toHaveAttribute("data-scope", "all");
  });

  test("the sidebar shows the same numbers, and greys the same rows", async ({ page }) => {
    await page.goto("/");
    const { panel } = await openScope(page);

    const options = panel.getByTestId(`${scopeTestId(page)}-option`);
    for (const option of await options.all()) {
      const id = await option.getAttribute("data-category-id");
      const text = (await option.innerText()).trim();
      const count = text.match(/(\d+)\s*$/)?.[1];
      const disabled = (await option.getAttribute("aria-disabled")) === "true";

      const row = sidebar(page).locator(
        `[data-testid="${disabled ? "category-empty" : "category-link"}"][data-category-id="${id}"]`,
      );
      await expect(row, `category ${id} must appear in the sidebar the same way`).toHaveCount(1);
      // textContent, not innerText: below lg the aside is display:none, and a
      // hidden element has no rendered text to read.
      expect(
        ((await row.textContent()) ?? "").trim(),
        `category ${id} must show the same count`,
      ).toContain(count!);
    }
  });

  test("closes on an outside tap and on Escape", async ({ page }) => {
    await page.goto("/");
    const { panel } = await openScope(page);
    await page.locator("main").click({ position: { x: 5, y: 5 } });
    await expect(panel).toBeHidden();

    const reopened = await openScope(page);
    await page.keyboard.press("Escape");
    await expect(reopened.panel).toBeHidden();
  });

  test("scrolls inside itself and never locks the page behind it", async ({ page }) => {
    await page.goto("/");
    const { panel } = await openScope(page);

    const box = await panel.evaluate((element) => ({
      scrollHeight: element.scrollHeight,
      clientHeight: element.clientHeight,
      overflowY: getComputedStyle(element).overflowY,
      overscroll: getComputedStyle(element).overscrollBehaviorY,
    }));
    expect(box.overflowY).toBe("auto");
    expect(box.overscroll).toBe("contain");
    expect(box.scrollHeight, "17 categories must not make the panel taller than the screen")
      .toBeGreaterThan(box.clientHeight);

    // Body scroll is never taken away — not while it is open, nor after.
    expect(await page.evaluate(() => document.documentElement.style.overflow)).toBe("");
    await page.keyboard.press("Escape");
    await expect(panel).toBeHidden();
    await page.evaluate(() => window.scrollTo(0, 400));
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  });

  test("choosing a category and searching lands on that category's results", async ({ page }) => {
    await page.goto("/");
    const { button, panel } = await openScope(page);

    const pick = panel.locator('[role="option"][data-category-id]:not([aria-disabled="true"])').first();
    const categoryId = await pick.getAttribute("data-category-id");
    const name = (await pick.innerText()).trim().replace(/\s*\d+$/, "");
    await pick.click();
    await expect(panel).toBeHidden();
    await expect(button).toHaveAttribute("data-scope", categoryId!);

    const input = page.getByTestId(narrow(page) ? "header-search-mobile" : "header-search");
    await input.fill("ناماز");
    await input.press("Enter");

    await page.waitForURL(new RegExp(`/search\\?.*cat=${categoryId}`));
    // The results page mirrors it, so the reader can see and change what is
    // filtering what they are looking at.
    const onPage = page.getByTestId("search-scope");
    await expect(onPage).toBeVisible();
    await expect(onPage).toHaveAttribute("data-scope", categoryId!);
    await expect(onPage).toHaveAttribute("aria-label", `ئىزدەش دائىرىسى: ${name}`);
    await expect(page.getByTestId("search-meta").or(page.getByTestId("search-empty"))).toBeVisible();
  });

  test("the header's own box goes back to the whole library after a search", async ({ page }) => {
    await page.goto("/search?q=%D9%86%D8%A7%D9%85%D8%A7%D8%B2");
    const button = await revealHeaderBox(page);
    await expect(button).toHaveAttribute("data-scope", "all");
  });

  test("submits nothing extra while «بارلىق كىتابلار» stands", async ({ page }) => {
    await page.goto("/");
    await revealHeaderBox(page);
    const input = page.getByTestId(narrow(page) ? "header-search-mobile" : "header-search");
    await input.fill("ناماز");
    await input.press("Enter");
    await page.waitForURL(/\/search\?/);
    expect(new URL(page.url()).searchParams.has("cat")).toBe(false);
  });
});

test.describe("at 360 px, the narrowest phone this library is read on", () => {
  test("nothing overflows, and the input stays usable", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 720 });

    for (const path of ["/", "/search?q=%D9%86%D8%A7%D9%85%D8%A7%D8%B2", "/quran"]) {
      await page.goto(path);
      await assertNoHorizontalOverflow(page);
    }

    await page.goto("/");
    const { panel } = await openScope(page);
    await assertNoHorizontalOverflow(page);
    const panelBox = await panel.boundingBox();
    expect(panelBox!.x).toBeGreaterThanOrEqual(0);
    expect(panelBox!.x + panelBox!.width).toBeLessThanOrEqual(361);

    // The box is still a search box: the input keeps a usable width and the
    // placeholder has not vanished.
    const input = page.getByTestId("header-search-mobile");
    const inputBox = await input.boundingBox();
    expect(inputBox!.width, "the input must not be squeezed away").toBeGreaterThanOrEqual(96);
    await expect(input).toHaveAttribute("placeholder", /\S/);
  });

  test("every header control is still there after scrolling down and back up", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 720 });
    await page.goto("/");
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await page.evaluate(() => window.scrollTo(0, 0));

    for (const testId of ["menu-button", "quran-link", "theme-toggle"]) {
      await expect(page.getByTestId(testId)).toBeVisible();
    }
    const { button, panel } = await openScope(page);
    await expect(button).toBeVisible();
    await expect(panel).toBeVisible();
    const buttonBox = await button.boundingBox();
    expect(buttonBox!.height, "touch target must be at least 44 px").toBeGreaterThanOrEqual(44);
  });
});

test.describe("the results page's own control", () => {
  test("mirrors ?cat=, and can be set back to the whole library", async ({ page }) => {
    await page.goto("/");
    const categoryId = await categoryWithBooks(page);
    await page.goto(`/search?q=%D9%86%D8%A7%D9%85%D8%A7%D8%B2&cat=${categoryId}`);

    const control = page.getByTestId("search-scope");
    await expect(control).toBeVisible();
    await expect(control).toHaveAttribute("data-scope", categoryId);

    await control.click();
    const panel = page.getByTestId("search-scope-panel");
    await expect(panel).toBeVisible();
    await panel.getByTestId("search-scope-all").click();
    await expect(control).toHaveAttribute("data-scope", "all");

    await page.getByTestId("search-submit").click();
    await page.waitForURL(/\/search\?/);
    expect(new URL(page.url()).searchParams.has("cat")).toBe(false);
  });

  test("is reachable by keyboard, and arrow keys walk the rows", async ({ page }) => {
    await page.goto("/search?q=%D9%86%D8%A7%D9%85%D8%A7%D8%B2");
    const control = page.getByTestId("search-scope");
    // Open and close it once first: a key pressed before React has hydrated
    // reaches nothing, and this test is about the handler, not the timing.
    await control.click();
    await expect(page.getByTestId("search-scope-panel")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("search-scope-panel")).toBeHidden();

    await control.press("ArrowDown");
    await expect(page.getByTestId("search-scope-panel")).toBeVisible();

    const focused = () => page.evaluate(() => document.activeElement?.getAttribute("role"));
    expect(await focused()).toBe("option");
    await page.keyboard.press("ArrowDown");
    expect(await focused()).toBe("option");

    // Enter chooses whatever the arrows landed on.
    const id = await page.evaluate(() =>
      document.activeElement?.getAttribute("data-category-id"),
    );
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("search-scope-panel")).toBeHidden();
    if (id) await expect(control).toHaveAttribute("data-scope", id);
  });
});
