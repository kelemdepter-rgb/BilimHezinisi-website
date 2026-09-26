import { test, expect, type Browser, type Page } from "@playwright/test";
import { randomInt } from "node:crypto";
import {
  BLOCKED_MESSAGE,
  BOT_MESSAGE,
  DISPOSABLE_MESSAGE,
  PAUSED_MESSAGE,
  RESENT_MESSAGE,
} from "../lib/auth/messages";
import { MOCK_ANON_KEY, MOCK_SUPABASE_URL, freshPassword } from "./env";
import {
  assertNoHorizontalOverflow,
  assertTappable,
  blurUntilSuggested,
  fillRegistration,
  formTokenAged,
  register,
  registerButton,
  signIn,
  submit,
  waitForFormAge,
} from "./fixtures/auth-pages";
import { SupabaseMock } from "./fixtures/supabase-mock";

/**
 * Fake accounts and repeated email triggering (PROMPT-39): the form-bot
 * checks, the throwaway-address list, the Before User Created hook, the
 * owner's pause switch, the automatic brake and the /admin security card.
 *
 * Against the same FAKE Supabase as auth-flows.spec.ts, on the same :3300
 * server — never the real project. The fake runs the real hook, brake and
 * card SQL (migration 0027 and the domain seed) in PGlite, so what refuses a
 * sign-up here is the SQL that will refuse it in production.
 */

const mock = new SupabaseMock();

/** ADMIN_EMAIL of the :3300 server (playwright.config.ts). */
const ADMIN = "bh-e2e-admin@example.com";

test.beforeAll(async () => {
  await mock.start();
});

test.afterAll(async () => {
  await mock.stop();
});

/** A new person on a new connection, as in auth-flows.spec.ts. */
function visitorAddress(): string {
  return `198.19.${randomInt(1, 255)}.${randomInt(1, 255)}`;
}

test.beforeEach(async ({ page }) => {
  await mock.reset();
  await page.setExtraHTTPHeaders({ "x-forwarded-for": visitorAddress() });
});

/** Another visitor, on another device. */
async function stranger(browser: Browser): Promise<Page> {
  const context = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": visitorAddress() } });
  return context.newPage();
}

/** Sign the owner in and open /admin, where the security card is. */
async function openAdmin(page: Page): Promise<void> {
  const password = freshPassword();
  await mock.addUser(ADMIN, password, true, "admin");
  await signIn(page, ADMIN, password);
  await expect(page).toHaveURL(/localhost:3300\/$/, { timeout: 15_000 });
  await page.goto("/admin");
  await expect(page.getByTestId("security-card")).toBeVisible({ timeout: 20_000 });
}

/** Put a value into the honeypot, as a form-filling bot does. */
async function fillHoneypot(page: Page) {
  await page.locator('input[name="bh_note"]').first().evaluate((input) => {
    (input as HTMLInputElement).value = "https://spam.example/offer";
  });
}

/** Swap the form's timestamp for another, as a bot replaying a form would. */
async function setFormToken(page: Page, token: string) {
  await page.locator('input[name="bh_ts"]').first().evaluate((input, value) => {
    (input as HTMLInputElement).value = value;
  }, token);
}

/* ── form bots ────────────────────────────────────────────────────────────── */

