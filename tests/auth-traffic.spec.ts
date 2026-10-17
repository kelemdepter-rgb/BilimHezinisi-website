import { test, expect, type Locator, type Page, type Response } from "@playwright/test";
import { RUN_ID, SEED_BOOK_TITLE, hasStaffTestEnv, loadEnvLocal, readSeed } from "./env";
import { adminClient, signedInUserId } from "./fixtures/notes";

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

/** A request that writes a new row into `table`. */
function isInsert(table: "bookmarks" | "book_notes") {
  return (response: Response) =>
    response.request().method() === "POST" && response.url().includes(`/rest/v1/${table}?`);
}

/** The id of the row an insert wrote, from its answer. */
async function insertedId(response: Response): Promise<number> {
  const body = (await response.json()) as { id: number } | { id: number }[];
  return Array.isArray(body) ? body[0].id : body.id;
}

/**
 * «خەتكۈچ قوشۇش» through the toolbar's form: name it, save it, and wait for
 * the database to have it. Returns the saved row's id.
 */
async function addBookmarkThroughForm(page: Page, name: string): Promise<number> {
  await page.getByTestId("add-bookmark").click();
  const form = page.getByTestId("annotation-form");
  await expect(form).toHaveAttribute("data-kind", "bookmark");
  await form.getByTestId("annotation-input").fill(name);
  const saved = page.waitForResponse(isInsert("bookmarks"));
  await form.getByTestId("annotation-save").click();
  const response = await saved;
  expect(response.ok(), "the bookmark is saved").toBe(true);
  await expect(form).toHaveCount(0);
  return insertedId(response);
}

/**
 * «خاتىرە قوشۇش» in the panel: the panel steps aside for the form and comes
 * back once the note is saved. Returns the saved row's id.
 */
