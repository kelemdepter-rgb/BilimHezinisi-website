import { test, expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import {
  READER_SETTINGS_KEY,
  STAFF_STATE_PATH,
  hasStaffTestEnv,
  loadEnvLocal,
  readSeed,
} from "./env";

loadEnvLocal();

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
  await page.waitForTimeout(250);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(250);
}

/** The element actually on top at a locator's centre — catches covered content. */
async function topMostAt(page: Page, locator: ReturnType<Page["locator"]>): Promise<string | null> {
  const box = await locator.boundingBox();
  expect(box, "element must have a box").not.toBeNull();
  return page.evaluate(
    ([x, y]) => {
      const element = document.elementFromPoint(x, y);
      return element?.closest("[data-testid]")?.getAttribute("data-testid") ?? null;
    },
    [box!.x + box!.width / 2, box!.y + box!.height / 2] as const,
  );
}

/* ── Licence attribution ─────────────────────────────────────────────────── */

test.describe("source attribution", () => {
  test("every sura credits Tanzil and QuranEnc, and links back to both", async ({ page }) => {
    await page.goto("/quran/1");
    const note = page.getByTestId("quran-source-note");
    await note.scrollIntoViewIfNeeded();
    await expect(note).toBeVisible();

    // The Tanzil licence requires the source, a link, and that the text is
    // not presented as altered.
    await expect(note).toContainText("Tanzil Project");
    await expect(note).toContainText("ھېچ ئۆزگەرتىلمىگەن");
    await expect(note.getByRole("link", { name: "Tanzil Project" })).toHaveAttribute(
      "href",
      "https://tanzil.net",
    );

    // QuranEnc's terms require the publisher, the translator and the version.
    await expect(note).toContainText("مۇھەممەد سالىھ");
    await expect(note).toContainText("v1.0.2-xml.1");
    await expect(note.getByRole("link", { name: "QuranEnc.com" })).toHaveAttribute(
      "href",
      "https://quranenc.com/en/browse/uyghur_saleh",
    );

    await assertNoHorizontalOverflow(page);
  });

  test("the sura's source note is never hidden behind the sticky jump bar", async ({ page }) => {
    await page.goto("/quran/1");
    await scrollDownAndBackUp(page);

    const note = page.getByTestId("quran-source-note");
    await note.scrollIntoViewIfNeeded();
    await expect(note).toBeInViewport();
    expect(await topMostAt(page, note), "the source note must not be covered").toBe(
      "quran-source-note",
    );
  });

  test("the Qur'an index carries the same credit", async ({ page }) => {
    await page.goto("/quran");
    const note = page.getByTestId("quran-source-note");
    await note.scrollIntoViewIfNeeded();
    await expect(note).toContainText("Tanzil Project");
    await expect(note).toContainText("QuranEnc.com");
    await assertNoHorizontalOverflow(page);
  });
});

/* ── The public information pages ────────────────────────────────────────── */

for (const [path, heading] of [
  ["/about", "بىلىم خەزىنىسى ھەققىدە"],
  ["/privacy", "مەخپىيەتلىك سىياسىتى"],
] as const) {
  test.describe(`${path}`, () => {
    test("opens without an account and fits the viewport", async ({ page }) => {
      await page.goto(path);
      await expect(page.getByRole("heading", { name: heading, level: 1 })).toBeVisible();
      await assertNoHorizontalOverflow(page);
      await scrollDownAndBackUp(page);
      await assertNoHorizontalOverflow(page);
    });

    test("its last paragraph is not swallowed by the footer", async ({ page }) => {
      await page.goto(path);
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      await page.waitForTimeout(250);

      // The contact address is the last thing on both pages: if a sticky bar
      // covered anything, it would be this.
      const contact = page.getByRole("link", { name: "kelemdepter@gmail.com" }).first();
      await expect(contact).toBeInViewport();
      const box = (await contact.boundingBox())!;
      const covering = await page.evaluate(
        ([x, y]) => {
          const element = document.elementFromPoint(x, y);
          return element?.tagName ?? null;
        },
        [box.x + box.width / 2, box.y + box.height / 2] as const,
      );
      expect(covering, "the contact link must be the element on top").toBe("A");
    });

    test("is reachable from the footer of an ordinary page", async ({ page }) => {
      await page.goto("/");
      const link = page.getByTestId(path === "/about" ? "about-link" : "privacy-link");
      await link.scrollIntoViewIfNeeded();
      await expect(link).toBeVisible();
      await link.click();
      await expect(page).toHaveURL(new RegExp(`${path}$`));
    });
  });
}

