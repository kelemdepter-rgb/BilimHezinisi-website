import { expect, test, type Page } from "@playwright/test";
import { hasStaffTestEnv, loadEnvLocal } from "./env";
import { scrollPage, scrollToTop } from "./fixtures/scroll";
import { adminClient, dropNote, signedInUserId } from "./fixtures/notes";
import { IN_TRASH, MOVED_TO_TRASH, SEARCH_EMPTY, TRASH_EMPTY } from "../lib/notes/list-protocol";
import { SAVE_MESSAGES } from "../lib/notes/save-protocol";

loadEnvLocal();

test.skip(!hasStaffTestEnv(), "Supabase env not configured");

/**
 * The notebook's list and trash (PROMPT-47): search, preview, the three
 * orders, pinning, moving to the trash and back, deleting for good in two
 * steps, a trashed note opened read-only, untouched new notes that clean
 * themselves up, local dates, and the book notes' own name. Every note here
 * is a scratch note of the shared staff account with invented text, made
 * straight in the database and deleted for good at the end — none is left in
 * the trash, which still counts against the account's 200.
 */

/** The staff account's notes are shared by every project: each test words its own. */
function marker(): string {
  return `نىشان${Math.random().toString(36).slice(2, 8)}`;
}

type Seed = { title?: string; text?: string; created?: string; updated?: string; trashed?: boolean };

/** A note for this page's user, straight in the database. Returns its id. */
async function seedNote(page: Page, seed: Seed = {}): Promise<number> {
  const row: Record<string, unknown> = { user_id: await signedInUserId(page) };
  if (seed.title !== undefined) row.title = seed.title;
  if (seed.text !== undefined) {
    row.content_html = `<p>${seed.text}</p>`;
    row.content_text = seed.text;
  }
  if (seed.created) row.created_at = seed.created;
  if (seed.updated) row.updated_at = seed.updated;
  if (seed.trashed) row.deleted_at = new Date().toISOString();
  const { data, error } = await adminClient().from("note_documents").insert(row).select("id").single();
  if (error || !data) throw new Error(`could not make a scratch note: ${error?.message}`);
  return (data as { id: number }).id;
}

async function dropNotes(ids: number[]) {
  for (const id of ids) await dropNote(`/notes/${id}`);
}

async function stored(id: number): Promise<{ deleted_at: string | null; pinned_at: string | null } | null> {
  const { data } = await adminClient().from("note_documents").select("deleted_at, pinned_at").eq("id", id).maybeSingle();
  return (data as { deleted_at: string | null; pinned_at: string | null } | null) ?? null;
}

function row(page: Page, id: number) {
  return page.locator(`[data-testid="note-row"][data-note-id="${id}"]`);
}

async function openList(page: Page) {
  await page.goto("/notes");
  await expect(page.getByTestId("new-note")).toBeVisible();
}

/** Search, and wait for the answer to the words typed. */
async function search(page: Page, words: string) {
  await page.getByTestId("notes-search").fill(words);
  await expect(page.getByTestId("notes-searching")).toHaveCount(0, { timeout: 20_000 });
}

async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

/** Visible, at least 44 px tall, and the thing under its centre is itself. */
async function expectTappable(page: Page, control: ReturnType<Page["locator"]>, name: string) {
  await expect(control, name).toBeInViewport({ ratio: 1 });
  const box = (await control.boundingBox())!;
  expect(box.height, `${name} is a 44 px target`).toBeGreaterThanOrEqual(44);
  expect(box.width, `${name} is a 44 px target`).toBeGreaterThanOrEqual(44);
  const onTop = await control.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return hit !== null && element.contains(hit);
  });
  expect(onTop, `${name} is not covered`).toBe(true);
}

