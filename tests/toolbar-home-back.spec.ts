import { expect, test, type Page } from "@playwright/test";
import { SEED_NEEDLE, hasStaffTestEnv, loadEnvLocal, readSeed } from "./env";
import { adminClient, dropNote, newNote, signedInUserId } from "./fixtures/notes";
// The real obfuscation, so the stored key has exactly the shape the app reads.
import { obfuscateKey } from "../lib/ai/storage";

loadEnvLocal();

test.skip(!hasStaffTestEnv(), "Supabase env not configured");

/**
 * Home and «قايتىش» on the four surfaces that render without the site
 * header (PROMPT-54): the book reader, a sura, a note and a trashed note.
 *
 * Home is the first control at the right edge — the brand mark below
 * 640 px, «باش بەت» from 640 px up — and the way back is the word
 * «قايتىش» in a box, never an icon, going exactly where it went before.
 * On a phone the reader's and the sura's toolbars are two rows of at most
 * 112 px; from 640 px up they are one row.
 */

const ANONYMOUS = { cookies: [], origins: [] };
const HOME = "باش بەت";
const BACK = "قايتىش";
/** The phone toolbar's cap, the same as the notebook's (CLAUDE.md). */
const PHONE_CAP = 112;
/** The reader's tools, in their phone row. */
const READER_TOOLS = [
  "font-decrease",
  "font-increase",
  "theme-toggle",
  "find-toggle",
  "add-bookmark",
  "ai-toggle",
  "panel-toggle",
];
const QURAN_TOOLS = ["quran-font-decrease", "quran-font-increase", "theme-toggle", "translation-toggle"];

function seededBookId(): number {
  const seed = readSeed();
  if (!seed) throw new Error("seed book missing — the setup project must run first");
  return seed.bookId;
}

/** Lines of invented text, so the page scrolls at every viewport. */
function longNote(lines: number): string {
  const filler = "بۇ بىر سىناق قۇرى، ئۇنىڭدا مۇھىم نەرسە يوق.";
  return Array.from({ length: lines }, () => `<div>${filler}</div>`).join("");
}

async function scrollDownAndBackUp(page: Page) {
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await page.waitForTimeout(250);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(250);
}

async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
}

/** The element actually on top at a control's centre — catches covered buttons. */
async function topMostTestIdAt(page: Page, testId: string): Promise<string | null> {
  const box = await page.getByTestId(testId).boundingBox();
  expect(box, `${testId} must have a box`).not.toBeNull();
  return page.evaluate(
    ([x, y]) => document.elementFromPoint(x, y)?.closest("[data-testid]")?.getAttribute("data-testid") ?? null,
    [box!.x + box!.width / 2, box!.y + box!.height / 2] as const,
  );
}

/**
 * AI switched on in this browser with a key nobody can use, so the AI button
 * takes its place in the toolbar. Nothing here ever asks Google anything —
 * and any request that tried would be refused before it left.
 */
async function enableAi(page: Page) {
  await page.route("https://generativelanguage.googleapis.com/**", (route) => route.abort());
  const slots = JSON.stringify([obfuscateKey("AIzaToolbarHomeBack0000000000000001"), "", "", ""]);
  await page.addInitScript((stored: string) => {
    try {
      localStorage.setItem("bh-ai-enabled", "1");
      localStorage.setItem("bh-ai-keys", stored);
    } catch {
      // A browser blocking storage has nothing to set up.
    }
  }, slots);
}

type Control = { id: string; top: number; bottom: number; left: number; right: number; height: number; width: number };

/** Every control in a toolbar's first row container, as laid out now. */
async function controlsOf(page: Page, toolbar: string): Promise<Control[]> {
  return page.getByTestId(toolbar).evaluate((header) => {
    const row = header.firstElementChild as HTMLElement;
    return [...row.querySelectorAll<HTMLElement>("a, button, input")]
      .map((element) => ({ element, box: element.getBoundingClientRect() }))
      .filter(({ box }) => box.width > 0 && box.height > 0)
      .map(({ element, box }) => ({
        id: element.dataset.testid ?? element.getAttribute("aria-label") ?? element.tagName,
        top: box.top,
        bottom: box.bottom,
        left: box.left,
        right: box.right,
        height: box.height,
        width: box.width,
      }));
  });
}