/* ── Fonts we are allowed to serve ───────────────────────────────────────── */

test.describe("the reader's font picker", () => {
  test.skip(!hasStaffTestEnv(), "Supabase env not configured");

  function seededBookId(): number {
    const seed = readSeed();
    if (!seed) throw new Error("seed book missing — the setup project must run first");
    return seed.bookId;
  }

  test("offers only fonts we ship or resolve from the reader's own system", async ({ page }) => {
    await page.goto(`/books/${seededBookId()}/read`);
    await page.getByTestId("panel-toggle").click();
    await page.getByRole("tab", { name: "تەڭشەك" }).click();

    const picker = page.getByTestId("font-family");
    await expect(picker).toBeVisible();
    const values = await picker.locator("option").evaluateAll((options) =>
      options.map((option) => (option as HTMLOptionElement).value),
    );

    // Bahij Nazanin's licence forbids distribution outright; nothing may offer it.
    expect(values).not.toContain("bahij");
    // The clean-up must have left the reader with MORE choices, not fewer.
    expect(values.length).toBeGreaterThan(3);
    expect(values).toEqual(["ukij", "tuz", "tuztom", "tuzkitab", "trad"]);
  });

  test("a chosen UKIJ face is actually served and applied", async ({ page }) => {
    await page.goto(`/books/${seededBookId()}/read`);
    await page.getByTestId("panel-toggle").click();
    await page.getByRole("tab", { name: "تەڭشەك" }).click();
    await page.getByTestId("font-family").selectOption("tuzkitab");

    await expect
      .poll(async () =>
        page.evaluate(() =>
          [...document.fonts].some((face) => face.family === "UKIJ Tuz Kitab" && face.status === "loaded"),
        ),
      )
      .toBe(true);

    const applied = await page
      .getByTestId("reader-content")
      .evaluate((node) => getComputedStyle(node).fontFamily);
    expect(applied).toContain("UKIJ Tuz Kitab");
  });

  test("Traditional Arabic is offered but never downloaded from us", async ({ page }) => {
    const fontRequests: string[] = [];
    page.on("request", (request) => {
      if (request.resourceType() === "font") fontRequests.push(new URL(request.url()).pathname);
    });

    await page.goto(`/books/${seededBookId()}/read`);
    await page.getByTestId("panel-toggle").click();
    await page.getByRole("tab", { name: "تەڭشەك" }).click();
    await page.getByTestId("font-family").selectOption("trad");
    await page.waitForTimeout(600);

    for (const path of fontRequests) {
      expect(path, "no request may fetch a font we are not licensed to serve").not.toMatch(
        /trad-arabic|Bahij/i,
      );
    }
    // And everything we DO serve is woff2 or the untouched Quran OTFs.
    for (const path of fontRequests) {
      expect(path).toMatch(/\.(woff2|otf)$/);
    }
  });

  test("a reader who had the removed font stored still gets a working reader", async ({ page }) => {
    // Exactly what such a reader's browser holds today.
    await page.addInitScript(
      ([key]) => {
        window.localStorage.setItem(
          key,
          JSON.stringify({ fontSize: 24, lineHeight: 2.4, font: "bahij" }),
        );
      },
      [READER_SETTINGS_KEY] as const,
    );

    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));

    await page.goto(`/books/${seededBookId()}/read`);
    await expect(page.getByTestId("reader-content")).toBeVisible();
    expect(errors, "a stored font that no longer exists must not throw").toEqual([]);

    await page.getByTestId("panel-toggle").click();
    await page.getByRole("tab", { name: "تەڭشەك" }).click();
    // Migrated to the default, with their other choices untouched.
    await expect(page.getByTestId("font-family")).toHaveValue("ukij");
    const size = await page
      .getByTestId("reader-content")
      .evaluate((node) => getComputedStyle(node).fontSize);
    expect(size).toBe("24px");
  });
});

/* ── Getting back in ─────────────────────────────────────────────────────── */