test.describe("form bots", () => {
  test("a person never meets the honeypot: not seen, not in the tab order, not read aloud", async ({ page }) => {
    await page.goto("/register");
    const trap = page.locator('input[name="bh_note"]');
    await expect(trap).toHaveAttribute("tabindex", "-1");
    await expect(trap).toHaveAttribute("autocomplete", "off");
    // Clipped to a single pixel by its wrapper: nothing of it is painted, and
    // a tap at its middle reaches something else.
    const wrapper = page.locator('div[aria-hidden="true"]:has(> label > input[name="bh_note"])');
    const box = (await wrapper.boundingBox())!;
    expect(box.width <= 1 && box.height <= 1, "the honeypot's wrapper is a single pixel").toBe(true);
    const tappable = await trap.evaluate((input) => {
      const rect = input.getBoundingClientRect();
      return document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2) === input;
    });
    expect(tappable, "a tap never reaches the honeypot").toBe(false);
    await expect(page.getByRole("textbox", { name: "بۇ رامكىنى بوش قالدۇرۇڭ" })).toHaveCount(0);

    // Tabbing through the whole form never lands on it.
    await page.locator('input[name="display_name"]').focus();
    for (let step = 0; step < 8; step += 1) {
      expect(await page.evaluate(() => document.activeElement?.getAttribute("name"))).not.toBe("bh_note");
      await page.keyboard.press("Tab");
    }
    await assertNoHorizontalOverflow(page);
  });

  test("a filled honeypot gets the generic answer, reaches nothing, and counts", async ({ page }) => {
    await page.goto("/register");
    await fillRegistration(page, "reader@gmail.com");
    await fillHoneypot(page);
    await waitForFormAge(page);
    await submit(page, registerButton(page));
    await expect(page.getByTestId("auth-error-text")).toHaveText(BOT_MESSAGE);
    expect(mock.callsTo("signup")).toHaveLength(0);
    expect(await mock.counterRows(), "one failed attempt").toBe(2);
  });

  test("a form sent the instant it was made is asked again — never counted — and the second press goes through", async ({
    page,
  }) => {
    await page.goto("/register");
    await fillRegistration(page, "quick@gmail.com");
    await setFormToken(page, formTokenAged(0));
    await submit(page, registerButton(page));
    await expect(page.getByTestId("auth-error-text")).toHaveText(BOT_MESSAGE);
    expect(mock.callsTo("signup")).toHaveLength(0);
    expect(await mock.counterRows()).toBe(0);

    // What was typed came back, bar the password.
    await expect(page.getByTestId("register-email")).toHaveValue("quick@gmail.com");
    await page.locator('input[name="password"]').fill(freshPassword());
    await waitForFormAge(page);
    await submit(page, registerButton(page));
    await expect(page).toHaveURL(/\/login\?uqtur=confirm/, { timeout: 15_000 });
    expect(mock.callsTo("signup")).toHaveLength(1);
  });

  test("a page kept for hours, or a forged timestamp, is asked again", async ({ page }) => {
    for (const token of [formTokenAged(3 * 60 * 60 * 1000), "1790000000000.forged"]) {
      await page.goto("/register");
      await fillRegistration(page, "late@gmail.com");
      await setFormToken(page, token);
      await submit(page, registerButton(page));
      await expect(page.getByTestId("auth-error-text")).toHaveText(BOT_MESSAGE);
    }
    expect(mock.callsTo("signup")).toHaveLength(0);
    expect(await mock.counterRows()).toBe(0);
  });

  test("the forgot-password form and the resend button are guarded too — signing in is not", async ({ page }) => {
    await page.goto("/forgot-password");
    await page.getByTestId("reset-email").fill("reader@gmail.com");
    await fillHoneypot(page);
    await waitForFormAge(page);
    await page.getByTestId("reset-submit").click();
    await expect(page.getByTestId("reset-error")).toHaveText(BOT_MESSAGE);
    expect(mock.callsTo("recover")).toHaveLength(0);

    await page.goto("/login?uqtur=confirm");
    await page.getByTestId("resend-email").fill("reader@gmail.com");
    await fillHoneypot(page);
    await waitForFormAge(page);
    await page.getByTestId("resend-submit").click();
    await expect(page.getByTestId("auth-error-text")).toHaveText(BOT_MESSAGE);
    // The button is still offered, for the person this was not.
    await expect(page.getByTestId("resend-submit")).toBeVisible();
    expect(mock.callsTo("resend")).toHaveLength(0);
    expect(await mock.counterRows()).toBe(0);

    await expect(page.locator('form:has(input[name="password"]) input[name="bh_ts"]')).toHaveCount(0);
    await expect(page.locator('form:has(input[name="password"]) input[name="bh_note"]')).toHaveCount(0);
  });
});

/* ── throwaway addresses ─────────────────────────────────────────────────── */

