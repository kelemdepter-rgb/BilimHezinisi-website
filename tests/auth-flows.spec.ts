import { test, expect } from "@playwright/test";
import { randomInt } from "node:crypto";
import {
  BLOCKED_MESSAGE,
  EMAIL_CAP_MESSAGE,
  LOCKED_MESSAGE,
  RESENT_MESSAGE,
  typoMessage,
  waitMessage,
} from "../lib/auth/messages";
import { freshPassword } from "./env";
import {
  assertNoHorizontalOverflow,
  assertTappable,
  blurUntilSuggested,
  fillRegistration,
  register,
  registerButton,
  signIn,
  submit,
  waitForFormAge,
} from "./fixtures/auth-pages";
import { SupabaseMock } from "./fixtures/supabase-mock";

/**
 * Registering and signing in (PROMPT-38): three chances then an hour's lock,
 * the Chinese-jurisdiction block, typo suggestions before any email is sent,
 * truthful waits, resending the confirmation, and password recovery that the
 * lock can never touch.
 *
 * Against a FAKE Supabase only (tests/fixtures/supabase-mock.ts), through the
 * dev server playwright.config.ts starts on :3300 for the auth-flow projects.
 * These tests lock people out, register strangers and ask for emails; none of
 * that may ever happen in the real project. The fake runs the real migration
 * 0026 for the counter, and records every Auth call, so "nothing reached
 * Supabase" is something a test can assert.
 *
 * DNS answers for the few test domains that need a lookup come from
 * tests/fixtures/dns-stub.mjs; the familiar providers (gmail.com, …) are
 * never looked up at all.
 *
 * Every form that sends email is also guarded against bots since PROMPT-39
 * (tests/signup-guards.spec.ts), and turns away a form sent back within
 * two seconds of its page being made; the specs here are people, so they
 * wait that out (waitForFormAge) before submitting one.
 */

const mock = new SupabaseMock();

test.beforeAll(async () => {
  await mock.start();
});

test.afterAll(async () => {
  await mock.stop();
});

/**
 * Every test is a new person on a new connection: a fresh fake, a fresh
 * browser context (so a fresh device cookie), and its own address, so neither
 * the counter nor the server's in-process burst brake carries anything over.
 * 198.18.0.0/15 is reserved for benchmarking and routes nowhere real.
 */
test.beforeEach(async ({ page }) => {
  await mock.reset();
  await page.setExtraHTTPHeaders({
    "x-forwarded-for": `198.19.${randomInt(1, 255)}.${randomInt(1, 255)}`,
  });
});

/* ── registering ──────────────────────────────────────────────────────────── */

