import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { freshPassword, hasStaffTestEnv, loadEnvLocal, testEmail } from "./env";
import { adminClient, newNote } from "./fixtures/notes";
import { scrollPage, scrollToTop } from "./fixtures/scroll";
import { CREATE_RATE_MESSAGE, SAVE_LABEL, SAVE_MESSAGES } from "../lib/notes/save-protocol";
import { formatMegabytes } from "../lib/notes/usage";

loadEnvLocal();

test.skip(!hasStaffTestEnv(), "Supabase env not configured");

/**
 * The notebook's quota as the writer meets it (PROMPT-44).
 *
 * The limits themselves — 200 notes, 5 MB, enforced by migration 0030's
 * trigger — are proven in PGlite (tests/unit/note-quota-sql.test.ts). Here
 * nobody's account is filled: a full notebook, and a writer told to slow
 * down, are this page's own Server Action answers made up by the spec, and
 * a made-up answer never reaches the server — so the note there stays at the
 * version the editor knows. Every text is invented.
 *
 * A made-up answer is what Next sends for an action that revalidated
 * nothing: row 0 points at the result and carries no page (`"f":""`), row 1
 * is the result, and there is no `x-action-revalidated` header — so the
 * router resolves the action with the result and re-renders nothing
 * (next/dist/client/components/router-reducer/reducers/server-action-
 * reducer.js). Replaying a real save's answer instead does not work: it
 * carries the whole re-rendered page, and the action never settled. Only
 * the build id (`"b"`) is borrowed from a real answer, so a production
 * build's id is right too.
 */
test.use({ serviceWorkers: "block" });

/** A real save's result, as the dev server frames it. */
const SAVED = /^1:\{"ok":true,"updatedAt":"[^"]*"\}$/m;
/** The build id in a real answer's row 0. */
const BUILD_ID = /^0:\{.*"b":("[^"]*")/m;

type Answer = Record<string, unknown>;

/**
 * Made-up answers for note saves and note creates, on every page of the
 * context. Until an answer is set — and until a real save has been seen to
 * borrow the build id from — every request goes through untouched.
 */
async function fakeAnswers(context: BrowserContext) {
  const state = {
    buildId: null as string | null,
    save: null as Answer | null,
    create: null as Answer | null,
    faked: 0,
  };
  await context.route("**/*", async (route) => {
    const request = route.request();
    if (request.method() !== "POST" || !request.headers()["next-action"]) return route.fallback();
    const body = request.postData() ?? "";
    const kind = body.includes('"baseUpdatedAt"')
      ? "save"
      : body === "[]" || body.includes('"html"')
        ? "create"
        : "other";
    const answer = kind === "save" ? state.save : kind === "create" ? state.create : null;
    if (answer && state.buildId) {
      state.faked += 1;
      await route.fulfill({
        status: 200,
        headers: { "content-type": "text/x-component" },
        body: `0:{"a":"$@1","f":"","b":${state.buildId},"q":"","i":false}\n1:${JSON.stringify(answer)}\n`,
      });
      return;
    }
    if (kind === "save" && state.buildId === null) {
      const response = await route.fetch();
      const text = await response.text();
      const buildId = BUILD_ID.exec(text)?.[1];
      if (SAVED.test(text) && buildId) state.buildId = buildId;
      await route.fulfill({ response, body: text });
      return;
    }
    await route.fallback();
  });
  return state;
}

async function write(page: Page, text: string) {
  const body = page.getByTestId("note-body");
  await expect(body).toHaveAttribute("contenteditable", "true");
  await body.click();
  await page.keyboard.press("End");
  await page.keyboard.type(text);
}

/** This device's copy of a note, as the editor keeps it (lib/notes/drafts.ts). */
async function deviceCopy(page: Page, path: string): Promise<string | null> {
  const id = path.split("/").pop()!;
  return page.evaluate((noteId) => {
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index)!;
      if (key.startsWith("bh-note-draft-v2:") && key.endsWith(`:${noteId}`)) return localStorage.getItem(key);
    }
    return null;
  }, id);
}

