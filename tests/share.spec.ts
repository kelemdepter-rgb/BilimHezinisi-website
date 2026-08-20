import { test, expect, type Page } from "@playwright/test";
import { readMarkdownSeed, readSeed, hasStaffTestEnv, loadEnvLocal } from "./env";

loadEnvLocal();

test.skip(!hasStaffTestEnv(), "Supabase env not configured");

/**
 * Keeping a copy of a book, and passing one on.
 *
 * Anonymous throughout: a reader with no account must be able to download a
 * book, share a page and make a quote card, exactly like everyone else.
 */

function seededBookId(): number {
  const seed = readSeed();
  if (!seed) throw new Error("seed book missing — the setup project must run first");
  return seed.bookId;
}

function markdownBookId(): number {
  const seed = readMarkdownSeed();
  if (!seed) throw new Error("markdown seed book missing — the setup project must run first");
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

async function scrollDownAndBackUp(page: Page) {
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await page.waitForTimeout(300);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(300);
}

/**
 * Wait until the reader's own code is running.
 *
 * The seeded pages are server-rendered, so a page element is visible long
 * before React has hydrated — and a selection made in that window is made
 * before anything is listening for it. The reader writes its offline index on
 * mount, so that entry appearing IS hydration, in the app's own terms.
 */
async function readerReady(page: Page) {
  await expect(page.getByTestId("reader-page").first()).toBeVisible();
  await page.waitForFunction(
    () => window.localStorage.getItem("bh-offline-books") !== null,
    undefined,
    { timeout: 20_000 },
  );
}

/** Wait for scrolling and lazy page loading to stop moving the viewport. */
async function settled(page: Page) {
  await page.waitForFunction(
    () => {
      const w = window as unknown as { __last?: number; __still?: number };
      const y = Math.round(window.scrollY);
      if (w.__last === y) w.__still = (w.__still ?? 0) + 1;
      else {
        w.__last = y;
        w.__still = 0;
      }
      return (w.__still ?? 0) > 6;
    },
    undefined,
    { timeout: 20_000, polling: 100 },
  );
}

/** Which page is under the top of the viewport, the way the reader counts it. */
function pageAtTop(page: Page): Promise<number | null> {
  return page.evaluate(() => {
    for (const node of document.querySelectorAll<HTMLElement>("[data-page-no]")) {
      if (node.getBoundingClientRect().bottom > 120) return Number(node.dataset.pageNo);
    }
    return null;
  });
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

/** Download one format and hand back the bytes. */
async function downloadAs(page: Page, format: "docx" | "text"): Promise<Buffer> {
  await page.getByTestId("download-book").click();
  await expect(page.getByTestId("download-menu")).toBeVisible();
  const started = page.waitForEvent("download", { timeout: 60_000 });
  await page.getByTestId(format === "docx" ? "download-docx" : "download-text").click();
  const download = await started;
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

test.describe("downloading a book", () => {
  test("a plain-text book comes down as Word and as text", async ({ page }) => {
    await page.goto(`/books/${seededBookId()}`);

    const docx = await downloadAs(page, "docx");
    expect(docx.length, "the Word file must not be empty").toBeGreaterThan(1000);
    // "PK" — a .docx is a zip, and a zip that does not start with PK is not one.
    expect(docx.subarray(0, 2).toString("latin1")).toBe("PK");

    await page.reload();
    const text = await downloadAs(page, "text");
    const body = text.toString("utf8");
    expect(body.length).toBeGreaterThan(200);
    expect(body).toContain("__e2e_kitab__");
    // The file has to say where it came from.
    expect(body).toContain("بىلىم خەزىنىسى");
    expect(body).toContain("/books/");
  });

  test("a Markdown book comes down with its formatting", async ({ page }) => {
    await page.goto(`/books/${markdownBookId()}`);

    const docx = await downloadAs(page, "docx");
    expect(docx.length).toBeGreaterThan(1000);
    expect(docx.subarray(0, 2).toString("latin1")).toBe("PK");

    await page.reload();
    const text = await downloadAs(page, "text");
    const body = text.toString("utf8");
    expect(body.length).toBeGreaterThan(100);
    // Markdown is the formatting; it must survive rather than be flattened.
    expect(body).toContain("# ");
  });

  test("is offered in the reader too, and shows progress it can be stopped from", async ({
    page,
  }) => {
    await page.goto(`/books/${seededBookId()}/read`);
    await readerReady(page);

    await scrollDownAndBackUp(page);
    // The bar it lives in is sticky; nothing may end up on top of it.
    expect(await topMostTestIdAt(page, "download-book")).toBe("download-book");

    await page.getByTestId("download-book").click();
    const menu = page.getByTestId("download-menu");
    await expect(menu).toBeVisible();
    // Opening upwards from a bottom bar: the panel must be on screen.
    const box = (await menu.boundingBox())!;
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(page.viewportSize()!.height + 1);
    await assertNoHorizontalOverflow(page);
  });

  test("refuses a book that is not published", async ({ request }) => {
    // The gate is the route, not the button: a draft must not come down even
    // for someone who types the address.
    //
    // From its own address, so the downloads above cannot have spent this
    // caller's allowance and turned a 404 into a 429 — the limiter keys on
    // the forwarded address exactly as it does in production.
    const response = await request.get("/api/books/999999999/download", {
      headers: { "x-forwarded-for": "198.51.100.24" },
    });
    expect(response.status()).toBe(404);
    const body = (await response.json()) as { ok: boolean; message?: string };
    expect(body.ok).toBe(false);
    expect(body.message ?? "").toMatch(/[؀-ۿ]/);
  });
});

test.describe("sharing", () => {
  test("the book page offers a share control that copies the link", async ({
    page,
    context,
  }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    // No share sheet in this browser, so the control must fall back rather
    // than doing nothing at all.
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "share", { value: undefined, configurable: true });
    });

    const bookId = seededBookId();
    await page.goto(`/books/${bookId}`);
    await page.getByTestId("share-button").click();

    await expect(page.getByTestId("share-notice")).toContainText("كۆچۈرۈلدى");
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied).toContain(`/books/${bookId}`);
    await assertNoHorizontalOverflow(page);
  });

  test("the reader shares the page it is on, and that link lands there", async ({
    page,
    context,
  }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "share", { value: undefined, configurable: true });
    });

    const bookId = seededBookId();
    await page.goto(`/books/${bookId}/read`);
    await readerReady(page);

    // Reachable by tap, and never underneath the sticky bars — checked after
    // the scrolling that used to swallow controls in earlier phases.
    await scrollDownAndBackUp(page);
    expect(await topMostTestIdAt(page, "share-button")).toBe("share-button");

    await page.getByTestId("page-jump").fill("11");
    await page.getByTestId("page-jump-go").click();
    await expect(page.locator('[data-page-no="11"]')).toBeVisible();
    await settled(page);
    const sharingFrom = await pageAtTop(page);

    await page.getByTestId("share-button").tap({ timeout: 5000 }).catch(async () => {
      // Desktop projects have no touch; the same control, the same handler.
      await page.getByTestId("share-button").click();
    });
    await expect(page.getByTestId("share-notice")).toBeVisible();

    const shared = await page.evaluate(() => navigator.clipboard.readText());
    expect(shared).toMatch(new RegExp(`/books/${bookId}/read\\?page=\\d+`));

    const pageNo = Number(new URL(shared).searchParams.get("page"));
    // The link must name the page the reader is actually looking at.
    expect(pageNo).toBe(sharingFrom);
    expect(pageNo).toBeGreaterThan(1);

    // Cold load of exactly that link, signed out.
    const fresh = await context.newPage();
    await fresh.goto(shared);
    await readerReady(fresh);
    await settled(fresh);
    expect(await pageAtTop(fresh), "a shared link must open on the page it names").toBe(pageNo);
    await fresh.close();
  });

  test("a ?page= link still describes the book to whoever it is sent to", async ({
    page,
  }) => {
    const bookId = seededBookId();
    await page.goto(`/books/${bookId}/read?page=5`);

    // Open Graph, for the preview card in a messaging app.
    await expect(page.locator('meta[property="og:title"]')).toHaveCount(1);
    await expect(page.locator('meta[property="og:description"]')).toHaveCount(1);
    // The canonical drops ?page=: it addresses a position, not another work.
    const canonical = await page.locator('link[rel="canonical"]').getAttribute("href");
    expect(canonical).toContain(`/books/${bookId}/read`);
    expect(canonical).not.toContain("page=");

    // And structured data, so it is understood as this book.
    const jsonLd = await page.locator('script[type="application/ld+json"]').first().textContent();
    const data = JSON.parse(jsonLd ?? "{}") as { "@type": string; name: string; url: string };
    expect(data["@type"]).toBe("Book");
    expect(data.name).toContain("سىناق كىتابى");
    expect(data.url).toContain(`/books/${bookId}/read`);
  });
});