test.describe("throwaway addresses", () => {
  test("are refused on registration in their own words, before anything is sent, and counted", async ({ page }) => {
    await register(page, "someone@guerrillamail.com");
    await expect(page.getByTestId("auth-error-text")).toHaveText(DISPOSABLE_MESSAGE);
    expect(mock.callsTo("signup")).toHaveLength(0);
    expect(await mock.counterRows()).toBe(2);
    await assertNoHorizontalOverflow(page);
  });

  test("a typo that is on the list is offered the fix first; only keeping it is refused", async ({ page }) => {
    await page.goto("/register");
    await fillRegistration(page, "name@gmial.com");
    await blurUntilSuggested(page);
    await page.getByTestId("suggestion-keep").click();
    await expect(page.getByTestId("email-suggestion")).toHaveCount(0);
    const password = page.locator('input[name="password"]');
    if (!(await password.inputValue())) await password.fill(freshPassword());
    await waitForFormAge(page);
    await submit(page, registerButton(page));
    await expect(page.getByTestId("auth-error-text")).toHaveText(DISPOSABLE_MESSAGE);
    expect(mock.callsTo("signup")).toHaveLength(0);
  });

  test("are refused by the resend button, and never counted", async ({ page }) => {
    await page.goto("/login?uqtur=confirm");
    await page.getByTestId("resend-email").fill("someone@guerrillamail.com");
    await waitForFormAge(page);
    await page.getByTestId("resend-submit").click();
    await expect(page.getByTestId("auth-error-text")).toHaveText(DISPOSABLE_MESSAGE);
    expect(mock.callsTo("resend")).toHaveLength(0);
    expect(await mock.counterRows()).toBe(0);
  });

  test("never stand between an existing account and signing in or recovering it", async ({ page }) => {
    const password = freshPassword();
    await mock.addUser("older@guerrillamail.com", password);
    await signIn(page, "older@guerrillamail.com", password);
    await expect(page).toHaveURL(/localhost:3300\/$/, { timeout: 15_000 });

    await page.context().clearCookies();
    await page.goto("/forgot-password");
    await page.getByTestId("reset-email").fill("older@guerrillamail.com");
    await waitForFormAge(page);
    await page.getByTestId("reset-submit").click();
    await expect(page.getByTestId("reset-sent")).toBeVisible();
    expect(mock.callsTo("recover")).toHaveLength(1);
  });
});

/* ── the database's own refusals ─────────────────────────────────────────── */

test.describe("the Before User Created hook", () => {
  /**
   * The site's lists and the database's are kept equal by
   * scripts/sync-auth-domains.mjs; here they are made to differ on purpose,
   * so the site lets an address through and the database refuses it — which
   * is all a sign-up that skips the site ever meets.
   */
  test("refuses what the site let through, and the reader is told why", async ({ page }) => {
    await mock.sql("insert into public.auth_disposable_domains (domain) values ('company.test')");
    await register(page, "teacher@company.test");
    await expect(page.getByTestId("auth-error-text")).toHaveText(DISPOSABLE_MESSAGE);
    expect(mock.callsTo("signup"), "it reached Supabase — and Supabase refused it").toHaveLength(1);
    expect(await mock.accountCount(), "no account was made").toBe(0);
    expect(await mock.counterRows()).toBe(2);

    await mock.sql("delete from public.auth_disposable_domains where domain = 'company.test'");
    await mock.sql("insert into public.auth_blocked_domains (domain) values ('company.test')");
    await register(page, "teacher@company.test");
    await expect(page.getByTestId("auth-error-text")).toHaveText(BLOCKED_MESSAGE);
    expect(await mock.accountCount()).toBe(0);
  });

  test("refuses a sign-up sent straight to Supabase, skipping the site", async () => {
    const signUp = (email: string) =>
      fetch(`${MOCK_SUPABASE_URL}/auth/v1/signup`, {
        method: "POST",
        headers: { apikey: MOCK_ANON_KEY, authorization: `Bearer ${MOCK_ANON_KEY}`, "content-type": "application/json" },
        body: JSON.stringify({ email, password: freshPassword() }),
      });
    for (const [email, message] of [
      ["a@guerrillamail.com", "bh:disposable"],
      ["a@qq.com", "bh:blocked"],
      ["a@school.edu.cn", "bh:blocked"],
    ] as const) {
      const response = await signUp(email);
      expect(response.status, email).toBe(400);
      expect(((await response.json()) as { msg?: string }).msg, email).toBe(message);
    }
    expect(await mock.accountCount()).toBe(0);
    expect((await signUp("welcome@gmail.com")).status).toBe(200);
    expect(await mock.accountCount()).toBe(1);
  });
});