/** How many lines the controls stand on (centres more than 6 px apart). */
function rowsOf(controls: Control[]): number {
  const centres = controls.map((control) => (control.top + control.bottom) / 2).sort((a, b) => a - b);
  let rows = 0;
  let last = -Infinity;
  for (const centre of centres) {
    if (centre - last > 6) rows += 1;
    last = centre;
  }
  return rows;
}

async function toolbarHeight(page: Page, toolbar: string): Promise<number> {
  await page.evaluate(() => window.scrollTo(0, 0));
  return page.getByTestId(toolbar).evaluate((header) => header.getBoundingClientRect().height);
}

/**
 * The checks every surface shares: home first at the right edge, the right
 * size, uncovered after scrolling, showing the mark or the words; and the
 * back control a boxed word with no icon.
 */
async function expectHomeAndBack(page: Page, toolbar: string, backId: string) {
  await scrollDownAndBackUp(page);
  const wide = page.viewportSize()!.width >= 640;

  const home = page.getByTestId("home-link");
  await expect(home).toHaveCount(1);
  await expect(home).toBeVisible();
  await expect(home).toHaveAttribute("href", "/");
  await expect(home).toHaveAccessibleName(HOME);
  await expect(home).toHaveAttribute("title", HOME);
  const homeBox = (await home.boundingBox())!;
  expect(homeBox.width, "home is at least 44 px wide").toBeGreaterThanOrEqual(44);
  expect(homeBox.height, "home is at least 44 px high").toBeGreaterThanOrEqual(44);
  expect(await topMostTestIdAt(page, "home-link"), "home must not be covered").toBe("home-link");

  const mark = home.locator("img");
  await expect(mark).toBeVisible();
  await expect(home).toHaveText(wide ? HOME : "", { useInnerText: true });
  if (!wide) {
    const markBox = (await mark.boundingBox())!;
    expect(markBox.width, "the mark alone, 28–30 px").toBeGreaterThanOrEqual(28);
    expect(markBox.width).toBeLessThanOrEqual(30.5);
  }

  // The rightmost control of its row: first, in RTL.
  const controls = await controlsOf(page, toolbar);
  const centre = homeBox.y + homeBox.height / 2;
  const row = controls.filter((control) => Math.abs((control.top + control.bottom) / 2 - centre) <= 6);
  const rightmost = row.reduce((best, control) => (control.right > best.right ? control : best));
  expect(rightmost.id, "home is the first control at the right edge").toBe("home-link");

  const back = page.getByTestId(backId);
  await expect(back).toHaveCount(1);
  await expect(back).toHaveText(BACK, { useInnerText: true });
  await expect(back.locator("svg")).toHaveCount(0);
  // The visible word is part of what a screen reader announces (WCAG 2.5.3).
  await expect(back).toHaveAccessibleName(new RegExp(BACK));
  expect((await back.boundingBox())!.height, "back is at least 44 px high").toBeGreaterThanOrEqual(44);
  expect(await topMostTestIdAt(page, backId), "back must not be covered").toBe(backId);
  // Home, then back, from the right.
  expect((await back.boundingBox())!.x).toBeLessThan(homeBox.x);

  expect(await horizontalOverflow(page), "no sideways scroll").toBeLessThanOrEqual(1);
}

async function tapHome(page: Page) {
  await page.getByTestId("home-link").click();
  await page.waitForURL((url) => url.pathname === "/");
}

test.describe("the book reader, signed out", () => {
  test.use({ storageState: ANONYMOUS });

  test("home comes first and goes home; «قايتىش» goes to the book page", async ({ page }) => {
    const bookId = seededBookId();
    await page.goto(`/books/${bookId}/read`);
    await expect(page.getByTestId("reader-page").first()).toBeVisible();
    await expectHomeAndBack(page, "reader-toolbar", "reader-back");

    await page.getByTestId("reader-back").click();
    await page.waitForURL((url) => url.pathname === `/books/${bookId}`);

    await page.goto(`/books/${bookId}/read`);
    await tapHome(page);
  });

  test("the reading position survives leaving through home, as through «قايتىش»", async ({ page }) => {
    const bookId = seededBookId();
    const stored = () =>
      page.evaluate((id) => {
        const raw = window.localStorage.getItem(`bh-reading-position:${id}`);
        return raw ? (JSON.parse(raw) as { pageNo: number }).pageNo : null;
      }, bookId);

    await page.goto(`/books/${bookId}/read`);
    await page.getByTestId("page-jump").fill("9");
    await page.getByTestId("page-jump-go").click();
    await expect(page.locator('[data-page-no="9"]')).toBeVisible();
    // The position is written on an 800 ms debounce.
    await page.waitForTimeout(1500);
    const left = await stored();
    expect(left, "the reader wrote down where it was").toBeGreaterThan(1);

    await tapHome(page);
    await page.goto(`/books/${bookId}/read`);
    await expect(page.getByTestId("restored-note")).toContainText(`${left}-بەت`, { timeout: 15_000 });

    // The same through «قايتىش».
    await page.waitForTimeout(1500);
    const again = await stored();
    await page.getByTestId("reader-back").click();
    await page.waitForURL((url) => url.pathname === `/books/${bookId}`);
    await page.goto(`/books/${bookId}/read`);
    await expect(page.getByTestId("restored-note")).toContainText(`${again}-بەت`, { timeout: 15_000 });
  });
});

