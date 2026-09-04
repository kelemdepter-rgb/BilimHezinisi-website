import { test, expect, type Page } from "@playwright/test";
import { SEED_BOOK_TITLE, hasStaffTestEnv, loadEnvLocal, readSeed } from "./env";

loadEnvLocal();

test.skip(!hasStaffTestEnv(), "Supabase env not configured");

/**
 * What the browser asks Supabase about the reader, and how often.
 *
 * Opening a book used to cost three GET /auth/v1/user round trips for a
 * signed-in reader — one each before saving the reading position, touching
 * recent reads and loading annotations — and every call site built its own
 * Supabase client, which @supabase/ssr complained about in the console.
 *
 * None of this is a security boundary and none of it may become one: every
 * table behind these calls carries owner-only RLS (`user_id =
 * (select auth.uid())`, migrations 0001 and 0007), so Postgres decides what
 * may be read and written. These tests are about wasted requests, and about
 * the signed-in reader losing nothing when they stop being made.
 */
function seededBookId(): number {
  const seed = readSeed();
  if (!seed) throw new Error("seed book missing — the setup project must run first");
  return seed.bookId;
}

/** Every response the page received, so a count is a count and not a guess. */
type Traffic = { authUser: string[]; auth: string[]; unauthorized: string[]; console: string[] };

function record(page: Page): Traffic {
  const traffic: Traffic = { authUser: [], auth: [], unauthorized: [], console: [] };
  page.on("response", (response) => {
    const url = response.url();
    if (url.includes("/auth/v1/")) traffic.auth.push(`${response.status()} ${url}`);
    if (url.includes("/auth/v1/user")) traffic.authUser.push(url);
    if (response.status() === 401) traffic.unauthorized.push(url);
  });
  page.on("console", (message) => traffic.console.push(message.text()));
  return traffic;
}

const GOTRUE_WARNING = "Multiple GoTrueClient instances";

/**
 * Every complaint auth-js made about how many clients share a storage key.
 *
 * There must be none. The reader used to build one client per call site, so
 * opening a book made three; and the anon-key client in
 * lib/supabase/public-client.ts made a fourth under the same default key,
 * which is what the warning was really counting. The session client is a
 * singleton now and the public client names its own key, so the two that are
 * deliberately separate no longer look like an accident.
 */
function extraClients(traffic: Traffic): string[] {
  return traffic.console.filter((line) => line.includes(GOTRUE_WARNING));
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

test.describe("a signed-out reader", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("opens a book without the browser asking who they are", async ({ page }) => {
    const traffic = record(page);
    await page.goto(`/books/${seededBookId()}/read`);
    await expect(page.getByTestId("reader-page").first()).toBeVisible();
    // The reading position, recent reads and annotations effects have all run
    // by now; give any request they might make time to appear.
    await page.waitForTimeout(2000);

    expect(traffic.authUser, "no GET /auth/v1/user for a visitor with no account").toEqual([]);
    expect(traffic.unauthorized, "nothing may answer 401").toEqual([]);
  });

  test("builds no more Supabase clients than it needs", async ({ page }) => {
    const traffic = record(page);
    await page.goto(`/books/${seededBookId()}/read`);
    await expect(page.getByTestId("reader-page").first()).toBeVisible();
    await page.goto("/quran/1");
    await expect(page.getByTestId("aya").first()).toBeVisible();
    await page.waitForTimeout(1000);

    expect(extraClients(traffic), "one client per storage key").toHaveLength(0);
  });

  test("reads on the narrowest phone with every control reachable", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await page.goto(`/books/${seededBookId()}/read`);
    await expect(page.getByTestId("reader-page").first()).toBeVisible();
    await assertNoHorizontalOverflow(page);

    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await page.waitForTimeout(300);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(300);

    for (const testId of ["reader-toolbar", "panel-toggle", "find-toggle"]) {
      await expect(page.getByTestId(testId), `${testId} after scrolling`).toBeVisible();
    }
    await assertNoHorizontalOverflow(page);
  });
});