test.describe("finding a note", () => {
  test("search finds a note by a word in its text, and says so when no note holds it", async ({ page }) => {
    const word = marker();
    const found = await seedNote(page, { title: "سىناق ئىزدەش", text: `بۈگۈن ${word} توغرىسىدا ئويلىدىم` });
    const other = await seedNote(page, { title: "باشقا خاتىرە", text: "مۇناسىۋىتى يوق مەزمۇن" });
    try {
      await openList(page);
      // The preview: the note's opening, without opening it.
      await expect(row(page, found).getByTestId("note-preview")).toContainText(word);

      await search(page, word);
      await expect(row(page, found)).toBeVisible();
      await expect(page.locator('[data-testid="note-row"]')).toHaveCount(1);

      await search(page, `${word}يوق`);
      await expect(page.getByTestId("notes-search-empty")).toHaveText(SEARCH_EMPTY);
      await expect(page.locator('[data-testid="note-row"]')).toHaveCount(0);

      await page.getByTestId("notes-search-clear").click();
      await expect(page.getByTestId("notes-search")).toHaveValue("");
      await expect(row(page, found)).toBeVisible();
      await expect(row(page, other)).toBeVisible();
    } finally {
      await dropNotes([found, other]);
    }
  });

  test("the three orders, remembered after a reload; pinned notes under «مىقلانغانلار», pinned after a reload too", async ({
    page,
  }) => {
    const word = marker();
    const ids = {
      // Made first, edited last.
      a: await seedNote(page, {
        title: "ئانا",
        text: `${word} بىر`,
        created: "2026-01-01T08:00:00Z",
        updated: "2026-03-01T08:00:00Z",
      }),
      b: await seedNote(page, {
        title: "ەلا",
        text: `${word} ئىككى`,
        created: "2026-02-01T08:00:00Z",
        updated: "2026-02-01T09:00:00Z",
      }),
      c: await seedNote(page, {
        title: "بىلىم",
        text: `${word} ئۈچ`,
        created: "2026-01-15T08:00:00Z",
        updated: "2026-01-20T08:00:00Z",
      }),
    };
    const order = async () =>
      page
        .locator('[data-testid="note-row"]')
        .evaluateAll((rows) => rows.map((element) => Number(element.getAttribute("data-note-id"))));
    try {
      await openList(page);
      await search(page, word);
      await expect(page.locator('[data-testid="note-row"]')).toHaveCount(3);
      expect(await order()).toEqual([ids.a, ids.b, ids.c]);

      await page.getByTestId("notes-sort").selectOption("created");
      expect(await order()).toEqual([ids.b, ids.c, ids.a]);

      // Uyghur order in every engine: ئ, then ا, ە, ب.
      await page.getByTestId("notes-sort").selectOption("title");
      expect(await order()).toEqual([ids.a, ids.b, ids.c]);
      await page.reload();
      await expect(page.getByTestId("notes-sort")).toHaveValue("title");

      // Pinning: the note goes up under its heading, and stays there.
      await search(page, word);
      await row(page, ids.c).getByTestId("pin-note").click();
      await expect(page.locator(`[data-testid="notes-pinned"] [data-note-id="${ids.c}"]`)).toBeVisible();
      await expect(page.getByRole("heading", { name: "مىقلانغانلار" })).toBeVisible();
      await expect.poll(async () => (await stored(ids.c))?.pinned_at ?? null).not.toBeNull();
      await page.reload();
      await expect(page.locator(`[data-testid="notes-pinned"] [data-note-id="${ids.c}"]`)).toBeVisible();
      await expect(row(page, ids.c).getByTestId("pin-note")).toHaveAttribute("aria-pressed", "true");

      await row(page, ids.c).getByTestId("pin-note").click();
      await expect(page.locator(`[data-testid="notes-pinned"] [data-note-id="${ids.c}"]`)).toHaveCount(0);
      await expect.poll(async () => (await stored(ids.c))?.pinned_at ?? null).toBeNull();
    } finally {
      await page.evaluate(() => localStorage.removeItem("bh-notes-sort"));
      await dropNotes(Object.values(ids));
    }
  });

});

test.describe("the reader's own time", () => {
  test.use({ timezoneId: "Europe/Istanbul" });

  test("half past midnight in Istanbul is that day, not the day before in UTC", async ({ page }) => {
    const id = await seedNote(page, {
      title: "تۈن يېرىمىدىكى خاتىرە",
      text: "سىناق",
      created: "2026-10-06T21:30:00Z",
      updated: "2026-10-06T21:30:00Z",
    });
    try {
      await openList(page);
      await expect(row(page, id).getByTestId("note-time")).toHaveText("2026-10-07 00:30");
    } finally {
      await dropNotes([id]);
    }
  });
});