test.describe("the book reader, signed in", () => {
  test("home and «قايتىش» with every tool in the bar", async ({ page }) => {
    await enableAi(page);
    await page.goto(`/books/${seededBookId()}/read?q=${encodeURIComponent(SEED_NEEDLE)}`);
    await expect(page.getByTestId("match-count")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("add-bookmark")).toBeVisible();
    await expect(page.getByTestId("ai-toggle")).toBeVisible();
    await expectHomeAndBack(page, "reader-toolbar", "reader-back");
    await tapHome(page);
  });

  test("«قايتىش» from a search returns to the same results", async ({ page }) => {
    const search = `/search?q=${encodeURIComponent(SEED_NEEDLE)}`;
    await page.goto(search);
    await expect(page.getByTestId("search-result").first()).toBeVisible({ timeout: 20_000 });
    const results = page.url();

    await page.getByTestId("search-result").first().click();
    await expect(page).toHaveURL(/\/books\/\d+\/read\?.*from=search/);
    await expect(page.getByTestId("reader-back")).toHaveText(BACK, { useInnerText: true });

    await page.getByTestId("reader-back").click();
    await expect(page).toHaveURL(results);
    await expect(page.getByTestId("search-result").first()).toBeVisible();
  });
});

test.describe("a sura", () => {
  test.use({ storageState: ANONYMOUS });

  test("home comes first and goes home; «قايتىش» goes to the sura list", async ({ page }) => {
    await page.goto("/quran/5");
    await expect(page.getByTestId("quran-toolbar")).toBeVisible();
    await expectHomeAndBack(page, "quran-toolbar", "quran-back");

    await page.getByTestId("quran-back").click();
    await page.waitForURL((url) => url.pathname === "/quran");

    await page.goto("/quran/5");
    await tapHome(page);
  });
});

test.describe("a note", () => {
  test("home comes first and goes home; «قايتىش» goes to the notes", async ({ page }) => {
    const path = await newNote(page, { html: longNote(60) });
    try {
      await expect(page.getByTestId("notes-back")).toHaveAccessibleName("خاتىرىلەر تىزىملىكىگە قايتىش");
      await expect(page.getByTestId("notes-back")).toHaveAttribute("title", "خاتىرىلەر تىزىملىكىگە قايتىش");
      await expectHomeAndBack(page, "note-toolbar", "notes-back");

      await page.getByTestId("notes-back").click();
      await page.waitForURL((url) => url.pathname === "/notes");

      await page.goto(path);
      await expect(page.getByTestId("note-body")).toHaveAttribute("contenteditable", "true");
      await tapHome(page);
    } finally {
      await dropNote(path);
    }
  });

  test("a word typed a moment before tapping home is kept", async ({ page }) => {
    const word = `خاتىرە${Date.now().toString().slice(-6)}`;
    const path = await newNote(page);
    const id = Number(path.split("/").pop());
    try {
      await page.getByTestId("note-body").click();
      await page.keyboard.type(word);
      await expect(page.getByTestId("note-body")).toContainText(word);
      // Well inside the editor's 1.2 s save delay.
      await tapHome(page);

      // On the server, not only in this browser's copy.
      await expect
        .poll(
          async () => {
            const { data } = await adminClient().from("note_documents").select("content_html").eq("id", id).maybeSingle();
            return (data as { content_html: string } | null)?.content_html ?? "";
          },
          { timeout: 20_000 },
        )
        .toContain(word);

      await page.goto(path);
      await expect(page.getByTestId("note-body")).toContainText(word);
    } finally {
      await dropNote(path);
    }
  });

  test("an untouched new note left through home is not kept", async ({ page }) => {
    const path = await newNote(page);
    const id = Number(path.split("/").pop());
    try {
      await tapHome(page);
      await expect
        .poll(
          async () => {
            const { data } = await adminClient().from("note_documents").select("id").eq("id", id).maybeSingle();
            return data === null;
          },
          { timeout: 20_000 },
        )
        .toBe(true);

      await page.goto("/notes");
      await expect(page.locator('[data-testid="notes-controls"][data-ready="true"]')).toBeVisible();
      await expect(page.locator(`a[href="/notes/${id}"]`)).toHaveCount(0);
    } finally {
      await dropNote(path);
    }
  });
});