test.describe("registering", () => {
  test("a slip in the domain is caught before anything is sent, and one tap fixes it", async ({
    page,
  }) => {
    await page.goto("/register");
    await fillRegistration(page, "name@gmial.com");
    await blurUntilSuggested(page);
    await expect(page.getByTestId("email-suggestion-text")).toHaveText(
      typoMessage("gmial.com", "gmail.com"),
    );
    await assertTappable(page, page.getByTestId("suggestion-accept"), "the «use it» button");
    await assertTappable(page, page.getByTestId("suggestion-keep"), "the «keep it» button");

    await page.getByTestId("suggestion-accept").click();
    await expect(page.getByTestId("register-email")).toHaveValue("name@gmail.com");
    await expect(page.getByTestId("email-suggestion")).toHaveCount(0);
    expect(mock.callsTo("signup"), "nothing is sent while the reader decides").toHaveLength(0);

    await waitForFormAge(page);
    await submit(page, registerButton(page));
    await expect(page).toHaveURL(/\/login\?uqtur=confirm/, { timeout: 15_000 });
    await expect(page.getByTestId("sent-to")).toHaveText("name@gmail.com");
    expect(mock.callsTo("signup").map((call) => call.body.email)).toEqual(["name@gmail.com"]);
  });

  test("keeping what was typed works too, and submitting waits for the choice", async ({ page }) => {
    await page.goto("/register");
    // outlok.com, not gmial.com: that one is on the throwaway list, and kept
    // it is refused (signup-guards.spec.ts).
    await fillRegistration(page, "name@outlok.com");
    await waitForFormAge(page);
    // Straight to the button, without leaving the field first.
    await expect(async () => {
      await registerButton(page).click();
      await expect(page.getByTestId("email-suggestion")).toBeVisible({ timeout: 1500 });
    }).toPass({ timeout: 20_000 });
    expect(mock.callsTo("signup")).toHaveLength(0);

    await page.getByTestId("suggestion-keep").click();
    await expect(page.getByTestId("email-suggestion")).toHaveCount(0);
    // The server may have re-rendered the form on the way (no password kept).
    const password = page.locator('input[name="password"]');
    if (!(await password.inputValue())) await password.fill(freshPassword());
    await waitForFormAge(page);
    await submit(page, registerButton(page));

    await expect(page).toHaveURL(/\/login\?uqtur=confirm/, { timeout: 15_000 });
    await expect(page.getByTestId("sent-to")).toHaveText("name@outlok.com");
    expect(mock.callsTo("signup").map((call) => call.body.email)).toEqual(["name@outlok.com"]);
  });

  for (const address of ["a@qq.com", "a@x.com.cn"]) {
    test(`${address} is refused in the owner's words, and never sent`, async ({ page }) => {
      await page.goto("/register");
      await fillRegistration(page, address);
      // Named as soon as the field is left…
      await expect(async () => {
        await page.getByTestId("register-email").focus();
        await page.getByTestId("register-email").blur();
        await expect(page.getByTestId("email-blocked")).toHaveText(BLOCKED_MESSAGE, { timeout: 1500 });
      }).toPass({ timeout: 20_000 });
      // …and refused by the server, which is the check that counts.
      await waitForFormAge(page);
      await submit(page, registerButton(page));
      await expect(page.getByTestId("auth-error-text")).toHaveText(BLOCKED_MESSAGE);
      expect(mock.callsTo("signup")).toHaveLength(0);
      await assertNoHorizontalOverflow(page);
    });
  }

  test("a company domain whose mail is received in the PRC is refused as well", async ({ page }) => {
    await register(page, "staff@exmail-customer.test");
    await expect(page.getByTestId("auth-error-text")).toHaveText(BLOCKED_MESSAGE);
    expect(mock.callsTo("signup")).toHaveLength(0);
  });

  test("a domain that does not exist is refused before an email is spent on it", async ({ page }) => {
    await register(page, "someone@no-such-domain.test");
    await expect(page.getByTestId("auth-error")).toContainText("قوبۇل قىلىنمىدى");
    expect(mock.callsTo("signup")).toHaveLength(0);
    // What was typed is still there; the password never comes back.
    await expect(page.getByTestId("register-email")).toHaveValue("someone@no-such-domain.test");
    await expect(page.locator('input[name="display_name"]')).toHaveValue("سىناق");
    await expect(page.locator('input[name="password"]')).toHaveValue("");
  });

  test("an unfamiliar but real domain is never questioned", async ({ page }) => {
    await page.goto("/register");
    await fillRegistration(page, "teacher@company.test");
    await page.getByTestId("register-email").blur();
    await waitForFormAge(page);
    await submit(page, registerButton(page));
    await expect(page).toHaveURL(/\/login\?uqtur=confirm/, { timeout: 15_000 });
    expect(mock.callsTo("signup")).toHaveLength(1);
  });

  test("the third failed attempt locks the form for an hour, and a fourth reaches nothing", async ({
    page,
  }) => {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      await register(page, "a@qq.com");
      await expect(page.getByTestId("auth-error-text")).toHaveText(
        attempt < 3 ? BLOCKED_MESSAGE : LOCKED_MESSAGE,
      );
    }
    const loginLink = page.getByTestId("locked-login-link");
    await assertTappable(page, loginLink, "the lock's link to sign in");

    // A perfectly good address now — and still nothing reaches Supabase.
    await register(page, "fresh@gmail.com");
    await expect(page.getByTestId("auth-error-text")).toHaveText(LOCKED_MESSAGE);
    expect(mock.callsTo("signup")).toHaveLength(0);

    await page.getByTestId("locked-login-link").click();
    await expect(page).toHaveURL(/\/login$/);
  });

  test("Supabase's own refusals count too: an address it calls invalid", async ({ page }) => {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      mock.failNext("signup", {
        status: 400,
        code: "email_address_invalid",
        message: 'Email address "x" is invalid',
      });
      await register(page, `person${attempt}@gmail.com`);
    }
    await expect(page.getByTestId("auth-error-text")).toHaveText(LOCKED_MESSAGE);
    expect(mock.callsTo("signup")).toHaveLength(3);
  });

  test("a suggestion, a wait, a rate limit and a server fault are not failed attempts", async ({
    page,
  }) => {
    await page.goto("/register");
    await fillRegistration(page, "name@gmial.com");
    await blurUntilSuggested(page);

    const notFailures = [
      {
        status: 429,
        code: "over_email_send_rate_limit",
        message: "For security purposes, you can only request this after 20 seconds.",
      },
      { status: 429, code: "over_request_rate_limit", message: "Request rate limit reached" },
      { status: 500, code: "unexpected_failure", message: "boom" },
      { status: 403, code: "email_address_not_authorized", message: "Email address not authorized" },
    ];
    for (const refusal of notFailures) {
      mock.failNext("signup", refusal);
      await register(page, "someone@gmail.com");
      await expect(page.getByTestId("auth-error-text")).not.toHaveText(LOCKED_MESSAGE);
    }
    expect(mock.callsTo("signup")).toHaveLength(notFailures.length);
    expect(await mock.counterRows()).toBe(0);
  });
});