test.describe("password recovery", () => {
  test("the sign-in page offers a way back in", async ({ page }) => {
    await page.goto("/login");
    const link = page.getByTestId("forgot-password-link");
    await expect(link).toBeVisible();
    await link.click();
    await expect(page.getByRole("heading", { name: "پارولنى ئۇنتۇدىڭىزمۇ؟" })).toBeVisible();
    await assertNoHorizontalOverflow(page);
  });

  test("submitting an address shows the same neutral answer either way", async ({ page }) => {
    test.skip(!hasStaffTestEnv(), "Supabase env not configured");

    /**
     * The limiter buckets by caller address, and every request Playwright
     * makes to a local dev server carries none — so all three viewports and
     * every re-run share one bucket of four per hour, and the fifth run would
     * be turned away for a reason that has nothing to do with this test. A
     * documentation-range address per run keeps the real limiter in the path
     * and the test repeatable.
     */
    const caller = `203.0.113.${1 + Math.floor(Math.random() * 250)}`;
    await page.setExtraHTTPHeaders({ "x-forwarded-for": caller });

    await page.goto("/forgot-password");
    // An address that certainly has no account here — so nothing is actually
    // sent, and the free tier's email allowance is not spent on a test.
    await page.getByTestId("reset-email").fill(`bh-e2e-nobody-${Date.now()}@mailinator.com`);
    await page.getByTestId("reset-submit").click();

    const notice = page.getByTestId("reset-sent");
    await expect(notice).toBeVisible({ timeout: 20_000 });
    // It must not say whether the address exists — "IF this address has an
    // account" is the whole point of the wording.
    await expect(notice).toContainText("ئەگەر");
    await expect(page.getByTestId("reset-error")).toHaveCount(0);
    await assertNoHorizontalOverflow(page);
  });

  test("a burst of requests from one address is turned away", async ({ page }) => {
    test.skip(!hasStaffTestEnv(), "Supabase env not configured");

    // Its own bucket, so this test's burst cannot spill into the one above.
    await page.setExtraHTTPHeaders({
      "x-forwarded-for": `198.51.100.${1 + Math.floor(Math.random() * 250)}`,
    });

    // PASSWORD_RESET_RULE allows four an hour; the fifth must be refused.
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      await page.goto("/forgot-password");
      await page.getByTestId("reset-email").fill(`bh-e2e-burst-${attempt}@mailinator.com`);
      await page.getByTestId("reset-submit").click();
      await expect(page.getByTestId("reset-sent").or(page.getByTestId("reset-error"))).toBeVisible({
        timeout: 20_000,
      });
    }
    await expect(page.getByTestId("reset-error")).toBeVisible();
    await expect(page.getByTestId("reset-sent")).toHaveCount(0);
  });

  test("the new-password form refuses a visitor who has no recovery link", async ({ page }) => {
    await page.goto("/reset-password");
    await expect(page.getByTestId("reset-link-invalid")).toBeVisible();
    await expect(page.getByTestId("new-password")).toHaveCount(0);
  });

  test("a real recovery link sets a new password and signs the reader in", async ({
    browser,
  }, testInfo) => {
    test.skip(!hasStaffTestEnv(), "Supabase env not configured");

    const admin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    const email = `bh-e2e-recover-${testInfo.project.name}@mailinator.com`;
    const oldPassword = "bh-e2e-password-1001";
    const newPassword = "bh-e2e-password-2002";

    const { data: existing } = await admin.auth.admin.listUsers({ perPage: 200 });
    for (const user of existing?.users ?? []) {
      if (user.email === email) await admin.auth.admin.deleteUser(user.id);
    }
    const { data: created, error } = await admin.auth.admin.createUser({
      email,
      password: oldPassword,
      email_confirm: true,
    });
    if (error || !created.user) throw new Error(`could not create test user: ${error?.message}`);
    const userId = created.user.id;

    /**
     * generateLink mints exactly the token the recovery email would carry, and
     * sends nothing — so the whole flow is exercised end to end without
     * needing a mailbox, and without spending the free tier's email budget.
     */
    const { data: link, error: linkError } = await admin.auth.admin.generateLink({
      type: "recovery",
      email,
    });
    if (linkError || !link.properties?.hashed_token) {
      throw new Error(`could not mint a recovery link: ${linkError?.message}`);
    }

    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await page.goto(
        `/auth/confirm?token_hash=${link.properties.hashed_token}&type=recovery`,
      );
      // A recovery link exists to change a password, so it lands on that form.
      await expect(page).toHaveURL(/\/reset-password$/);
      await expect(page.getByTestId("new-password")).toBeVisible();

      // Mistyping the confirmation must not change anything.
      await page.getByTestId("new-password").fill(newPassword);
      await page.getByTestId("confirm-password").fill(`${newPassword}-typo`);
      await page.getByTestId("save-password").click();
      await expect(page.getByTestId("reset-error")).toBeVisible({ timeout: 20_000 });

      await page.getByTestId("new-password").fill(newPassword);
      await page.getByTestId("confirm-password").fill(newPassword);
      await page.getByTestId("save-password").click();

      // Already signed in with the new password — no second trip through login.
      await expect(page).toHaveURL(/\/my\/account/, { timeout: 30_000 });
      await expect(page.getByTestId("account-notice")).toBeVisible();
      await expect(page.getByTestId("account-email")).toHaveText(email);
    } finally {
      await context.close();
    }

    // And the new password is the one that works from now on.
    const anon = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
    const { error: oldStillWorks } = await anon.auth.signInWithPassword({
      email,
      password: oldPassword,
    });
    expect(oldStillWorks, "the old password must stop working").not.toBeNull();
    const { data: signedIn } = await anon.auth.signInWithPassword({
      email,
      password: newPassword,
    });
    expect(signedIn.user?.id).toBe(userId);

    await admin.auth.admin.deleteUser(userId);
  });
});