async function addNoteThroughForm(page: Page, text: string): Promise<number> {
  const panel = page.getByTestId("reader-panel");
  await panel.getByRole("tab", { name: /خاتىرە/ }).click();
  await panel.getByRole("button", { name: /خاتىرە قوشۇش/ }).click();
  const form = page.getByTestId("annotation-form");
  await expect(form).toHaveAttribute("data-kind", "note");
  await form.getByTestId("annotation-input").fill(text);
  const saved = page.waitForResponse(isInsert("book_notes"));
  await form.getByTestId("annotation-save").click();
  const response = await saved;
  expect(response.ok(), "the note is saved").toBe(true);
  await expect(form).toHaveCount(0);
  await expect(panel).toBeVisible();
  return insertedId(response);
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
    // This run's own labels. The account and the seeded book are shared by
    // every attempt in a run, so a fixed label also matched whatever an
    // earlier, failed attempt had left behind — two rows, and a strict-mode
    // failure that said nothing about bookmarking.
    const bookmark = `سىناق خەتكۈچ ${RUN_ID}`;
    const note = `سىناق خاتىرە ${RUN_ID}`;

    try {
      await page.goto(`/books/${bookId}/read`);
      await expect(page.getByTestId("reader-page").first()).toBeVisible();

      await addBookmarkThroughForm(page, bookmark);

      const panel = page.getByTestId("reader-panel");
      await page.getByTestId("panel-toggle").click();
      await expect(panel).toBeVisible();
      await expect(panel.getByText(bookmark)).toBeVisible({ timeout: 15_000 });

      // Notes live behind their own tab, and adding one opens the same form.
      await addNoteThroughForm(page, note);
      await expect(panel.getByText(note)).toBeVisible({ timeout: 15_000 });

      // Both must survive a reload — that is what proves they were written.
      await page.reload();
      await page.getByTestId("panel-toggle").click();
      await expect(panel.getByText(bookmark)).toBeVisible({ timeout: 15_000 });

      // …and both must be removable again, so the library is left as it was.
      for (const [label, tab] of [
        [bookmark, /خەتكۈچ/],
        [note, /خاتىرە/],
      ] as const) {
        await panel.getByRole("tab", { name: tab }).click();
        const row = panel.locator("li").filter({ hasText: label });
        await expect(row).toHaveCount(1);
        await row.getByRole("button", { name: "ئۆچۈرۈش" }).click();
        await expect(row).toHaveCount(0, { timeout: 15_000 });
      }
    } finally {
      // Whatever an attempt that stopped half-way left, and only that: this
      // account's rows on this book with this run's labels.
      const userId = await signedInUserId(page);
      const admin = adminClient();
      await admin.from("bookmarks").delete().eq("user_id", userId).eq("book_id", bookId).eq("name", bookmark);
      await admin.from("book_notes").delete().eq("user_id", userId).eq("book_id", bookId).eq("text", note);
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

/**
 * A bookmark or a note added while the reader's first load of them is still
 * on its way (2026-10-17).
 *
 * The reader loads this book's bookmarks and notes once, as it opens. On a
 * slow connection the database can READ that list before the reader adds
 * something and DELIVER it after — and the late answer used to replace the
 * panel's list, so a bookmark that was saved vanished from the panel until a
 * reload, and readers added it again. Here the first load is read at once and
 * held back until the additions have been saved: the order a slow phone
 * produces, made certain.
 */
test.describe("added while the first load is still on its way", () => {
  // page.route cannot see a request the site's service worker answers.
  test.use({ serviceWorkers: "block" });

  test("a bookmark and a note stay listed when the load lands after them", async ({ page }) => {
    const bookId = seededBookId();
    const userId = await signedInUserId(page);
    const admin = adminClient();
    // Already there before the book opens: what the late answer brings.
    const oldBookmark = `كونا خەتكۈچ ${RUN_ID}`;
    const oldNote = `كونا خاتىرە ${RUN_ID}`;
    // Added while it is on its way.
    const newBookmark = `يېڭى خەتكۈچ ${RUN_ID}`;
    const newNote = `يېڭى خاتىرە ${RUN_ID}`;

    let deliver!: () => void;
    const held = new Promise<void>((resolve) => (deliver = resolve));
    let asked = 0;
    let read = 0;
    try {
      const seeded = await Promise.all([
        admin.from("bookmarks").insert({ user_id: userId, book_id: bookId, page_no: 2, position: 0, name: oldBookmark }),
        admin.from("book_notes").insert({ user_id: userId, book_id: bookId, page_no: 2, position: 0, text: oldNote }),
      ]);
      for (const { error } of seeded) expect(error).toBeNull();

      await page.route(/\/rest\/v1\/(bookmarks|book_notes)\?/, async (route) => {
        if (route.request().method() !== "GET") return route.continue();
        // Read now, before anything is added; delivered only when released.
        asked += 1;
        const response = await route.fetch();
        read += 1;
        await held;
        await route.fulfill({ response });
      });

      await page.goto(`/books/${bookId}/read`);
      await expect(page.getByTestId("reader-page").first()).toBeVisible();
      // Both lists have been read by the database, and none has arrived. In
      // development React runs the loading effect twice, so there may be two
      // of each; every one asked for must be read before anything is added.
      const settled = async () => {
        await page.waitForTimeout(500);
        return read >= 2 && read === asked;
      };
      await expect.poll(settled, { timeout: 15_000 }).toBe(true);

      await addBookmarkThroughForm(page, newBookmark);

      const panel = page.getByTestId("reader-panel");
      await page.getByTestId("panel-toggle").click();
      await expect(panel).toBeVisible();
      await expect(panel.getByText(newBookmark)).toBeVisible();

      await addNoteThroughForm(page, newNote);
      await expect(panel.getByText(newNote)).toBeVisible();

      // The load lands. What it brings appears — and what was added stays.
      deliver();
      await expect(panel.getByText(oldNote)).toBeVisible({ timeout: 15_000 });
      await expect(panel.getByText(newNote)).toBeVisible();
      await expect(panel.getByRole("tab", { name: /خاتىرە/ })).toContainText("(2)");
      await panel.getByRole("tab", { name: /خەتكۈچ/ }).click();
      await expect(panel.getByText(oldBookmark)).toBeVisible();
      await expect(panel.getByText(newBookmark)).toBeVisible();
      await expect(panel.getByRole("tab", { name: /خەتكۈچ/ })).toContainText("(2)");

      // And they were really written: a fresh load lists all four.
      await page.unroute(/\/rest\/v1\/(bookmarks|book_notes)\?/);
      await page.reload();
      await page.getByTestId("panel-toggle").click();
      await expect(panel.getByText(newBookmark)).toBeVisible({ timeout: 15_000 });
      await expect(panel.getByText(oldBookmark)).toBeVisible();
    } finally {
      deliver();
      await admin
        .from("bookmarks")
        .delete()
        .eq("user_id", userId)
        .eq("book_id", bookId)
        .in("name", [oldBookmark, newBookmark]);
      await admin
        .from("book_notes")
        .delete()
        .eq("user_id", userId)
        .eq("book_id", bookId)
        .in("text", [oldNote, newNote]);
    }
  });
});

/**
 * The form that names a bookmark and writes a note (2026-10-17). It replaced
 * `window.prompt`: one line only, the browser's look rather than the reader's,
 * and different again in the installed app. Every text is invented, and every
 * row a test makes is removed by its id.
 */
test.describe("the bookmark and note form", () => {
  /** Every insert into the two tables, as the browser sent it. */
  function countInserts(page: Page) {
    const inserts = { bookmarks: 0, book_notes: 0 };
    page.on("request", (request) => {
      if (request.method() !== "POST") return;
      if (request.url().includes("/rest/v1/bookmarks?")) inserts.bookmarks += 1;
      if (request.url().includes("/rest/v1/book_notes?")) inserts.book_notes += 1;
    });
    return inserts;
  }

  async function openBook(page: Page) {
    await page.goto(`/books/${seededBookId()}/read`);
    await expect(page.getByTestId("reader-page").first()).toBeVisible();
  }

  /** Visible, a 44 px target, and the thing under its centre is itself. */
  async function expectTappable(control: Locator, name: string) {
    await expect(control, name).toBeInViewport({ ratio: 1 });
    const box = (await control.boundingBox())!;
    expect(Math.round(box.height), `${name} is a 44 px target`).toBeGreaterThanOrEqual(44);
    const onTop = await control.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      return hit !== null && element.contains(hit);
    });
    expect(onTop, `${name} is not covered`).toBe(true);
  }

  test("a note keeps more than one line, through a reload", async ({ page }) => {
    const bookId = seededBookId();
    const userId = await signedInUserId(page);
    const lines = [`بىرىنچى قۇر ${RUN_ID}`, "ئىككىنچى قۇر", "", "تۆتىنچى قۇر"];
    const text = lines.join("\n");
    let id: number | null = null;
    try {
      await openBook(page);
      await page.getByTestId("panel-toggle").click();
      id = await addNoteThroughForm(page, text);

      const panel = page.getByTestId("reader-panel");
      const shown = panel.locator("li").filter({ hasText: lines[0] }).getByTestId("annotation-text");
      await expect(shown).toHaveCount(1);
      expect(await shown.evaluate((element) => (element as HTMLElement).innerText)).toBe(text);

      // Stored as written, line breaks and all.
      const { data } = await adminClient().from("book_notes").select("text").eq("id", id).single();
      expect((data as { text: string }).text).toBe(text);

      await page.reload();
      await page.getByTestId("panel-toggle").click();
      await panel.getByRole("tab", { name: /خاتىرە/ }).click();
      await expect(shown).toHaveCount(1, { timeout: 15_000 });
      expect(await shown.evaluate((element) => (element as HTMLElement).innerText)).toBe(text);
    } finally {
      if (id !== null) {
        await adminClient().from("book_notes").delete().eq("id", id).eq("user_id", userId).eq("book_id", bookId);
      }
    }
  });

  test("Escape and «بىكار قىلىش» save nothing; an empty name is «N-بەت»; an empty note is nothing", async ({
    page,
  }) => {
    const bookId = seededBookId();
    const userId = await signedInUserId(page);
    const inserts = countInserts(page);
    let id: number | null = null;
    try {
      await openBook(page);
      const form = page.getByTestId("annotation-form");
      const input = form.getByTestId("annotation-input");

      // A bookmark is offered the page's own name, selected so typing replaces it.
      await page.getByTestId("add-bookmark").click();
      await expect(input).toBeFocused();
      const suggested = await input.inputValue();
      expect(suggested).toMatch(/^\d+-بەت$/);
      expect(await input.evaluate((field) => (field as HTMLInputElement).selectionEnd)).toBe(suggested.length);

      // Escape: gone, nothing sent, and the focus back on the button.
      await page.keyboard.press("Escape");
      await expect(form).toHaveCount(0);
      await expect(page.getByTestId("add-bookmark")).toBeFocused();

      // «بىكار قىلىش»: the same.
      await page.getByTestId("add-bookmark").click();
      await input.fill("ساقلانمايدۇ");
      await form.getByTestId("annotation-cancel").click();
      await expect(form).toHaveCount(0);

      // A note cancelled from the panel: the panel comes back, unchanged.
      const panel = page.getByTestId("reader-panel");
      await page.getByTestId("panel-toggle").click();
      await panel.getByRole("tab", { name: /خاتىرە/ }).click();
      const notesTab = panel.getByRole("tab", { name: /خاتىرە/ });
      const before = await notesTab.innerText();
      await panel.getByRole("button", { name: /خاتىرە قوشۇش/ }).click();
      await expect(form).toHaveAttribute("data-kind", "note");
      await expect(panel).toBeHidden();
      await input.fill("ساقلانمايدىغان خاتىرە");
      await page.keyboard.press("Escape");
      await expect(form).toHaveCount(0);
      await expect(panel).toBeVisible();
      await expect(notesTab).toHaveText(before);

      // An empty note is nothing, as before: the form closes, nothing is sent.
      await panel.getByRole("button", { name: /خاتىرە قوشۇش/ }).click();
      await input.fill("   ");
      await form.getByTestId("annotation-save").click();
      await expect(form).toHaveCount(0);
      await expect(panel).toBeVisible();
      await expect(notesTab).toHaveText(before);
      expect(inserts, "nothing cancelled or empty was sent").toEqual({ bookmarks: 0, book_notes: 0 });

      // An empty bookmark name is the page's own name, as before.
      await page.getByTestId("panel-close").click();
      await page.getByTestId("add-bookmark").click();
      const page_no = (await input.inputValue()).replace("-بەت", "");
      await input.fill("");
      const saved = page.waitForResponse(isInsert("bookmarks"));
      await form.getByTestId("annotation-save").click();
      const response = await saved;
      expect(response.ok()).toBe(true);
      id = await insertedId(response);
      const { data } = await adminClient().from("bookmarks").select("name, page_no").eq("id", id).single();
      expect(data).toEqual({ name: `${page_no}-بەت`, page_no: Number(page_no) });
      await page.getByTestId("panel-toggle").click();
      await panel.getByRole("tab", { name: /خەتكۈچ/ }).click();
      await expect(panel.locator("li").filter({ hasText: `${page_no}-بەت` })).not.toHaveCount(0);
      expect(inserts).toEqual({ bookmarks: 1, book_notes: 0 });
    } finally {
      if (id !== null) {
        await adminClient().from("bookmarks").delete().eq("id", id).eq("user_id", userId).eq("book_id", bookId);
      }
    }
  });

  test("on a phone: in the toolbar, over nothing, and in reach after scrolling", async ({ page }, testInfo) => {
    const own = testInfo.project.use.viewport!;
    await openBook(page);

    for (const kind of ["bookmark", "note"] as const) {
      if (kind === "bookmark") {
        await page.getByTestId("add-bookmark").click();
      } else {
        await page.getByTestId("panel-toggle").click();
        const panel = page.getByTestId("reader-panel");
        await panel.getByRole("tab", { name: /خاتىرە/ }).click();
        await panel.getByRole("button", { name: /خاتىرە قوشۇش/ }).click();
      }
      const form = page.getByTestId("annotation-form");
      await expect(form).toHaveAttribute("data-kind", kind);

      for (const width of own.width < 640 ? [own.width, 360] : [own.width]) {
        await page.setViewportSize({ width, height: own.height });
        await assertNoHorizontalOverflow(page);

        // Part of the sticky toolbar — never a layer over the text.
        const inToolbar = await form.evaluate(
          (element) => element.closest('[data-testid="reader-toolbar"]') !== null,
        );
        expect(inToolbar, "the form is a row of the toolbar").toBe(true);
        await page.evaluate(() => window.scrollTo(0, 0));
        const toolbar = (await page.getByTestId("reader-toolbar").boundingBox())!;
        const text = (await page.getByTestId("reader-content").boundingBox())!;
        expect(text.y, "the text starts below the form").toBeGreaterThanOrEqual(toolbar.y + toolbar.height - 1);

        // Scrolled down and back up, every control of it is still there.
        await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
        await page.waitForTimeout(300);
        await expectTappable(form.getByTestId("annotation-save"), `«ساقلاش» scrolled down at ${width} px`);
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.waitForTimeout(300);
        for (const [id, name] of [
          ["annotation-input", "the field"],
          ["annotation-save", "«ساقلاش»"],
          ["annotation-cancel", "«بىكار قىلىش»"],
          ["keyboard-toggle", "the Uyghur keyboard"],
        ] as const) {
          await expectTappable(form.getByTestId(id), `${name} at ${width} px (${kind})`);
        }
      }

      await page.setViewportSize({ width: own.width, height: own.height });
      await form.getByTestId("annotation-cancel").click();
      await expect(form).toHaveCount(0);
      if (kind === "note") await page.getByTestId("panel-close").click();
    }
  });
});