/* ── pausing registration ────────────────────────────────────────────────── */

test.describe("pausing registration", () => {
  test("the owner pauses in two taps; newcomers are told, everyone else carries on; one tap reopens", async ({
    page,
    browser,
  }) => {
    const dialogs: string[] = [];
    page.on("dialog", async (dialog) => {
      dialogs.push(dialog.message());
      await dialog.dismiss();
    });

    // Someone who registered just before the pause, and a reader of old.
    const visitor = await stranger(browser);
    await register(visitor, "early@gmail.com");
    await expect(visitor).toHaveURL(/\/login\?uqtur=confirm/, { timeout: 15_000 });
    const readerPassword = freshPassword();
    await mock.addUser("reader@gmail.com", readerPassword);

    await openAdmin(page);
    await expect(page.getByTestId("registration-state")).toHaveText("يېڭى تىزىملىتىش ئوچۇق.");
    await page.getByTestId("pause-registration").click();
    await expect(page.getByTestId("pause-confirm-box")).toBeVisible();
    await assertTappable(page, page.getByTestId("pause-confirm"), "«ھەئە، توختىتىش»");
    await assertTappable(page, page.getByTestId("pause-cancel"), "«ياق»");
    await page.getByTestId("pause-cancel").click();
    await expect(page.getByTestId("pause-confirm-box")).toHaveCount(0);
    expect(await mock.setting("registration_paused"), "one tap changes nothing").toBe(false);

    await page.getByTestId("pause-registration").click();
    await page.getByTestId("pause-confirm").click();
    await expect(page.getByTestId("registration-state")).toContainText("توختىتىلغان");
    await expect(page.getByTestId("resume-registration")).toBeVisible();
    expect(await mock.setting("registration_paused")).toBe(true);

    // A newcomer sees the notice and no form.
    const newcomer = await stranger(browser);
    await newcomer.goto("/register");
    await expect(newcomer.getByTestId("registration-paused")).toHaveText(PAUSED_MESSAGE);
    await expect(newcomer.locator('input[name="password"]')).toHaveCount(0);
    await expect(newcomer.getByRole("link", { name: "كىرىڭ" })).toBeVisible();
    await assertNoHorizontalOverflow(newcomer);

    // …and asking for another confirmation email is refused too.
    await newcomer.goto("/login?uqtur=confirm");
    await newcomer.getByTestId("resend-email").fill("early@gmail.com");
    await waitForFormAge(newcomer);
    await newcomer.getByTestId("resend-submit").click();
    await expect(newcomer.getByTestId("auth-error-text")).toHaveText(PAUSED_MESSAGE);
    expect(mock.callsTo("resend")).toHaveLength(0);

    // Reading and search need no account and never looked at the switch.
    for (const path of ["/", "/search?q=%DA%A9%D9%89%D8%AA%D8%A7%D8%A8"]) {
      const response = await newcomer.goto(path);
      expect(response?.status(), path).toBe(200);
    }

    // The one who registered before the pause can still confirm, and is signed in.
    await visitor.goto(mock.confirmationLink("early@gmail.com"));
    await expect(visitor).toHaveURL(/localhost:3300\/$/, { timeout: 15_000 });

    // An existing reader signs in.
    const reader = await stranger(browser);
    await signIn(reader, "reader@gmail.com", readerPassword);
    await expect(reader).toHaveURL(/localhost:3300\/$/, { timeout: 15_000 });

    // And a forgotten password is recovered, start to finish.
    const forgetful = await stranger(browser);
    await forgetful.goto("/forgot-password");
    await forgetful.getByTestId("reset-email").fill("reader@gmail.com");
    await waitForFormAge(forgetful);
    await forgetful.getByTestId("reset-submit").click();
    await expect(forgetful.getByTestId("reset-sent")).toBeVisible();
    await forgetful.goto(mock.recoveryLink("reader@gmail.com"));
    await expect(forgetful).toHaveURL(/\/reset-password$/);
    const newPassword = freshPassword();
    await forgetful.getByTestId("new-password").fill(newPassword);
    await forgetful.getByTestId("confirm-password").fill(newPassword);
    await forgetful.getByTestId("save-password").click();
    await expect(forgetful).toHaveURL(/\/my\/account/, { timeout: 30_000 });
    expect(mock.passwordOf("reader@gmail.com")).toBe(newPassword);

    // One tap reopens.
    await page.getByTestId("resume-registration").click();
    await expect(page.getByTestId("registration-state")).toHaveText("يېڭى تىزىملىتىش ئوچۇق.");
    expect(await mock.setting("registration_paused")).toBe(false);
    await newcomer.goto("/register");
    await expect(newcomer.getByTestId("register-email")).toBeVisible();
    expect(dialogs, "no native confirm() anywhere").toEqual([]);
  });

  test("a form left open from before the pause is refused, and so is a sign-up that skips the site", async ({
    page,
  }) => {
    await page.goto("/register");
    await fillRegistration(page, "stale-form@gmail.com");
    await mock.setSetting("registration_paused", true, true);
    await waitForFormAge(page);
    await submit(page, registerButton(page));
    await expect(page.getByTestId("registration-paused")).toHaveText(PAUSED_MESSAGE);
    expect(mock.callsTo("signup")).toHaveLength(0);
    expect(await mock.counterRows()).toBe(0);

    const direct = await fetch(`${MOCK_SUPABASE_URL}/auth/v1/signup`, {
      method: "POST",
      headers: { apikey: MOCK_ANON_KEY, "content-type": "application/json" },
      body: JSON.stringify({ email: "direct@gmail.com", password: freshPassword() }),
    });
    expect(direct.status).toBe(400);
    expect(((await direct.json()) as { msg?: string }).msg).toBe("bh:registration_paused");
    expect(await mock.accountCount()).toBe(0);
  });
});