test.describe("the quote card", () => {
  test("is produced from a selection, by tapping", async ({ page }) => {
    await page.goto(`/books/${seededBookId()}/read`);
    await readerReady(page);

    /**
     * A long press is what makes a selection on a phone, and Playwright has
     * no gesture for it — so the selection is made through the same Selection
     * API the browser itself drives, and everything after it (the button
     * appearing, and being TAPPED rather than hovered) is the real path.
     */
    await page.evaluate(() => {
      const container = document.querySelector('[data-testid="reader-content"]')!;
      const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
      let node: Node | null = null;
      while ((node = walker.nextNode())) {
        if ((node.textContent ?? "").trim().length > 80) break;
      }
      if (!node) throw new Error("no text to select");
      const range = document.createRange();
      range.setStart(node, 0);
      range.setEnd(node, Math.min(120, node.textContent!.length));
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
      document.dispatchEvent(new Event("selectionchange"));
    });

    const open = page.getByTestId("quote-card-open");
    await expect(open).toBeVisible();
    // On screen and reachable — a control off the viewport is not a control.
    const box = (await open.boundingBox())!;
    const viewport = page.viewportSize()!;
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
    expect(box.height, "touch targets are at least 44 px").toBeGreaterThanOrEqual(44);

    await open.tap({ timeout: 5000 }).catch(() => open.click());

    const image = page.getByTestId("quote-card-image");
    await expect(image).toBeVisible({ timeout: 30_000 });

    // A real picture, at the size a messaging app expects.
    const size = await image.evaluate((element) => ({
      width: (element as HTMLImageElement).naturalWidth,
      height: (element as HTMLImageElement).naturalHeight,
    }));
    expect(size.width).toBeGreaterThanOrEqual(1080);
    expect(size.height).toBeGreaterThanOrEqual(1080);

    // And not a blank one: the paper is not the only thing on it.
    const inked = await image.evaluate((element) => {
      const img = element as HTMLImageElement;
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      canvas.getContext("2d")!.drawImage(img, 0, 0);
      const { data } = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height);
      let dark = 0;
      for (let index = 0; index < data.length; index += 4) {
        if (data[index] < 120 && data[index + 1] < 120) dark += 1;
      }
      return dark;
    });
    expect(inked, "the card must have text drawn on it").toBeGreaterThan(2000);

    await expect(page.getByTestId("quote-card-save")).toBeVisible();
    await assertNoHorizontalOverflow(page);

    await page.getByTestId("quote-card-close").click();
    await expect(page.getByTestId("quote-card-dialog")).toHaveCount(0);
  });

  test("says so, kindly, when the passage is too long", async ({ page }) => {
    await page.goto(`/books/${seededBookId()}/read`);
    await readerReady(page);

    await page.evaluate(() => {
      const container = document.querySelector('[data-testid="reader-content"]')!;
      const range = document.createRange();
      // The whole loaded window — thousands of characters.
      range.selectNodeContents(container);
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
      document.dispatchEvent(new Event("selectionchange"));
    });

    await page.getByTestId("quote-card-open").click();
    const error = page.getByTestId("quote-card-error");
    await expect(error).toBeVisible();
    await expect(error).toContainText("400");
    await assertNoHorizontalOverflow(page);
  });
});
