import { expect, test, type Page, type Request } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { BATCH_PREFIX, hasStaffTestEnv, loadEnvLocal } from "./env";
import { removePrefixedBooks } from "./fixtures/books";

loadEnvLocal();

test.skip(!hasStaffTestEnv(), "Supabase env not configured");

/**
 * The single-book upload wizard when the connection drops partway (PROMPT-35).
 *
 * The wizard writes straight from the browser to the database, and a book of
 * more than one page batch used to be created PUBLISHED before a single page
 * existed. This spec cuts the connection at the worst moments and reads back
 * what the database holds afterwards. It writes real books, every one titled
 * with BATCH_PREFIX so that the teardown sweeps whatever a broken run leaves.
 */

/**
 * No service worker here. The site's sw.js sees every fetch a page it controls
 * makes, and a request that has passed through a worker's fetch event is not
 * routed by page.route — so once the worker had claimed the page, the faults
 * below stopped firing and every save quietly succeeded. The wizard's writes
 * never touch the worker (it ignores anything but GET), so nothing is lost.
 */
test.use({ serviceWorkers: "block" });

/**
 * Kept in step with PAGE_BATCH_SIZE in lib/books/save.ts. The fixture is a
 * few pages longer than one batch, so there is a second batch to drop.
 */
const PAGE_BATCH_SIZE = 200;
const FIXTURE_PAGES = PAGE_BATCH_SIZE + 5;

const SENTENCE =
  "بۇ كىتاب ئۇيغۇر تىلىنىڭ تارىخى، ئىملاسى ۋە ئەدەبىياتى ھەققىدە يېزىلغان بولۇپ، " +
  "ئوقۇرمەنلەرگە تىل بىلىمى بويىچە كەڭ چۈشەنچە بېرىدۇ. ";

/** A word no real book carries, so a search for it is about this book alone. */
const NEEDLE = "مەرمەركۆۋرۈك";

/** A 1×1 PNG — enough for the cover step to compress and upload. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

/**
 * One paragraph per page: each is longer than the chunker's minimum and
 * shorter than its maximum, so it becomes exactly one page. The tag goes into
 * the text so every scenario, at every viewport, has its own content hash —
 * the duplicate check at extraction must never fire on a sibling's book.
 */
function longBook(tag: string): string {
  const paragraph = `${NEEDLE} ${SENTENCE.repeat(19)}`.trim();
  return [`${BATCH_PREFIX} ${tag}`, ...Array.from({ length: FIXTURE_PAGES }, () => paragraph)].join(
    "\n\n",
  );
}

function serviceClient(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}

/** What a visitor with no account is allowed to see. */
function anonClient(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}

type BookRow = {
  id: number;
  status: string;
  page_count: number;
  file_hash: string;
  cover_path: string | null;
};

async function bookTitled(admin: SupabaseClient, title: string): Promise<BookRow | null> {
  const { data } = await admin
    .from("books")
    .select("id, status, page_count, file_hash, cover_path")
    .eq("title", title)
    .maybeSingle();
  return (data as BookRow | null) ?? null;
}

async function storedPages(admin: SupabaseClient, bookId: number): Promise<number> {
  const { count } = await admin
    .from("book_pages")
    .select("book_id", { count: "exact", head: true })
    .eq("book_id", bookId);
  return count ?? 0;
}

async function coverObjects(admin: SupabaseClient, bookId: number): Promise<number> {
  const { data } = await admin.storage.from("covers").list(String(bookId));
  return data?.length ?? 0;
}

/**
 * The faults this spec injects. Everything the wizard writes about pages goes
 * to one REST path, so one handler sees the page batches (POST upserts) and
 * the page count (a HEAD).
 *
 * A page batch is dropped once: postgrest-js never retries a POST, so one cut
 * is one failed save. The count is different — postgrest-js retries an
 * idempotent request on a fetch error by itself, three times with 1 s, 2 s
 * and 4 s of backoff — so "drop the count" has to swallow all four attempts,
 * or the library heals the fault and the save quietly completes.
 */