/* ── signing in ───────────────────────────────────────────────────────────── */

test.describe("signing in", () => {
  test("three wrong passwords lock sign-in; recovery still works, and unlocks it", async ({ page }) => {
    const email = "reader@gmail.com";
    const oldPassword = freshPassword();
    const newPassword = freshPassword();
    await mock.addUser(email, oldPassword);

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      await signIn(page, email, `${oldPassword}-wrong`);
      await expect(page.getByTestId("auth-error-text")).toHaveText(
        attempt < 3 ? "ئېلخەت ياكى پارول خاتا. قايتا سىناڭ." : LOCKED_MESSAGE,
      );
    }
    const forgot = page.getByTestId("locked-forgot-link");
    await expect(forgot).toHaveText("پارولنى ئۇنتۇدىڭىزمۇ؟");
    await assertTappable(page, forgot, "the lock's «forgot your password?» link");

    // Even the right password is not tried while locked.
    await signIn(page, email, oldPassword);
    await expect(page.getByTestId("auth-error-text")).toHaveText(LOCKED_MESSAGE);
    expect(mock.callsTo("token")).toHaveLength(3);

    // The whole recovery path, inside the same hour.
    await page.getByTestId("locked-forgot-link").click();
    await expect(page).toHaveURL(/\/forgot-password$/);
    await page.getByTestId("reset-email").fill(email);
    await waitForFormAge(page);
    await page.getByTestId("reset-submit").click();
    await expect(page.getByTestId("reset-sent")).toBeVisible();
    expect(mock.callsTo("recover")).toHaveLength(1);

    await page.goto(mock.recoveryLink(email));
    await expect(page).toHaveURL(/\/reset-password$/);
    await page.getByTestId("new-password").fill(newPassword);
    await page.getByTestId("confirm-password").fill(newPassword);
    await page.getByTestId("save-password").click();
    await expect(page).toHaveURL(/\/my\/account/, { timeout: 30_000 });
    await expect(page.getByTestId("account-email")).toHaveText(email);
    expect(mock.passwordOf(email)).toBe(newPassword);

    // And the lock is gone for this person.
    await signIn(page, email, newPassword);
    await expect(page).toHaveURL(/localhost:3300\/$/);
  });

  test("an address under Chinese jurisdiction is refused at sign-in", async ({ page }) => {
    await signIn(page, "a@163.com", freshPassword());
    await expect(page.getByTestId("auth-error-text")).toHaveText(BLOCKED_MESSAGE);
    expect(mock.callsTo("token")).toHaveLength(0);
  });

  test("a success clears the count", async ({ page }) => {
    const email = "clear@gmail.com";
    const password = freshPassword();
    await mock.addUser(email, password);
    await signIn(page, email, `${password}-wrong`);
    await signIn(page, email, `${password}-wrong`);
    await signIn(page, email, password);
    await expect(page).toHaveURL(/localhost:3300\/$/);
    expect(await mock.counterRows(), "only the address-wide backstop row is left").toBe(1);
  });
});

/* ── password recovery ────────────────────────────────────────────────────── */

