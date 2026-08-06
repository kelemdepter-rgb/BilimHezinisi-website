import { test, expect, type Page } from "@playwright/test";
import { hasStaffTestEnv, loadEnvLocal } from "./env";

loadEnvLocal();

test.skip(!hasStaffTestEnv(), "Supabase env not configured");

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
  await page.evaluate(() => window.scrollTo(0, 0));
}

test.describe("admin access", () => {
  test("staff session reaches the admin pages", async ({ page }) => {
    await page.goto("/admin");
    await expect(page.getByRole("heading", { name: "باشقۇرۇش سۇپىسى" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "باشقۇرۇش تىزىملىكى" })).toBeVisible();
    await assertNoHorizontalOverflow(page);
  });

  test("uploader cannot reach user management", async ({ page }) => {
    // /admin/users is admin-only; an uploader is bounced back to the dashboard.
    await page.goto("/admin/users");
    await expect(page).toHaveURL(/\/admin$/);
  });

  test("anonymous visitors are redirected away from every admin page", async ({ browser }) => {
    const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const page = await context.newPage();
    for (const path of ["/admin", "/admin/books", "/admin/categories", "/admin/books/new"]) {
      await page.goto(path);
      await expect(page, `${path} must not render for anonymous visitors`).toHaveURL(/\/login/);
    }
    await context.close();
  });
});

test.describe("category management", () => {
  const NAME_A = "__e2e_tur_a__";
  const NAME_B = "__e2e_tur_b__";

  async function addCategory(page: Page, name: string) {
    await page.locator('input[name="name"]').fill(name);
    await page.getByTestId("category-add").click();
    await expect(page.getByTestId("category-list")).toContainText(name, { timeout: 20_000 });
  }

  async function removeCategory(page: Page, name: string) {
    const row = page.getByTestId("category-row").filter({ hasText: name });
    if ((await row.count()) === 0) return;
    page.once("dialog", (dialog) => dialog.accept());
    await row.first().getByRole("button", { name: `${name} — ئۆچۈرۈش` }).click();
    await expect(page.getByTestId("category-list")).not.toContainText(name, { timeout: 20_000 });
  }

  test("moves a category with the button fallback, no dragging required", async ({ page }) => {
    await page.goto("/admin/categories");
    await expect(page.getByRole("heading", { name: "تۈرلەرنى باشقۇرۇش" })).toBeVisible();

    try {
      await addCategory(page, NAME_A);
      await addCategory(page, NAME_B);

      const rowB = page.getByTestId("category-row").filter({ hasText: NAME_B }).first();
      // Nothing is nested yet, so B cannot be promoted any further.
      await expect(rowB.getByTestId("category-outdent")).toBeDisabled();

      // Indent B under its previous sibling using the button, not a drag.
      await rowB.getByTestId("category-indent").click();

      // Once nested, promoting it becomes available — the move really persisted.
      await expect(rowB.getByTestId("category-outdent")).toBeEnabled({ timeout: 20_000 });

      // And it survives a reload, so the change reached the database.
      await page.reload();
      const reloadedB = page.getByTestId("category-row").filter({ hasText: NAME_B }).first();
      await expect(reloadedB.getByTestId("category-outdent")).toBeEnabled();

      await assertNoHorizontalOverflow(page);
    } finally {
      await removeCategory(page, NAME_B);
      await removeCategory(page, NAME_A);
    }
  });

  test("offers a button for every drag-and-drop move", async ({ page }) => {
    await page.goto("/admin/categories");
    const first = page.getByTestId("category-row").first();
    if ((await page.getByTestId("category-row").count()) === 0) {
      test.skip(true, "no categories seeded yet");
    }
    await expect(first.getByTestId("category-up")).toBeVisible();
    await expect(first.getByTestId("category-down")).toBeVisible();
    await expect(first.getByTestId("category-indent")).toBeVisible();
    await expect(first.getByTestId("category-outdent")).toBeVisible();
  });

  test("keeps controls reachable after scrolling down and back up", async ({ page }) => {
    await page.goto("/admin/categories");
    await scrollDownAndBackUp(page);
    const addButton = page.getByTestId("category-add");
    await expect(addButton).toBeVisible();
    await expect(addButton).toBeEnabled();
    await assertNoHorizontalOverflow(page);
  });
});

test.describe("upload wizard", () => {
  test("renders the first step with its actions visible", async ({ page }) => {
    await page.goto("/admin/books/new");
    await expect(page.getByRole("heading", { name: "يېڭى كىتاب قوشۇش" })).toBeVisible();
    await expect(page.getByTestId("wizard-step-0")).toHaveAttribute("aria-current", "step");
    await expect(page.getByTestId("wizard-next")).toBeVisible();
    await expect(page.getByTestId("wizard-cancel")).toBeVisible();
    await assertNoHorizontalOverflow(page);
  });

  test("steps forward through extract, chunk, metadata and cover", async ({ page }) => {
    await page.goto("/admin/books/new");

    // A tiny in-memory text file keeps the test fast and hermetic.
    const paragraph = "بۇ سىناق پاراگرافى. ".repeat(40);
    await page.getByTestId("wizard-file-input").setInputFiles({
      name: "e2e-sinaq.txt",
      mimeType: "text/plain",
      buffer: Buffer.from([paragraph, paragraph, paragraph].join("\n\n"), "utf8"),
    });
    await expect(page.getByTestId("wizard-queue")).toContainText("e2e-sinaq.txt");

    await page.getByTestId("wizard-next").click();
    await expect(page.getByTestId("wizard-step-1")).toHaveAttribute("aria-current", "step");
    await expect(page.getByText("ئوقۇش تامام ✓")).toBeVisible({ timeout: 20_000 });

    await page.getByTestId("wizard-next").click();
    await expect(page.getByRole("heading", { name: "بەتلەرگە بۆلۈندى" })).toBeVisible();

    await page.getByTestId("wizard-next").click();
    await expect(page.getByTestId("meta-title")).toHaveValue("e2e-sinaq");

    await page.getByTestId("wizard-next").click();
    await expect(page.getByRole("heading", { name: "مۇقاۋا ۋە ئەسلى ھۆججەت" })).toBeVisible();

    await assertNoHorizontalOverflow(page);
  });

  test("action bar stays clickable after scrolling down and back up", async ({ page }) => {
    await page.goto("/admin/books/new");
    await scrollDownAndBackUp(page);

    const next = page.getByTestId("wizard-next");
    await expect(next).toBeVisible();

    // The sticky bar must not be covering its own buttons.
    const box = await next.boundingBox();
    expect(box).not.toBeNull();
    const topMost = await page.evaluate(
      ([x, y]) => {
        const element = document.elementFromPoint(x, y);
        return element?.closest("[data-testid]")?.getAttribute("data-testid") ?? null;
      },
      [box!.x + box!.width / 2, box!.y + box!.height / 2] as const,
    );
    expect(topMost).toBe("wizard-next");
    await expect(page.getByTestId("wizard-cancel")).toBeVisible();
  });
});

test.describe("book management", () => {
  test("renders the list and search without overflow", async ({ page }) => {
    await page.goto("/admin/books");
    await expect(page.getByRole("heading", { name: "كىتابلار" })).toBeVisible();
    // Scoped by label: the site header carries its own role="search" box.
    await expect(page.getByRole("searchbox", { name: "كىتاب ئىزدەش" })).toBeVisible();
    await scrollDownAndBackUp(page);
    await expect(page.getByRole("link", { name: "يېڭى كىتاب" })).toBeVisible();
    await assertNoHorizontalOverflow(page);
  });
});