type Fault = "next-batch" | "second-batch" | "count";
type Faults = { drop: (fault: Fault) => void };

/** One initial request plus the three retries postgrest-js makes. */
const COUNT_ATTEMPTS = 4;

async function installFaults(page: Page): Promise<Faults> {
  const remaining = new Map<Fault, number>();
  let batches = 0;
  const spend = (fault: Fault) => {
    const left = remaining.get(fault) ?? 0;
    if (left <= 0) return false;
    remaining.set(fault, left - 1);
    return true;
  };
  const isPageCount = (request: Request) =>
    request.method() !== "POST" && request.url().includes("book_id=eq.");

  await page.route(
    (url) => url.pathname.endsWith("/rest/v1/book_pages"),
    async (route) => {
      const request = route.request();
      let cut = false;
      if (request.method() === "POST") {
        batches += 1;
        cut = spend("next-batch") || (batches === 2 && spend("second-batch"));
      } else if (isPageCount(request)) {
        cut = spend("count");
      }
      // ERR_FAILED rather than a connection reset, which Chromium itself
      // retries for an idempotent request.
      if (cut) await route.abort("failed");
      else await route.continue();
    },
  );
  return {
    drop: (fault) => remaining.set(fault, fault === "count" ? COUNT_ATTEMPTS : 1),
  };
}

/** Pick the file, read it, name it, choose the status, and reach the save step. */
async function reachSaveStep(
  page: Page,
  options: { text: string; title: string; status: "draft" | "published"; cover: boolean },
) {
  await page.goto("/admin/books/new");
  await page.getByTestId("wizard-file-input").setInputFiles({
    name: `${BATCH_PREFIX}-uzun.txt`,
    mimeType: "text/plain",
    buffer: Buffer.from(options.text, "utf8"),
  });
  await page.getByTestId("wizard-next").click();
  await expect(page.getByText("ئوقۇش تامام ✓")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("wizard-duplicate")).toHaveCount(0);

  await page.getByTestId("wizard-next").click();
  await expect(page.getByRole("heading", { name: "بەتلەرگە بۆلۈندى" })).toBeVisible();

  await page.getByTestId("wizard-next").click();
  await page.getByTestId("meta-title").fill(options.title);
  await page.getByTestId("meta-status").selectOption(options.status);

  await page.getByTestId("wizard-next").click();
  if (options.cover) {
    await page.getByTestId("cover-input").setInputFiles({
      name: "muqawa.png",
      mimeType: "image/png",
      buffer: PNG,
    });
    await expect(page.getByAltText("مۇقاۋا كۆرۈنۈشى")).toBeVisible();
  }

  await page.getByTestId("wizard-next").click();
  await expect(page.getByTestId("wizard-step-5")).toHaveAttribute("aria-current", "step");
}

/** The error is there, and it is written for the admin — not by Postgres. */
async function expectUyghurError(page: Page) {
  const error = page.getByTestId("wizard-error");
  await expect(error).toBeVisible({ timeout: 60_000 });
  expect(await error.textContent()).not.toMatch(/[A-Za-z]/);
}

// Clean before as well as after: a leftover from an interrupted run would
// trip the duplicate check at extraction, or be mistaken for this run's book.
test.beforeEach(async () => {
  await removePrefixedBooks(serviceClient());
});

test.afterEach(async () => {
  await removePrefixedBooks(serviceClient());
});