test.describe("password recovery", () => {
  test("answers the same whether or not the address has an account", async ({ page }) => {
    await mock.addUser("known@gmail.com", freshPassword());
    const answers: string[] = [];
    for (const email of ["known@gmail.com", "unknown@gmail.com"]) {
      await page.goto("/forgot-password");
      await page.getByTestId("reset-email").fill(email);
      await waitForFormAge(page);
      await page.getByTestId("reset-submit").click();
      await expect(page.getByTestId("reset-sent")).toBeVisible();
      answers.push(await page.getByTestId("reset-sent").innerText());
    }
    expect(answers[0]).toBe(answers[1]);
    expect(mock.callsTo("recover")).toHaveLength(2);
  });

  test("a second request within the minute gets the same answer as a stranger's address", async ({
    page,
  }) => {
    await mock.addUser("twice@gmail.com", freshPassword());
    // What Supabase says only for an address that HAS an account, asked twice.
    mock.failNext("recover", {
      status: 429,
      code: "over_email_send_rate_limit",
      message: "For security purposes, you can only request this after 52 seconds.",
    });
    await page.goto("/forgot-password");
    await page.getByTestId("reset-email").fill("twice@gmail.com");
    await waitForFormAge(page);
    await page.getByTestId("reset-submit").click();
    await expect(page.getByTestId("reset-sent")).toBeVisible();
    await expect(page.getByTestId("reset-error")).toHaveCount(0);
  });

  test("an address under Chinese jurisdiction is told the rule and sent nothing", async ({ page }) => {
    await page.goto("/forgot-password");
    await page.getByTestId("reset-email").fill("a@foxmail.com");
    await waitForFormAge(page);
    await page.getByTestId("reset-submit").click();
    await expect(page.getByTestId("reset-error")).toHaveText(BLOCKED_MESSAGE);
    expect(mock.callsTo("recover")).toHaveLength(0);
  });
});

/* ── waiting ──────────────────────────────────────────────────────────────── */

test.describe("waiting", () => {
  test("Supabase's per-address wait is shown as the seconds it is, not an hour", async ({ page }) => {
    mock.failNext("signup", {
      status: 429,
      code: "over_email_send_rate_limit",
      message: "For security purposes, you can only request this after 42 seconds.",
    });
    await register(page, "waiting@gmail.com");
    await expect(page.getByTestId("auth-error-text")).toHaveText(waitMessage(45));
    await expect(page.getByTestId("auth-error")).not.toContainText("سائەت");
  });

  test("the project-wide cap says so plainly, with no dashboard in it", async ({ page }) => {
    mock.failNext("signup", {
      status: 429,
      code: "over_email_send_rate_limit",
      message: "email rate limit exceeded",
    });
    await register(page, "capped@gmail.com");
    const error = page.getByTestId("auth-error");
    await expect(error).toHaveText(EMAIL_CAP_MESSAGE);
    await expect(error).not.toContainText("Supabase");
    await expect(error).not.toContainText("Confirm email");
  });
});

/* ── resending the confirmation ───────────────────────────────────────────── */