async function removeNote(path: string) {
  await adminClient().from("note_documents").delete().eq("id", Number(path.split("/").pop()));
}

async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

/** Visible, at least 44 px tall, and the thing under its centre is itself. */
async function expectTappable(page: Page, testId: string) {
  const control = page.getByTestId(testId);
  await expect(control, testId).toBeInViewport({ ratio: 1 });
  const box = (await control.boundingBox())!;
  expect(box.height, `${testId} is a 44 px target`).toBeGreaterThanOrEqual(44);
  const onTop = await control.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return hit !== null && element.contains(hit);
  });
  expect(onTop, `${testId} is not covered`).toBe(true);
}

/**
 * At every width this project promises (phones: the narrowest, 360, too):
 * nothing scrolls sideways, and after scrolling down and back up the given
 * things are on screen.
 */
async function checkEveryWidth(page: Page, visible: string[], tappable: string[] = []) {
  const { width: own, height } = test.info().project.use.viewport!;
  const widths = own < 768 ? [own, 360] : [own];
  for (const width of widths) {
    await page.setViewportSize({ width, height });
    expect(await horizontalOverflow(page), `no sideways scroll at ${width}px`).toBeLessThanOrEqual(1);
    await scrollPage(page, 4000);
    await scrollPage(page, -6000);
    await scrollToTop(page);
    for (const testId of visible) await expect(page.getByTestId(testId), `${testId} at ${width}px`).toBeInViewport();
    for (const testId of tappable) await expectTappable(page, testId);
  }
  await page.setViewportSize({ width: own, height });
}

test.describe("where the writer stands", () => {
  // A brand-new account, so the numbers are exactly the notes made here.
  test.use({ storageState: { cookies: [], origins: [] } });

  test("the usage line under the heading counts the notes and their megabytes", async ({ page }, testInfo) => {
    const supabase = adminClient();
    const email = testEmail(`quota-${testInfo.project.name}-${Date.now()}`);
    const password = freshPassword();
    const { data: created, error } = await supabase.auth.admin.createUser({ email, password, email_confirm: true });
    if (error || !created.user) throw new Error(`could not create a fresh user: ${error?.message}`);

    try {
      // Two notes, one long enough to show in the megabytes. Repetitive text
      // compresses to almost nothing in the database.
      const long = "ئۇزۇن جۈملە ".repeat(12_000);
      const { error: insertError } = await supabase.from("note_documents").insert([
        { user_id: created.user.id, title: "قىسقا", content_html: "<p>بىر</p>", content_text: "بىر" },
        { user_id: created.user.id, title: "ئۇزۇن", content_html: `<p>${long}</p>`, content_text: long },
      ]);
      expect(insertError).toBeNull();
      const { data: rows } = await supabase
        .from("note_documents")
        .select("content_bytes")
        .eq("user_id", created.user.id);
      const bytes = ((rows ?? []) as { content_bytes: number }[]).reduce((sum, row) => sum + row.content_bytes, 0);
      expect(bytes).toBeGreaterThan(0.2 * 1024 * 1024);

      await page.goto("/login");
      await page.locator('input[name="email"]').fill(email);
      await page.locator('input[name="password"]').fill(password);
      await page.getByRole("button", { name: "كىرىش" }).click();
      await expect(page.getByRole("button", { name: /چىقىش/ })).toBeVisible({ timeout: 20_000 });

      await page.goto("/notes");
      const usage = page.getByTestId("notes-usage");
      await expect(usage).toHaveText(`2 / 200 خاتىرە · ${formatMegabytes(bytes)} MB / 5 MB`);
      await expect(usage).toHaveAttribute("data-level", "ok");
      await expect(page.getByTestId("notes-usage-hint")).toHaveCount(0);
      // Plenty of room: «يېڭى خاتىرە» points at nothing.
      await expect(page.getByTestId("new-note")).not.toHaveAttribute("aria-describedby");

      // Under the heading, above the list.
      const heading = (await page.getByRole("heading", { level: 1 }).boundingBox())!;
      const line = (await usage.boundingBox())!;
      const list = (await page.getByTestId("note-list").boundingBox())!;
      expect(line.y).toBeGreaterThanOrEqual(heading.y + heading.height - 1);
      expect(line.y + line.height).toBeLessThanOrEqual(list.y);

      await checkEveryWidth(page, ["notes-usage"], ["new-note"]);
    } finally {
      await supabase.auth.admin.deleteUser(created.user.id);
    }
  });
});