test.describe("a save that is cut off", () => {
  test("never publishes half a book, and «قايتا سىناش» finishes the same one", async ({
    page,
    playwright,
  }, testInfo) => {
    // Two page batches of real Uyghur text, written, dropped and written again.
    test.slow();
    const admin = serviceClient();
    const tag = `${testInfo.project.name} retry`;
    const title = `${BATCH_PREFIX} ئۈزۈلگەن ${tag}`;
    const faults = await installFaults(page);

    await reachSaveStep(page, { text: longBook(tag), title, status: "published", cover: false });

    // ── The second page batch never arrives ──────────────────────────────
    faults.drop("second-batch");
    await page.getByTestId("save-now").click();
    await expectUyghurError(page);

    // The row exists, as a DRAFT, with the first batch behind it and the rest
    // missing — exactly the state that used to be published.
    const partial = await bookTitled(admin, title);
    expect(partial, "the book row must exist").not.toBeNull();
    expect(partial!.status).toBe("draft");
    expect(partial!.page_count).toBe(FIXTURE_PAGES);
    expect(await storedPages(admin, partial!.id)).toBe(PAGE_BATCH_SIZE);

    // Nobody without an account can see it: not the row, not its page, not a
    // search for a word only it carries.
    const anon = anonClient();
    const { data: seen } = await anon.from("books").select("id").eq("id", partial!.id).maybeSingle();
    expect(seen).toBeNull();
    // Inside a test, playwright.request.newContext() inherits the project's
    // options — this project's storageState included, which would make the
    // "visitor" a signed-in editor. An empty state is what a stranger has.
    const visitor = await playwright.request.newContext({
      baseURL: testInfo.project.use.baseURL,
      storageState: { cookies: [], origins: [] },
    });
    expect((await visitor.get(`/books/${partial!.id}`)).status()).toBe(404);
    await visitor.dispose();
    const { data: hitsBefore } = await anon.rpc("search_books", {
      q: NEEDLE,
      category_id: null,
      lim: 5,
      off: 0,
    });
    expect((hitsBefore as { book_id: number }[] | null) ?? []).toHaveLength(0);

    // The row is written; the earlier steps no longer apply to it.
    await expect(page.getByTestId("wizard-back")).toBeDisabled();
    await expect(page.getByTestId("wizard-cancel")).toBeEnabled();

    // ── Retry: the same book, finished ──────────────────────────────────
    await page.getByTestId("save-retry").click();
    await expect(page.getByTestId("wizard-saved")).toBeVisible({ timeout: 90_000 });

    const finished = await bookTitled(admin, title);
    expect(finished!.id).toBe(partial!.id);
    expect(finished!.status).toBe("published");
    expect(await storedPages(admin, finished!.id)).toBe(finished!.page_count);
    expect(finished!.page_count).toBeGreaterThan(PAGE_BATCH_SIZE);

    // One row for this content — the retry did not try to create a second.
    const { count: sameHash } = await admin
      .from("books")
      .select("id", { count: "exact", head: true })
      .eq("file_hash", finished!.file_hash);
    expect(sameHash).toBe(1);

    // And now a visitor finds it.
    const { data: hitsAfter } = await anon.rpc("search_books", {
      q: NEEDLE,
      category_id: null,
      lim: 5,
      off: 0,
    });
    expect(((hitsAfter as { book_id: number }[] | null) ?? []).map((hit) => hit.book_id)).toContain(
      finished!.id,
    );

    // ── After success nothing destructive is offered ────────────────────
    await expect(page.getByTestId("wizard-cancel")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "بىكار قىلىش" })).toHaveCount(0);
    await page.getByTestId("wizard-finish").click();
    await expect(page).toHaveURL(/\/admin\/books$/);
    expect(await bookTitled(admin, title)).not.toBeNull();
  });

  test("«بىكار قىلىش» removes the half-written book and its cover", async ({ page }, testInfo) => {
    test.slow();
    const admin = serviceClient();
    const tag = `${testInfo.project.name} cancel`;
    const title = `${BATCH_PREFIX} بىكار ${tag}`;
    const faults = await installFaults(page);

    await reachSaveStep(page, { text: longBook(tag), title, status: "published", cover: true });

    // First the pages stop halfway…
    faults.drop("second-batch");
    await page.getByTestId("save-now").click();
    await expectUyghurError(page);
    const partial = await bookTitled(admin, title);
    expect(partial).not.toBeNull();
    expect(partial!.status).toBe("draft");

    // …then the retry gets the pages and the cover in, and loses the
    // connection on the page count — so there is a cover to clean up.
    faults.drop("count");
    await page.getByTestId("save-retry").click();
    await expectUyghurError(page);
    await expect(page.getByTestId("wizard-saved")).toHaveCount(0);

    const stillDraft = await bookTitled(admin, title);
    expect(stillDraft!.id).toBe(partial!.id);
    expect(stillDraft!.status).toBe("draft");
    expect(stillDraft!.cover_path).not.toBeNull();
    expect(await coverObjects(admin, partial!.id)).toBeGreaterThan(0);

    await page.getByTestId("wizard-cancel").click();
    await expect(page).toHaveURL(/\/admin\/books$/);

    expect(await bookTitled(admin, title)).toBeNull();
    expect(await storedPages(admin, partial!.id)).toBe(0);
    expect(await coverObjects(admin, partial!.id)).toBe(0);
  });
});