test.describe("a note in the trash", () => {
  test("home comes first and goes home; «قايتىش» goes to the trash", async ({ page }) => {
    const userId = await signedInUserId(page);
    const { data, error } = await adminClient()
      .from("note_documents")
      .insert({
        user_id: userId,
        title: "ئەخلەتتىكى سىناق",
        content_html: longNote(60),
        content_text: "ئەخلەتتىكى سىناق",
        deleted_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    if (error || !data) throw new Error(`could not make a trashed note: ${error?.message}`);
    const path = `/notes/${(data as { id: number }).id}`;
    try {
      await page.goto(path);
      await expect(page.getByTestId("note-in-trash")).toBeVisible();
      await expect(page.getByTestId("notes-back")).toHaveAccessibleName("ئەخلەت ساندۇقىغا قايتىش");
      await expect(page.getByTestId("notes-back")).toHaveAttribute("title", "ئەخلەت ساندۇقىغا قايتىش");
      await expectHomeAndBack(page, "note-toolbar", "notes-back");
      // One row: home, «قايتىش», the title.
      expect(rowsOf(await controlsOf(page, "note-toolbar"))).toBe(1);

      await page.getByTestId("notes-back").click();
      await page.waitForURL((url) => url.pathname === "/notes/trash");

      await page.goto(path);
      await expect(page.getByTestId("note-in-trash")).toBeVisible();
      await tapHome(page);
    } finally {
      await dropNote(path);
    }
  });
});

test.describe("on a phone", () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) >= 640, "phone rows only");

  test("the reader and the sura: two rows, ≤ 112 px, tools on one line", async ({ page }) => {
    await enableAi(page);
    for (const [path, toolbar, tools] of [
      [`/books/${seededBookId()}/read`, "reader-toolbar", READER_TOOLS],
      ["/quran/5", "quran-toolbar", QURAN_TOOLS],
    ] as const) {
      await page.goto(path);
      await expect(page.getByTestId(toolbar)).toBeVisible();
      if (toolbar === "reader-toolbar") await expect(page.getByTestId("ai-toggle")).toBeVisible();
      await scrollDownAndBackUp(page);

      const height = await toolbarHeight(page, toolbar);
      expect(height, `${toolbar} height`).toBeLessThanOrEqual(PHONE_CAP);
      const controls = await controlsOf(page, toolbar);
      expect(rowsOf(controls), `${toolbar} rows`).toBe(2);
      for (const control of controls) {
        expect(control.height, `${control.id} height`).toBeGreaterThanOrEqual(44);
        expect(control.width, `${control.id} width`).toBeGreaterThanOrEqual(44);
      }
      const row2 = controls.filter((control) => (tools as readonly string[]).includes(control.id));
      expect(row2.length).toBe(tools.length);
      for (const control of row2) {
        expect(Math.abs(control.top - row2[0].top), `${control.id} shares the tool row`).toBeLessThanOrEqual(2);
      }
      for (const control of controls) {
        expect(await topMostTestIdAt(page, control.id), `${control.id} must not be covered`).toBe(control.id);
      }
      expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);
    }
  });

  test("the floors at 360 × 740", async ({ page }, testInfo) => {
    await enableAi(page);
    await page.setViewportSize({ width: 360, height: 740 });

    // The reader at its fullest: signed in, AI on, a term with its navigation.
    await page.goto(`/books/${seededBookId()}/read?q=${encodeURIComponent(SEED_NEEDLE)}`);
    await expect(page.getByTestId("match-count")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("ai-toggle")).toBeVisible();
    await expect(page.getByTestId("add-bookmark")).toBeVisible();
    const readerHeight = await toolbarHeight(page, "reader-toolbar");
    const readerControls = await controlsOf(page, "reader-toolbar");
    const tools = readerControls.filter((control) => READER_TOOLS.includes(control.id));
    expect(tools.length).toBe(READER_TOOLS.length);
    for (const control of tools) expect(Math.abs(control.top - tools[0].top), `${control.id}`).toBeLessThanOrEqual(2);
    // The match navigation stays beside the title, above the tools.
    const prev = readerControls.find((control) => control.id === "match-prev")!;
    expect(prev.bottom).toBeLessThanOrEqual(tools[0].top + 1);
    const readerTitle = await page.getByTestId("reader-toolbar").locator("h1").evaluate((h1) => h1.getBoundingClientRect().width);
    expect(readerTitle, "reader title at 360 px").toBeGreaterThanOrEqual(80);
    expect(readerHeight).toBeLessThanOrEqual(PHONE_CAP);
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);

    await page.goto("/quran/5");
    await expect(page.getByTestId("quran-toolbar")).toBeVisible();
    const quranTitle = await page.getByTestId("quran-toolbar").locator("h1").evaluate((h1) => h1.getBoundingClientRect().width);
    expect(quranTitle, "sura title at 360 px").toBeGreaterThanOrEqual(160);
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);

    const path = await newNote(page);
    try {
      await expect(page.getByTestId("notes-ai-toggle")).toBeVisible();
      await page.getByTestId("note-body").click();
      await page.keyboard.type("سىناق");
      await expect(page.getByTestId("save-state")).toHaveText("ساقلاندى", { timeout: 20_000 });
      const noteTitle = await page.getByTestId("note-title").evaluate((input) => input.getBoundingClientRect().width);
      const noteHeight = await toolbarHeight(page, "note-toolbar");
      expect(noteTitle, "note title field at 360 px").toBeGreaterThanOrEqual(72);
      expect(noteHeight).toBeLessThanOrEqual(PHONE_CAP);
      expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);
      console.log(
        `[${testInfo.project.name}] 360×740: reader title ${readerTitle.toFixed(1)} px (toolbar ${readerHeight.toFixed(1)} px), ` +
          `sura title ${quranTitle.toFixed(1)} px, note title ${noteTitle.toFixed(1)} px (toolbar ${noteHeight.toFixed(1)} px)`,
      );
    } finally {
      await dropNote(path);
    }
  });
});