test.describe("resending the confirmation email", () => {
  test("the same answer with or without an account, and a minute's countdown", async ({
    page,
    browser,
  }) => {
    await register(page, "new@gmail.com");
    await expect(page.getByTestId("sent-to")).toHaveText("new@gmail.com");
    await assertTappable(page, page.getByTestId("reregister-link"), "«ئادرېس خاتا بولسا…»");
    await assertTappable(page, page.getByTestId("resend-submit"), "the resend button");

    await waitForFormAge(page);
    await page.getByTestId("resend-submit").click();
    await expect(page.getByTestId("auth-notice")).toContainText(RESENT_MESSAGE);
    const countdown = page.getByTestId("resend-countdown");
    await expect(countdown).toBeVisible();
    const seconds = Number((await countdown.innerText()).replace(/\D/g, ""));
    expect(seconds).toBeGreaterThan(40);
    expect(seconds).toBeLessThanOrEqual(60);
    await expect(page.getByTestId("resend-submit")).toBeDisabled();
    const resendBox = (await page.getByTestId("resend-submit").boundingBox())!;
    expect(resendBox.height).toBeGreaterThanOrEqual(44);
    await assertNoHorizontalOverflow(page);

    // Somebody else, on another device, for an address nobody registered.
    const stranger = await browser.newContext({
      extraHTTPHeaders: { "x-forwarded-for": `198.19.${randomInt(1, 255)}.${randomInt(1, 255)}` },
    });
    const other = await stranger.newPage();
    await other.goto("/login?uqtur=confirm");
    await other.getByTestId("resend-email").fill("nobody@gmail.com");
    await waitForFormAge(other);
    await other.getByTestId("resend-submit").click();
    await expect(other.getByTestId("auth-notice-text")).toHaveText(RESENT_MESSAGE);
    await expect(page.getByTestId("auth-notice-text")).toHaveText(RESENT_MESSAGE);
    await stranger.close();

    expect(mock.callsTo("resend").map((call) => call.body.email)).toEqual([
      "new@gmail.com",
      "nobody@gmail.com",
    ]);
  });

  test("a wait Supabase asks for is not shown — it would say the address is registered", async ({
    page,
  }) => {
    mock.failNext("resend", {
      status: 429,
      code: "over_email_send_rate_limit",
      message: "For security purposes, you can only request this after 30 seconds.",
    });
    await page.goto("/login?uqtur=confirm");
    await page.getByTestId("resend-email").fill("pending@gmail.com");
    await waitForFormAge(page);
    await page.getByTestId("resend-submit").click();
    await expect(page.getByTestId("auth-notice")).toContainText(RESENT_MESSAGE);
    await expect(page.getByTestId("auth-error")).toHaveCount(0);
  });

  test("offered again when signing in finds the address unconfirmed", async ({ page }) => {
    const password = freshPassword();
    await mock.addUser("unconfirmed@gmail.com", password, false);
    await signIn(page, "unconfirmed@gmail.com", password);
    await expect(page.getByTestId("auth-error")).toContainText("جەزملەنمىگەن");
    await waitForFormAge(page);
    await page.getByTestId("resend-submit").click();
    await expect(page.getByTestId("auth-notice")).toContainText(RESENT_MESSAGE);
    expect(mock.callsTo("resend").map((call) => call.body.email)).toEqual(["unconfirmed@gmail.com"]);
    expect(await mock.counterRows(), "an unconfirmed address is not a failed attempt").toBe(0);
  });

  test("a mistyped address can be corrected from the notice", async ({ page }) => {
    await register(page, "typo@gmail.com");
    await page.getByTestId("reregister-link").click();
    await expect(page).toHaveURL(/\/register\?fix=1$/);
    await expect(page.getByTestId("register-email")).toHaveValue("typo@gmail.com");
    await expect(page.locator('input[name="display_name"]')).toHaveValue("سىناق");
  });
});

/* ── right to left, with the address left to right ───────────────────────── */

test("the page reads right to left and every address field left to right", async ({ page }) => {
  await register(page, "ltr@gmail.com");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.getByTestId("sent-to")).toHaveAttribute("dir", "ltr");
  await page.goto("/register");
  await expect(page.getByTestId("register-email")).toHaveAttribute("dir", "ltr");
  await page.goto("/login");
  for (const field of await page.locator('input[type="email"]').all()) {
    await expect(field).toHaveAttribute("dir", "ltr");
  }
});

/* ── the narrowest phone ──────────────────────────────────────────────────── */

test("at 360 px nothing new scrolls sideways, even with a very long address", async ({
  page,
}, testInfo) => {
  test.skip(!testInfo.project.name.includes("375"), "once, on the phone project, is enough");
  await page.setViewportSize({ width: 360, height: 740 });
  const long = "a.very.long.name.for.a.reader+library@gmial.com";

  await page.goto("/register");
  await fillRegistration(page, long);
  await blurUntilSuggested(page);
  await assertTappable(page, page.getByTestId("suggestion-accept"), "«use it» at 360");
  await assertTappable(page, page.getByTestId("suggestion-keep"), "«keep it» at 360");

  for (let attempt = 0; attempt < 3; attempt += 1) await register(page, "a@qq.com");
  await expect(page.getByTestId("auth-error-text")).toHaveText(LOCKED_MESSAGE);
  await assertTappable(page, page.getByTestId("locked-login-link"), "the lock's link at 360");

  await page.context().clearCookies();
  await page.setExtraHTTPHeaders({ "x-forwarded-for": `198.19.${randomInt(1, 255)}.${randomInt(1, 255)}` });
  await register(page, long.replace("gmial", "gmail"));
  await expect(page.getByTestId("sent-to")).toBeVisible();
  await assertTappable(page, page.getByTestId("reregister-link"), "«ئادرېس خاتا بولسا…» at 360");
  await assertTappable(page, page.getByTestId("resend-submit"), "the resend button at 360");
});

