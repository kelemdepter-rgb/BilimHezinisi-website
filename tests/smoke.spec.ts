import { test, expect, type Page } from "@playwright/test";

async function assertNoHorizontalOverflow(page: Page) {
  const metrics = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(metrics.scrollWidth, "page must not scroll horizontally").toBeLessThanOrEqual(
    metrics.innerWidth + 1,
  );
}

test.describe("app shell", () => {
  test("home renders RTL with the Uyghur brand", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(page.locator("html")).toHaveAttribute("lang", "ug");
    await expect(page.getByRole("link", { name: "باش بەت — بىلىم خەزىنىسى" })).toBeVisible();
    // Assert the library itself, not the welcome panel — that only shows for a
    // signed-out visitor while the library is still empty.
    await expect(page.getByTestId("book-list").or(page.getByTestId("library-empty"))).toBeVisible();
  });

  test("no horizontal overflow, including after scrolling to the bottom", async ({ page }) => {
    await page.goto("/");
    await assertNoHorizontalOverflow(page);
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await assertNoHorizontalOverflow(page);
  });

  test("login page renders in Uyghur with ≥44px controls", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByRole("heading", { name: "كىرىش" })).toBeVisible();
    await expect(page.locator('input[name="email"]')).toBeVisible();
    await expect(page.locator('input[name="password"]')).toBeVisible();
    const submit = page.getByRole("button", { name: "كىرىش" });
    await expect(submit).toBeVisible();
    const box = await submit.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.height, "touch target must be at least 44px tall").toBeGreaterThanOrEqual(44);
    await assertNoHorizontalOverflow(page);
  });

  test("theme toggle cycles light → sepia → dark and persists", async ({ page }) => {
    await page.goto("/");
    const html = page.locator("html");
    const toggle = page.getByTestId("theme-toggle");
    await toggle.click();
    await expect(html).toHaveAttribute("data-theme", "sepia");
    await toggle.click();
    await expect(html).toHaveAttribute("data-theme", "dark");
    await page.reload();
    await expect(html).toHaveAttribute("data-theme", "dark");
  });

  test("header controls remain clickable after scrolling down and back up", async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await page.evaluate(() => window.scrollTo(0, 0));
    const toggle = page.getByTestId("theme-toggle");
    await expect(toggle).toBeVisible();
    await toggle.click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "sepia");
  });
});

test.describe("mobile drawer", () => {
  test.skip(({ isMobile }) => !isMobile, "mobile viewports only");

  test("drawer opens, closes, and does not trap body scroll", async ({ page }) => {
    await page.goto("/");
    const drawer = page.getByTestId("drawer");
    await expect(drawer).not.toBeVisible();

    await page.getByTestId("menu-button").click();
    await expect(drawer).toBeVisible();
    // Whatever the library holds, the drawer must show its category nav.
    await expect(drawer.getByRole("navigation", { name: "كىتاب تۈرلىرى" })).toBeVisible();

    // While open the page must be locked...
    await expect(page.locator("html")).toHaveCSS("overflow", "hidden");

    await page.getByTestId("drawer-close").click();
    await expect(drawer).not.toBeVisible();

    // ...and released again on close. Asserted on the lock itself rather than
    // by scrolling, which proves nothing when the library is short enough to
    // fit the viewport.
    const overflow = await page.evaluate(() => document.documentElement.style.overflow);
    expect(overflow, "body scroll lock must be released").not.toBe("hidden");

    // The overlay tap must close it too (tap on the side not covered by the drawer).
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.getByTestId("menu-button").click();
    await expect(drawer).toBeVisible();
    await page.getByTestId("drawer-overlay").click({ position: { x: 10, y: 300 } });
    await expect(drawer).not.toBeVisible();
  });

  test("menu button still opens the drawer after scroll down and up", async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.getByTestId("menu-button").click();
    await expect(page.getByTestId("drawer")).toBeVisible();
  });
});

test.describe("desktop layout", () => {
  test.skip(({ isMobile }) => !!isMobile, "desktop viewport only");

  test("category sidebar is permanently visible at 1280px", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("sidebar-desktop")).toBeVisible();
    await expect(page.getByTestId("menu-button")).not.toBeVisible();
  });
});