test.describe("a signed-in reader", () => {
  test("opens a book without a round trip to the auth server", async ({ page }) => {
    const traffic = record(page);
    await page.goto(`/books/${seededBookId()}/read`);
    await expect(page.getByTestId("reader-page").first()).toBeVisible();
    await page.waitForTimeout(2000);

    // Four of these fired on every book opened before this — measured
    // 2026-09-04 at 380, 455, 222 and 303 ms. The session is read from the
    // cookie now; a token refresh (/auth/v1/token) is still allowed and is not
    // what this is about.
    expect(traffic.authUser, "the reader knows who it is without asking").toEqual([]);
    expect(traffic.unauthorized, "nothing may answer 401").toEqual([]);
    expect(extraClients(traffic), "one client per storage key").toHaveLength(0);
  });

  test("still saves the reading position and shows the book in recent reads", async ({ page }) => {
    const bookId = seededBookId();
    await page.goto(`/books/${bookId}/read?page=5`);
    await expect(page.getByTestId("reader-page").first()).toBeVisible();
    // saveProgress is debounced by 800 ms behind the scroll position.
    await page.waitForTimeout(2500);

    // Coming back with no ?page= must land where the reader left off, which
    // only works if the position reached the database.
    await page.goto(`/books/${bookId}/read`);
    await expect(page.getByTestId("restored-note")).toBeVisible({ timeout: 15_000 });

    await page.goto("/");
    await expect(page.getByTestId("recent-strip")).toContainText(SEED_BOOK_TITLE);
  });

  test("still adds, lists and deletes a bookmark and a note", async ({ page }) => {
    const bookId = seededBookId();
    const answers: string[] = [];
    page.on("dialog", (dialog) => {
      answers.push(dialog.message());
      void dialog.accept(dialog.message().startsWith("خەتكۈچ") ? "سىناق خەتكۈچ" : "سىناق خاتىرە");
    });

    await page.goto(`/books/${bookId}/read`);
    await expect(page.getByTestId("reader-page").first()).toBeVisible();

    await page.getByTestId("add-bookmark").click();
    await expect.poll(() => answers.length, { timeout: 10_000 }).toBeGreaterThan(0);

    const panel = page.getByTestId("reader-panel");
    await page.getByTestId("panel-toggle").click();
    await expect(panel).toBeVisible();
    await expect(panel.getByText("سىناق خەتكۈچ")).toBeVisible({ timeout: 15_000 });

    // Notes live behind their own tab, and adding one opens the same prompt.
    await panel.getByRole("tab", { name: /خاتىرە/ }).click();
    await panel.getByRole("button", { name: /خاتىرە قوشۇش/ }).click();
    await expect(panel.getByText("سىناق خاتىرە")).toBeVisible({ timeout: 15_000 });

    // Both must survive a reload — that is what proves they were written.
    await page.reload();
    await page.getByTestId("panel-toggle").click();
    await expect(panel.getByText("سىناق خەتكۈچ")).toBeVisible({ timeout: 15_000 });

    // …and both must be removable again, so the library is left as it was.
    for (const label of ["سىناق خەتكۈچ", "سىناق خاتىرە"]) {
      const tab = label.endsWith("خەتكۈچ") ? /خەتكۈچ/ : /خاتىرە/;
      await panel.getByRole("tab", { name: tab }).click();
      const row = panel.locator("li").filter({ hasText: label });
      await expect(row).toHaveCount(1);
      await row.getByRole("button", { name: "ئۆچۈرۈش" }).click();
      await expect(row).toHaveCount(0, { timeout: 15_000 });
    }
  });

  test("builds one session client across the reader, the mushaf and the notebook", async ({
    page,
  }) => {
    const traffic = record(page);
    await page.goto(`/books/${seededBookId()}/read`);
    await expect(page.getByTestId("reader-page").first()).toBeVisible();
    await page.goto("/quran/1");
    await expect(page.getByTestId("aya").first()).toBeVisible();
    await page.goto("/notes");
    await expect(page).toHaveURL(/\/notes/);
    await page.waitForTimeout(1500);

    expect(extraClients(traffic), "one client per storage key").toHaveLength(0);
  });
});