test.describe("the trash", () => {
  test("delete, put back at once; delete again, put back from the trash; delete for good", async ({ page }) => {
    const word = marker();
    const text = `ئەخلەت سىنىقى ${word}`;
    const id = await seedNote(page, { title: "ئەخلەت سىنىقى", text });
    try {
      await openList(page);
      // No dialog of any kind: Playwright would fail the test on one left unanswered.
      page.on("dialog", (dialog) => {
        throw new Error(`a native dialog appeared: ${dialog.message()}`);
      });

      await row(page, id).getByTestId("delete-note").click();
      const moved = page.locator(`[data-testid="note-trashed"][data-note-id="${id}"]`);
      await expect(moved).toContainText(MOVED_TO_TRASH);
      await expect.poll(async () => (await stored(id))?.deleted_at ?? null).not.toBeNull();
      await moved.getByTestId("note-trash-undo").click();
      await expect(row(page, id)).toBeVisible();
      await expect.poll(async () => (await stored(id))?.deleted_at ?? null).toBeNull();

      await row(page, id).getByTestId("delete-note").click();
      await expect(moved).toBeVisible();
      await expect.poll(async () => (await stored(id))?.deleted_at ?? null).not.toBeNull();
      // The notice goes after ten seconds, and the note is not in the list.
      await expect(moved).toHaveCount(0, { timeout: 15_000 });
      await expect(row(page, id)).toHaveCount(0);

      await page.reload();
      await page.getByTestId("trash-link").click();
      await expect(page).toHaveURL(/\/notes\/trash$/);
      const inTrash = page.locator(`[data-testid="trash-row"][data-note-id="${id}"]`);
      await expect(inTrash.getByTestId("trash-countdown")).toHaveText("30 كۈندىن كېيىن مەڭگۈلۈك ئۆچىدۇ");
      await inTrash.getByTestId("trash-restore").click();
      await expect(inTrash).toHaveCount(0);
      await expect(page.getByTestId("trash-restored")).toBeVisible();

      await openList(page);
      await expect(row(page, id)).toBeVisible();
      await row(page, id).getByTestId("note-link").click();
      await expect(page.getByTestId("note-body")).toContainText(text);
      await expect(page.getByTestId("note-body")).toHaveAttribute("contenteditable", "true");

      // For good: two steps, the first one only asks.
      await openList(page);
      await row(page, id).getByTestId("delete-note").click();
      await expect.poll(async () => (await stored(id))?.deleted_at ?? null).not.toBeNull();
      await page.goto("/notes/trash");
      await inTrash.getByTestId("trash-delete").click();
      await expect(inTrash.getByTestId("trash-delete-confirm-box")).toBeVisible();
      await inTrash.getByTestId("trash-cancel").click();
      await expect(inTrash.getByTestId("trash-delete-confirm-box")).toHaveCount(0);
      expect(await stored(id)).not.toBeNull();
      await inTrash.getByTestId("trash-delete").click();
      await inTrash.getByTestId("trash-delete-confirm").click();
      await expect(inTrash).toHaveCount(0);
      await expect.poll(() => stored(id)).toBeNull();
    } finally {
      await dropNotes([id]);
    }
  });

  test("emptying the trash asks first, then takes every note in it", async ({ page }) => {
    const ids = [
      await seedNote(page, { title: "ئەخلەت بىر", text: "بىر", trashed: true }),
      await seedNote(page, { title: "ئەخلەت ئىككى", text: "ئىككى", trashed: true }),
    ];
    try {
      await page.goto("/notes/trash");
      for (const id of ids) await expect(page.locator(`[data-testid="trash-row"][data-note-id="${id}"]`)).toBeVisible();
      await page.getByTestId("trash-empty-all").click();
      await expect(page.getByTestId("trash-empty-confirm-box")).toBeVisible();
      await page.getByTestId("trash-cancel").click();
      for (const id of ids) expect(await stored(id)).not.toBeNull();

      await page.getByTestId("trash-empty-all").click();
      await page.getByTestId("trash-empty-confirm").click();
      await expect(page.getByTestId("trash-empty")).toHaveText(TRASH_EMPTY);
      for (const id of ids) await expect.poll(() => stored(id)).toBeNull();
    } finally {
      await dropNotes(ids);
    }
  });

  test("a note in the trash opens read-only, with the way back", async ({ page }) => {
    const text = `ئوقۇشقىلا بولىدىغان ${marker()}`;
    const id = await seedNote(page, { title: "ئەخلەتتىكى خاتىرە", text, trashed: true });
    try {
      await page.goto(`/notes/${id}`);
      await expect(page.getByTestId("note-in-trash")).toContainText(IN_TRASH);
      const body = page.getByTestId("note-body");
      await expect(body).toContainText(text);
      await expect(body).toHaveAttribute("contenteditable", "false");

      await page.getByTestId("note-restore").click();
      await expect(page.getByTestId("note-in-trash")).toHaveCount(0);
      await expect(body).toHaveAttribute("contenteditable", "true");
      await expect.poll(async () => (await stored(id))?.deleted_at ?? null).toBeNull();
    } finally {
      await dropNotes([id]);
    }
  });

  test("moved to the trash elsewhere while open: nothing is lost, and «قايتۇرۇش» saves it", async ({ page }) => {
    const id = await seedNote(page, { title: "ئوچۇق خاتىرە", text: "باشلىنىشى" });
    try {
      await page.goto(`/notes/${id}`);
      const body = page.getByTestId("note-body");
      await expect(body).toHaveAttribute("contenteditable", "true");
      await body.click();
      await page.keyboard.press("End");
      await page.keyboard.type(" بىرىنچى");
      await expect(page.getByTestId("save-state")).toHaveText("ساقلاندى", { timeout: 20_000 });

      // Another device moves it to the trash.
      await adminClient().from("note_documents").update({ deleted_at: new Date().toISOString() }).eq("id", id);
      await page.keyboard.type(" ئىككىنچى");
      await expect(page.getByTestId("note-blocked")).toContainText(SAVE_MESSAGES.in_trash, { timeout: 20_000 });
      await expect(body).toHaveAttribute("contenteditable", "false");

      await page.getByTestId("note-restore").click();
      await expect(page.getByTestId("save-state")).toHaveText("ساقلاندى", { timeout: 20_000 });
      await expect(body).toHaveAttribute("contenteditable", "true");
      const { data } = await adminClient().from("note_documents").select("content_text, deleted_at").eq("id", id).single();
      expect(data).toMatchObject({ deleted_at: null });
      expect((data as { content_text: string }).content_text).toContain("ئىككىنچى");
    } finally {
      await dropNotes([id]);
    }
  });
});