/* ── without JavaScript ───────────────────────────────────────────────────── */

test.describe("with JavaScript switched off", () => {
  test.use({ javaScriptEnabled: false });

  test("the server offers the suggestion, keeps what was typed, and «use it» works", async ({
    page,
  }) => {
    await register(page, "name@gmial.com");
    await expect(page.getByTestId("email-suggestion-text")).toHaveText(
      typoMessage("gmial.com", "gmail.com"),
    );
    await expect(page.getByTestId("register-email")).toHaveValue("name@gmial.com");
    await expect(page.locator('input[name="display_name"]')).toHaveValue("سىناق");
    await expect(page.locator('input[name="password"]')).toHaveValue("");
    expect(mock.callsTo("signup")).toHaveLength(0);

    await page.getByTestId("suggestion-accept").click();
    await expect(page.getByTestId("register-email")).toHaveValue("name@gmail.com");
    await expect(page.getByTestId("email-suggestion")).toHaveCount(0);

    await page.locator('input[name="password"]').fill(freshPassword());
    await waitForFormAge(page);
    await submit(page, registerButton(page));
    await expect(page).toHaveURL(/\/login\?uqtur=confirm/, { timeout: 15_000 });
    await expect(page.getByTestId("sent-to")).toHaveText("name@gmail.com");
  });

  test("a typo whose domain receives no mail is offered the fix, not counted against the reader", async ({
    page,
  }) => {
    await register(page, "name@gmal.com");
    await expect(page.getByTestId("email-suggestion-text")).toHaveText(
      typoMessage("gmal.com", "gmail.com"),
    );
    expect(await mock.counterRows()).toBe(0);
    // Keeping a domain that cannot receive mail is refused — and counted.
    await submit(page, page.getByTestId("suggestion-keep"));
    await page.locator('input[name="password"]').fill(freshPassword());
    await waitForFormAge(page);
    await submit(page, registerButton(page));
    await expect(page.getByTestId("auth-error-text")).toContainText("قوبۇل قىلىنمىدى");
    expect(await mock.counterRows()).toBe(2);
    expect(mock.callsTo("signup")).toHaveLength(0);
  });

  test("«keep it» works, and so do the other messages", async ({ page }) => {
    await register(page, "name@outlok.com");
    await page.getByTestId("suggestion-keep").click();
    await expect(page.getByTestId("email-suggestion")).toHaveCount(0);
    await expect(page.getByTestId("register-email")).toHaveValue("name@outlok.com");
    await page.locator('input[name="password"]').fill(freshPassword());
    await waitForFormAge(page);
    await submit(page, registerButton(page));
    await expect(page).toHaveURL(/\/login\?uqtur=confirm/, { timeout: 15_000 });
    expect(mock.callsTo("signup").map((call) => call.body.email)).toEqual(["name@outlok.com"]);

    await register(page, "a@qq.com");
    await expect(page.getByTestId("auth-error-text")).toHaveText(BLOCKED_MESSAGE);
    await expect(page.getByTestId("register-email")).toHaveValue("a@qq.com");
    await register(page, "a@qq.com");
    await register(page, "a@qq.com");
    await expect(page.getByTestId("auth-error-text")).toHaveText(LOCKED_MESSAGE);
    await expect(page.getByTestId("locked-login-link")).toBeVisible();
  });

  test("sign-in keeps the address after a wrong password, and resend still answers", async ({
    page,
  }) => {
    await mock.addUser("kept@gmail.com", freshPassword());
    await signIn(page, "kept@gmail.com", freshPassword());
    await expect(page.getByTestId("auth-error-text")).toHaveText("ئېلخەت ياكى پارول خاتا. قايتا سىناڭ.");
    await expect(page.locator('form:has(input[name="password"]) input[name="email"]')).toHaveValue(
      "kept@gmail.com",
    );
    await expect(page.locator('input[name="password"]')).toHaveValue("");

    await page.goto("/login?uqtur=confirm");
    await page.getByTestId("resend-email").fill("kept@gmail.com");
    await waitForFormAge(page);
    await page.getByTestId("resend-submit").click();
    await expect(page.getByTestId("auth-notice")).toContainText(RESENT_MESSAGE);
    // No countdown without script — the button simply stays usable.
    await expect(page.getByTestId("resend-submit")).toBeEnabled();
  });
});