/* ── Taking your data with you, or removing it ───────────────────────────── */

test.describe("my account", () => {
  test.skip(!hasStaffTestEnv(), "Supabase env not configured");
  test.use({ storageState: STAFF_STATE_PATH });

  test("downloads an export containing this account's own data", async ({ page }) => {
    await page.goto("/my/account");
    await expect(page.getByTestId("account-email")).toBeVisible();

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByTestId("export-download").click(),
    ]);

    expect(download.suggestedFilename()).toMatch(/^bilim-hezinisi-\d{4}-\d{2}-\d{2}\.json$/);
    const path = await download.path();
    const payload = JSON.parse(readFileSync(path, "utf8")) as {
      account: { email: string };
      bookmarks: unknown[];
      note_documents: unknown[];
    };
    expect(payload.account.email).toBe(await page.getByTestId("account-email").innerText());
    // Every personal table has to be present, empty or not.
    for (const table of [
      "bookmarks",
      "book_notes",
      "reading_progress",
      "recent_reads",
      "quran_bookmarks",
      "note_documents",
    ]) {
      expect(payload, `the export must include ${table}`).toHaveProperty(table);
    }
  });

  test("deletion stays locked until the account's own email is typed", async ({ page }) => {
    await page.goto("/my/account");
    await page.getByTestId("delete-open").click();

    const submit = page.getByTestId("delete-submit");
    await expect(submit).toBeDisabled();

    await page.getByTestId("delete-confirm-email").fill("somebody-else@example.com");
    await expect(submit).toBeDisabled();

    const email = await page.getByTestId("account-email").innerText();
    await page.getByTestId("delete-confirm-email").fill(email);
    await expect(submit).toBeEnabled();

    // Backing out must leave the account alone.
    await page.getByTestId("delete-cancel").click();
    await expect(page.getByTestId("delete-open")).toBeVisible();
    await page.reload();
    await expect(page.getByTestId("account-email")).toHaveText(email);

    await assertNoHorizontalOverflow(page);
  });

  test("the server refuses a mismatched email even when the button is bypassed", async ({
    page,
  }) => {
    await page.goto("/my/account");
    await page.getByTestId("delete-open").click();

    // A disabled button is a suggestion; the action is the actual gate.
    await page.getByTestId("delete-confirm-email").fill("somebody-else@example.com");
    await page.evaluate(() => {
      const button = document.querySelector<HTMLButtonElement>('[data-testid="delete-submit"]');
      if (button) button.disabled = false;
    });
    await page.getByTestId("delete-submit").click();

    await expect(page.getByTestId("account-error")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("account-email")).toBeVisible();
  });
});

/* ── The deletion itself, on an account created for the purpose ──────────── */