test.describe("a note nobody wrote in", () => {
  test("is gone once its writer leaves it — and not a moment before", async ({ page }) => {
    await openList(page);
    await page.getByTestId("new-note").click();
    await expect(page).toHaveURL(/\/notes\/\d+$/, { timeout: 20_000 });
    const id = Number(new URL(page.url()).pathname.split("/").pop());
    try {
      await expect(page.getByTestId("note-body")).toHaveAttribute("contenteditable", "true");
      // Opening it is not leaving it — development runs every effect's
      // cleanup once right after mounting.
      await page.waitForTimeout(1500);
      expect(await stored(id)).not.toBeNull();

      await page.getByTestId("notes-back").click();
      await expect(page).toHaveURL(/\/notes$/);
      await expect(page.getByTestId("new-note")).toBeVisible();
      await expect(page.locator(`a[href="/notes/${id}"]`)).toHaveCount(0);
      expect(await stored(id)).toBeNull();
    } finally {
      await dropNotes([id]);
    }
  });

  test("one with a single word in it stays", async ({ page }) => {
    await openList(page);
    await page.getByTestId("new-note").click();
    await expect(page).toHaveURL(/\/notes\/\d+$/, { timeout: 20_000 });
    const id = Number(new URL(page.url()).pathname.split("/").pop());
    try {
      const body = page.getByTestId("note-body");
      await expect(body).toHaveAttribute("contenteditable", "true");
      await body.click();
      await page.keyboard.type("سۆز");
      await page.getByTestId("notes-back").click();
      await expect(page).toHaveURL(/\/notes$/);
      await expect(page.locator(`[data-testid="note-row"][data-note-id="${id}"]`)).toBeVisible();
    } finally {
      await dropNotes([id]);
    }
  });
});