/* ── the automatic brake ─────────────────────────────────────────────────── */

test.describe("the automatic brake", () => {
  test("30 unconfirmed sign-ups in an hour close the door by themselves, and it reopens as they age", async ({
    page,
    browser,
  }) => {
    await mock.addUnconfirmedSignups(30);

    const newcomer = await stranger(browser);
    await register(newcomer, "during@gmail.com");
    await expect(newcomer.getByTestId("auth-error-text")).toHaveText(PAUSED_MESSAGE);
    expect(await mock.accountCount(), "no account was made").toBe(30);
    expect(await mock.counterRows(), "a pause is not the reader's failure").toBe(0);

    await openAdmin(page);
    await expect(page.getByTestId("brake-state")).toHaveText(
      "ئاپتوماتىك تورمۇز: ھازىر ئىشلەۋاتىدۇ (ئاخىرقى 1 سائەتتە 30 يېڭى ھېسابات)",
    );
    await expect(page.getByTestId("new-accounts")).toContainText("ئاخىرقى 1 سائەتتە 31");
    // The brake is computed, never written: the owner's switch is untouched.
    await expect(page.getByTestId("registration-state")).toHaveText("يېڭى تىزىملىتىش ئوچۇق.");
    expect(await mock.setting("registration_paused")).toBe(false);

    // An hour on, the same count has aged out.
    await mock.age(61);
    await register(newcomer, "after@gmail.com");
    await expect(newcomer).toHaveURL(/\/login\?uqtur=confirm/, { timeout: 15_000 });
    await page.reload();
    await expect(page.getByTestId("brake-state")).toHaveText("ئاپتوماتىك تورمۇز: ئىشلىمىدى");
  });
});

/* ── the /admin security card ────────────────────────────────────────────── */