test.describe("deleting an account", () => {
  test.skip(!hasStaffTestEnv(), "Supabase env not configured");

  test("removes the auth user and every row belonging to them", async ({ browser }, testInfo) => {
    const admin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    // One throwaway account per project, so the three viewports never collide.
    const email = `bh-e2e-delete-${testInfo.project.name}@mailinator.com`;
    const password = "bh-e2e-password-9931";

    const { data: existing } = await admin.auth.admin.listUsers({ perPage: 200 });
    for (const user of existing?.users ?? []) {
      if (user.email === email) await admin.auth.admin.deleteUser(user.id);
    }
    const { data: created, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (error || !created.user) throw new Error(`could not create test user: ${error?.message}`);
    const userId = created.user.id;

    // Give them something to lose.
    const seed = readSeed();
    if (seed) {
      await admin
        .from("bookmarks")
        .insert({ user_id: userId, book_id: seed.bookId, page_no: 1, position: 0 });
      await admin
        .from("reading_progress")
        .insert({ user_id: userId, book_id: seed.bookId, page_no: 1, position: 0 });
    }
    await admin.from("quran_bookmarks").insert({ user_id: userId, sura: 1, aya: 1 });
    await admin
      .from("note_documents")
      .insert({ user_id: userId, title: "سىناق خاتىرە", content_html: "<p>سىناق</p>", content_text: "سىناق" });

    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await page.goto("/login");
      await page.locator('input[name="email"]').fill(email);
      await page.locator('input[name="password"]').fill(password);
      await page.getByRole("button", { name: "كىرىش" }).click();
      await expect(page.getByTestId("account-link")).toBeVisible({ timeout: 20_000 });

      await page.goto("/my/account");
      await page.getByTestId("delete-open").click();
      await page.getByTestId("delete-confirm-email").fill(email);
      await page.getByTestId("delete-submit").click();

      // Signed out, told what happened, and the library still readable.
      await expect(page.getByTestId("account-deleted")).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId("login-link")).toBeVisible();
    } finally {
      await context.close();
    }

    // Nothing of theirs may survive — checked with the service role, which RLS
    // does not hide anything from.
    for (const table of [
      "bookmarks",
      "book_notes",
      "reading_progress",
      "recent_reads",
      "quran_bookmarks",
      "note_documents",
      "ai_usage",
    ] as const) {
      const { count, error: countError } = await admin
        .from(table)
        .select("user_id", { count: "exact", head: true })
        .eq("user_id", userId);
      expect(countError, `${table} must be readable`).toBeNull();
      expect(count ?? 0, `${table} must hold nothing of theirs`).toBe(0);
    }

    const { count: profileCount } = await admin
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .eq("id", userId);
    expect(profileCount ?? 0, "the profile must be gone").toBe(0);

    const { data: after } = await admin.auth.admin.listUsers({ perPage: 200 });
    expect(
      (after?.users ?? []).some((user) => user.id === userId),
      "the auth user must be gone",
    ).toBe(false);
  });
});

/* ── Security headers ────────────────────────────────────────────────────── */

test.describe("security headers", () => {
  test("every page carries the policy, and the console stays clean", async ({ page }) => {
    const violations: string[] = [];
    page.on("console", (message) => {
      const text = message.text();
      if (/Content Security Policy|Refused to/i.test(text)) violations.push(text);
    });

    const response = await page.goto("/");
    const headers = response!.headers();

    const csp = headers["content-security-policy"];
    expect(csp, "the policy must be enforcing, not report-only").toBeTruthy();
    expect(headers["content-security-policy-report-only"]).toBeUndefined();
    expect(csp).toContain("default-src 'self'");
    expect(csp).toMatch(/script-src [^;]*'nonce-[a-f0-9]+'/);
    // The whole point: scripts must not fall back to blanket unsafe-inline.
    expect(csp.match(/script-src[^;]*/)?.[0]).not.toContain("'unsafe-inline'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("frame-ancestors 'self'");
    expect(csp).toContain("font-src 'self'");

    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect(headers["permissions-policy"]).toContain("camera=()");
    expect(headers["x-frame-options"]).toBe("SAMEORIGIN");

    expect(violations, "the home page must raise no CSP violation").toEqual([]);
  });

  test("a fresh nonce is minted per request", async ({ page }) => {
    const first = (await page.goto("/"))!.headers()["content-security-policy"];
    const second = (await page.goto("/about"))!.headers()["content-security-policy"];
    const nonceOf = (value: string) => value.match(/'nonce-([a-f0-9]+)'/)?.[1];
    expect(nonceOf(first)).toBeTruthy();
    expect(nonceOf(second)).toBeTruthy();
    expect(nonceOf(first)).not.toBe(nonceOf(second));
  });

  test("the reader, the Qur'an and the auth pages raise no violation", async ({ page }) => {
    const violations: string[] = [];
    page.on("console", (message) => {
      const text = message.text();
      if (/Content Security Policy|Refused to/i.test(text)) violations.push(`${text}`);
    });

    for (const path of ["/quran", "/quran/1", "/search?q=كىتاب", "/login", "/forgot-password", "/privacy"]) {
      await page.goto(path);
      await page.waitForLoadState("domcontentloaded");
    }

    const seed = readSeed();
    if (seed) {
      await page.goto(`/books/${seed.bookId}`);
      await page.goto(`/books/${seed.bookId}/read`);
      await page.waitForTimeout(600);
    }

    expect(violations).toEqual([]);
  });
});