test.describe("two kinds of notes, two names", () => {
  test("book notes are «كىتابتىكى خاتىرىلىرىم»; the notebook keeps «خاتىرە دەپتىرىم»", async ({ page }) => {
    await page.goto("/my/notes");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("كىتابتىكى خاتىرىلىرىم");
    await expect(page).toHaveTitle(/كىتابتىكى خاتىرىلىرىم/);
    await openList(page);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("خاتىرە دەپتىرىم");
  });
});

test.describe("on a phone", () => {
  test("nothing scrolls sideways, and every control stays reachable after scrolling down and back up", async ({
    page,
  }) => {
    const word = marker();
    const ids: number[] = [];
    for (let index = 0; index < 12; index++) {
      ids.push(
        await seedNote(page, {
          title: `ئۇزۇن ماۋزۇلۇق سىناق خاتىرىسى ${index} ${"ئۇزۇن".repeat(8)}`,
          text: `${word} ${"بىر جۈملە ".repeat(40)}`,
        }),
      );
    }
    ids.push(await seedNote(page, { title: "ئەخلەتتىكى", text: word, trashed: true }));
    const first = ids[11];
    try {
      const { width: own, height } = test.info().project.use.viewport!;
      for (const width of own < 768 ? [own, 360] : [own]) {
        await page.setViewportSize({ width, height });
        await openList(page);
        await search(page, word);
        await expect(page.locator('[data-testid="note-row"]')).toHaveCount(12);
        expect(await horizontalOverflow(page), `no sideways scroll at ${width}px`).toBeLessThanOrEqual(1);

        await scrollPage(page, 4000);
        await scrollPage(page, -6000);
        await scrollToTop(page);
        await expectTappable(page, page.getByTestId("notes-search"), `search at ${width}px`);
        await expectTappable(page, page.getByTestId("notes-search-clear"), `clear at ${width}px`);
        await expectTappable(page, page.getByTestId("notes-sort"), `sort at ${width}px`);
        await expectTappable(page, page.getByTestId("trash-link"), `trash link at ${width}px`);
        await expectTappable(page, page.getByTestId("new-note"), `new note at ${width}px`);
        await expectTappable(page, row(page, first).getByTestId("pin-note"), `pin at ${width}px`);
        await expectTappable(page, row(page, first).getByTestId("delete-note"), `delete at ${width}px`);

        await page.goto("/notes/trash");
        const trashed = page.locator(`[data-testid="trash-row"][data-note-id="${ids[12]}"]`);
        await expect(trashed).toBeVisible();
        // A list page, not a writing surface: the site's own header and
        // footer stay (only a note's own address is bare).
        await expect(page.locator("header"), "the trash keeps the site header").toHaveCount(1);
        await expect(page.locator("footer"), "the trash keeps the site footer").toHaveCount(1);
        expect(await horizontalOverflow(page), `no sideways scroll in the trash at ${width}px`).toBeLessThanOrEqual(1);
        await scrollPage(page, 3000);
        await scrollPage(page, -5000);
        await scrollToTop(page);
        await expectTappable(page, page.getByTestId("trash-empty-all"), `empty trash at ${width}px`);
        await expectTappable(page, trashed.getByTestId("trash-restore"), `restore at ${width}px`);
        await expectTappable(page, trashed.getByTestId("trash-delete"), `delete for good at ${width}px`);
      }
      await page.setViewportSize({ width: own, height });
    } finally {
      await dropNotes(ids);
    }
  });
});