test.describe("on a wide screen", () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) < 640, "wide rows only");

  /** The reader as a signed-out visitor sees it, and at its fullest. */
  const readerPersonas = () => [
    { name: "signed out", url: `/books/${seededBookId()}/read`, anonymous: true },
    { name: "signed in, AI, a term", url: `/books/${seededBookId()}/read?q=${encodeURIComponent(SEED_NEEDLE)}`, anonymous: false },
  ];

  test("one row at 1280 and at 768; at 640 only the fullest reader may wrap", async ({ browser }, testInfo) => {
    for (const persona of readerPersonas()) {
      const context = await browser.newContext({
        ...(persona.anonymous ? { storageState: ANONYMOUS } : {}),
        viewport: { width: 1280, height: 800 },
      });
      const page = await context.newPage();
      try {
        await enableAi(page);
        for (const [width, height] of [
          [1280, 800],
          [768, 1024],
          [640, 800],
        ] as const) {
          await page.setViewportSize({ width, height });
          for (const [path, toolbar] of [
            [persona.url, "reader-toolbar"],
            ["/quran/5", "quran-toolbar"],
          ] as const) {
            await page.goto(path);
            await expect(page.getByTestId(toolbar)).toBeVisible();
            if (!persona.anonymous && toolbar === "reader-toolbar") {
              await expect(page.getByTestId("match-count")).toBeVisible({ timeout: 20_000 });
              await expect(page.getByTestId("ai-toggle")).toBeVisible();
            }
            const controls = await controlsOf(page, toolbar);
            const rows = rowsOf(controls);
            console.log(`[${testInfo.project.name}] ${persona.name} ${toolbar} at ${width}: ${rows} row(s)`);
            const mayWrap = width === 640 && !persona.anonymous && toolbar === "reader-toolbar";
            if (!mayWrap) {
              expect(rows, `${persona.name}, ${toolbar} at ${width} px is one row`).toBe(1);
              for (const control of controls) {
                expect(Math.abs(control.top + control.height / 2 - (controls[0].top + controls[0].height / 2))).toBeLessThanOrEqual(2);
              }
            }
            for (const control of controls) expect(control.height, `${control.id}`).toBeGreaterThanOrEqual(44);
            expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);
          }
        }
      } finally {
        await context.close();
      }
    }
  });
});