test.describe("on every screen", () => {
  test("the save step's buttons stay clear of the action bar", async ({ page }, testInfo) => {
    const tag = `${testInfo.project.name} layout`;
    const title = `${BATCH_PREFIX} كۆرۈنۈش ${tag}`;
    // A one-batch book whose only batch fails, so the retry button is on the
    // screen along with everything else the step can show.
    const faults = await installFaults(page);
    faults.drop("next-batch");

    await reachSaveStep(page, {
      text: `${BATCH_PREFIX} ${tag}\n\n${SENTENCE.repeat(20)}`,
      title,
      status: "draft",
      cover: false,
    });
    await page.getByTestId("save-now").click();
    await expectUyghurError(page);

    const noOverflow = async (label: string) => {
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, `no horizontal scroll ${label}`).toBeLessThanOrEqual(1);
    };
    await noOverflow(`at ${testInfo.project.use.viewport!.width}px`);

    await page.setViewportSize({ width: 360, height: 640 });
    await noOverflow("at 360px");

    /** Visible, at least 44 px, and the thing under the finger is itself. */
    const tappable = async (id: string, where: string) => {
      const control = page.getByTestId(id);
      await expect(control, `${id} ${where}`).toBeVisible();
      const box = await control.boundingBox();
      expect(box, `${id} has a box ${where}`).not.toBeNull();
      expect(Math.min(box!.width, box!.height), `${id} is a 44px target`).toBeGreaterThanOrEqual(
        44,
      );
      const topMost = await page.evaluate(
        ([x, y]) => {
          const element = document.elementFromPoint(x, y);
          return element?.closest("[data-testid]")?.getAttribute("data-testid") ?? null;
        },
        [box!.x + box!.width / 2, box!.y + box!.height / 2] as const,
      );
      expect(topMost, `${id} is not covered ${where}`).toBe(id);
    };
    const scrollTo = async (y: "top" | "bottom") => {
      await page.evaluate(
        (edge) => window.scrollTo(0, edge === "top" ? 0 : document.documentElement.scrollHeight),
        y,
      );
      await page.waitForTimeout(250);
    };

    // At the foot of the page the step's own buttons sit above the bar — the
    // room the wizard reserves under its content is for exactly this. Down,
    // back up, and down again: the bar's buttons must be there throughout,
    // and nothing may have hidden or shifted the step's buttons under it.
    await scrollTo("bottom");
    for (const id of ["save-now", "save-retry", "wizard-cancel", "wizard-save"]) {
      await tappable(id, "at the bottom");
    }
    await scrollTo("top");
    for (const id of ["wizard-cancel", "wizard-save"]) await tappable(id, "back at the top");
    await scrollTo("bottom");
    for (const id of ["save-now", "save-retry", "wizard-cancel", "wizard-save"]) {
      await tappable(id, "at the bottom again");
    }
  });
});