test.describe("the security card", () => {
  test("is the admin's alone: an uploader does not see it, a reader never reaches /admin", async ({ page, browser }) => {
    const password = freshPassword();
    await mock.addUser("bh-e2e-uploader@example.com", password, true, "uploader");
    await signIn(page, "bh-e2e-uploader@example.com", password);
    await expect(page).toHaveURL(/localhost:3300\/$/, { timeout: 15_000 });
    await page.goto("/admin");
    await expect(page.getByRole("heading", { name: "باشقۇرۇش سۇپىسى" })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("security-card")).toHaveCount(0);
    await expect(page.getByTestId("security-card-unavailable")).toHaveCount(0);

    const reader = await stranger(browser);
    await mock.addUser("bh-e2e-reader@example.com", password);
    await signIn(reader, "bh-e2e-reader@example.com", password);
    await expect(reader).toHaveURL(/localhost:3300\/$/, { timeout: 15_000 });
    await reader.goto("/admin");
    await expect(reader).toHaveURL(/localhost:3300\/$/);
  });

  test("the sweep takes two taps to switch on, one to switch off, and deletes nothing by itself", async ({ page }) => {
    await mock.addUnconfirmedSignups(2, 8 * 24 * 60);
    await openAdmin(page);
    await expect(page.getByTestId("unconfirmed-line")).toHaveText(
      "جەزملەنمىگەن ھېساباتلار: 2 — ئاخىرقى تازىلاش: تېخى بولمىدى",
    );
    await expect(page.getByTestId("sweep-state")).toContainText("ئېتىك");
    await expect(page.getByTestId("sweep-state")).toContainText("2 تال");

    await page.getByTestId("sweep-start").click();
    await expect(page.getByTestId("sweep-confirm-box")).toBeVisible();
    await assertTappable(page, page.getByTestId("sweep-confirm"), "«ھەئە، ئېچىش»");
    await page.getByTestId("sweep-cancel").click();
    expect(await mock.setting("unconfirmed_sweep_enabled")).toBe(false);

    await page.getByTestId("sweep-start").click();
    await page.getByTestId("sweep-confirm").click();
    await expect(page.getByTestId("sweep-state")).toContainText("ھەر كۈنى ئۆچۈرۈلىدۇ");
    await expect(page.getByTestId("security-result")).toHaveText("ساقلاندى.");
    expect(await mock.setting("unconfirmed_sweep_enabled")).toBe(true);
    // Deleting is the daily cron's job, not the switch's.
    expect(await mock.accountCount()).toBe(3);

    await page.getByTestId("sweep-stop").click();
    await expect(page.getByTestId("sweep-state")).toContainText("ئېتىك");
    expect(await mock.setting("unconfirmed_sweep_enabled")).toBe(false);
  });

  test("fits the screen and every control can be tapped", async ({ page }) => {
    await openAdmin(page);
    const card = page.getByTestId("security-card");
    await expect(card).toContainText("Allow new users to sign up");
    await assertTappable(page, page.getByTestId("pause-registration"), "«يېڭى تىزىملىتىشنى ۋاقىتلىق توختىتىش»");
    await assertTappable(page, page.getByTestId("sweep-start"), "«ئاپتوماتىك ئۆچۈرۈشنى ئېچىش»");
    await page.getByTestId("pause-registration").click();
    await page.getByTestId("pause-confirm").click();
    await assertTappable(page, page.getByTestId("resume-registration"), "«تىزىملىتىشنى قايتا ئېچىش»");
    const box = (await card.boundingBox())!;
    expect(box.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  });
});

/* ── the resend notice still answers as before ───────────────────────────── */

test("an ordinary resend is unchanged by all of this", async ({ page }) => {
  await page.goto("/login?uqtur=confirm");
  await page.getByTestId("resend-email").fill("pending@gmail.com");
  await waitForFormAge(page);
  await page.getByTestId("resend-submit").click();
  await expect(page.getByTestId("auth-notice-text")).toHaveText(RESENT_MESSAGE);
  expect(mock.callsTo("resend").map((call) => call.body.email)).toEqual(["pending@gmail.com"]);
});