test.describe("a full notebook, and a writer told to slow down", () => {
  test("too many megabytes: the save is refused, the text stays on this device, and deleting text saves again", async ({
    page,
    context,
  }) => {
    const path = await newNote(page);
    const fake = await fakeAnswers(context);
    try {
      await write(page, "بىرىنچى جۈملە.");
      await expect(page.getByTestId("save-state")).toHaveText(SAVE_LABEL.saved, { timeout: 20_000 });
      expect(fake.buildId, "a real save was seen").not.toBeNull();

      fake.save = { ok: false, code: "quota_bytes", error: SAVE_MESSAGES.quota_bytes };
      await write(page, " ئىككىنچى جۈملە");
      await expect(page.getByTestId("save-state")).toHaveText(SAVE_LABEL.blocked, { timeout: 20_000 });
      const blocked = page.getByTestId("note-blocked");
      await expect(blocked.locator("p")).toHaveText(SAVE_MESSAGES.quota_bytes);
      await expect(page.getByTestId("note-quota-list")).toHaveAttribute("href", "/notes");
      expect(fake.faked).toBe(1);
      // Nothing written is lost: the copy here holds the refused sentence.
      expect(await deviceCopy(page, path)).toContain("ئىككىنچى جۈملە");
      // No retry row: waiting would get the same answer.
      await expect(page.getByTestId("save-retry")).toHaveCount(0);

      await checkEveryWidth(page, ["note-blocked", "save-state"], ["note-quota-list"]);

      // Room again (other notes deleted, say) — and deleting text is the edit
      // that tries again.
      fake.save = null;
      const body = page.getByTestId("note-body");
      await body.click();
      await page.keyboard.press("End");
      await page.keyboard.press("Backspace");
      await expect(page.getByTestId("save-state")).toHaveText(SAVE_LABEL.saved, { timeout: 20_000 });
      await expect(page.getByTestId("note-blocked")).toHaveCount(0);
      expect(await deviceCopy(page, path)).toBeNull();

      await page.reload();
      await expect(page.getByTestId("note-body")).toContainText("بىرىنچى جۈملە. ئىككىنچى جۈمل");
    } finally {
      await context.unrouteAll({ behavior: "ignoreErrors" });
      await removeNote(path);
    }
  });

  test("too fast: it says it will try by itself in a minute, offers no button, and keeps the text", async ({
    page,
    context,
  }) => {
    const path = await newNote(page);
    const fake = await fakeAnswers(context);
    try {
      await write(page, "تېز");
      await expect(page.getByTestId("save-state")).toHaveText(SAVE_LABEL.saved, { timeout: 20_000 });

      fake.save = { ok: false, code: "rate", error: SAVE_MESSAGES.rate };
      await write(page, " يېزىش");
      await expect(page.getByTestId("save-state")).toHaveText(SAVE_LABEL.retrying, { timeout: 20_000 });
      await expect(page.getByTestId("note-rate")).toHaveText(SAVE_MESSAGES.rate);
      await expect(page.getByTestId("save-retry")).toHaveCount(0);
      expect(fake.faked).toBe(1);
      expect(await deviceCopy(page, path)).toContain("يېزىش");

      // Writing on while it waits sends nothing early.
      await write(page, " داۋاملىق");
      await page.waitForTimeout(5_000);
      expect(fake.faked).toBe(1);
      expect(await deviceCopy(page, path)).toContain("داۋاملىق");

      await checkEveryWidth(page, ["note-rate", "save-state"]);
    } finally {
      await context.unrouteAll({ behavior: "ignoreErrors" });
      await removeNote(path);
    }
  });

  test("«يېڭى خاتىرە» on a full notebook, or pressed too often, says why", async ({ page, context }) => {
    const path = await newNote(page);
    const fake = await fakeAnswers(context);
    try {
      await write(page, "بىر");
      await expect(page.getByTestId("save-state")).toHaveText(SAVE_LABEL.saved, { timeout: 20_000 });

      await page.goto("/notes");
      await expect(page.getByTestId("notes-usage")).toBeVisible();
      fake.create = { ok: false, code: "quota_count", error: SAVE_MESSAGES.quota_count };
      await page.getByTestId("new-note").click();
      await expect(page.getByTestId("notes-error")).toHaveText(SAVE_MESSAGES.quota_count);
      await expect(page).toHaveURL(/\/notes$/);
      expect(fake.faked).toBe(1);
      await checkEveryWidth(page, ["notes-usage", "notes-error"], ["new-note"]);

      fake.create = { ok: false, code: "rate", error: CREATE_RATE_MESSAGE };
      await page.getByTestId("new-note").click();
      await expect(page.getByTestId("notes-error")).toHaveText(CREATE_RATE_MESSAGE);
      await expect(page).toHaveURL(/\/notes$/);
      expect(fake.faked).toBe(2);
    } finally {
      await context.unrouteAll({ behavior: "ignoreErrors" });
      await removeNote(path);
    }
  });

  test("keeping both versions on a full notebook says so and keeps this tab's text", async ({ page, context }) => {
    const path = await newNote(page);
    const fake = await fakeAnswers(context);
    const other = await context.newPage();
    try {
      await other.goto(path);
      await expect(other.getByTestId("note-body")).toBeVisible();

      await write(page, "بىرىنچى بەتكۈچ");
      await expect(page.getByTestId("save-state")).toHaveText(SAVE_LABEL.saved, { timeout: 20_000 });
      await write(other, "ئىككىنچى بەتكۈچ");
      await expect(other.getByTestId("note-conflict")).toBeVisible({ timeout: 20_000 });

      fake.create = { ok: false, code: "quota_count", error: SAVE_MESSAGES.quota_count };
      await other.getByTestId("conflict-keep-both").click();
      await expect(other.getByTestId("note-notice")).toHaveText(SAVE_MESSAGES.quota_count, { timeout: 20_000 });
      expect(fake.faked).toBe(1);
      // Nothing was replaced: the choice is still open, the text still here.
      await expect(other.getByTestId("note-conflict")).toBeVisible();
      await expect(other.getByTestId("note-body")).toContainText("ئىككىنچى بەتكۈچ");
      expect(await deviceCopy(other, path)).toContain("ئىككىنچى بەتكۈچ");
    } finally {
      await other.close();
      await context.unrouteAll({ behavior: "ignoreErrors" });
      await removeNote(path);
    }
  });

  test("saving a note deleted elsewhere as a new one, on a full notebook, says so and keeps the text", async ({
    page,
    context,
  }) => {
    const path = await newNote(page);
    const fake = await fakeAnswers(context);
    try {
      await write(page, "ئۆچۈرۈلگەن");
      await expect(page.getByTestId("save-state")).toHaveText(SAVE_LABEL.saved, { timeout: 20_000 });

      await removeNote(path);
      await write(page, " خاتىرە");
      await expect(page.getByTestId("note-save-as-new")).toBeVisible({ timeout: 20_000 });

      fake.create = { ok: false, code: "quota_count", error: SAVE_MESSAGES.quota_count };
      await page.getByTestId("note-save-as-new").click();
      await expect(page.getByTestId("note-notice")).toHaveText(SAVE_MESSAGES.quota_count, { timeout: 20_000 });
      expect(fake.faked).toBe(1);
      await expect(page).toHaveURL(new RegExp(`${path}$`));
      await expect(page.getByTestId("note-save-as-new")).toBeVisible();
      expect(await deviceCopy(page, path)).toContain("ئۆچۈرۈلگەن خاتىرە");
    } finally {
      await context.unrouteAll({ behavior: "ignoreErrors" });
      await removeNote(path);
    }
  });
});
