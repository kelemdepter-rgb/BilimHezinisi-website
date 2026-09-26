import { createHmac } from "node:crypto";
import { expect, type Locator, type Page } from "@playwright/test";
import { MOCK_SERVICE_KEY, freshPassword } from "../env";

/**
 * What the sign-in and registration specs do on a page, shared by
 * tests/auth-flows.spec.ts (PROMPT-38) and tests/signup-guards.spec.ts
 * (PROMPT-39). `waitForFormAge` is used by trust.spec.ts as well.
 */

export async function assertNoHorizontalOverflow(page: Page) {
  const metrics = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(metrics.scrollWidth, "page must not scroll horizontally").toBeLessThanOrEqual(
    metrics.innerWidth + 1,
  );
}

/**
 * The control is on screen, at least 44 px tall, and it is what a tap at its
 * centre would reach — no fixed bar, no overlay on top of it. Checked at the
 * top of the page and again after scrolling to the bottom and back.
 */
export async function assertTappable(page: Page, control: Locator, label: string) {
  for (const pass of ["as loaded", "after scrolling down and back up"]) {
    if (pass !== "as loaded") {
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      await page.waitForTimeout(150);
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForTimeout(150);
    }
    await control.scrollIntoViewIfNeeded();
    await expect(control, `${label} ${pass}`).toBeVisible();
    const box = (await control.boundingBox())!;
    expect(box.height, `${label} must be at least 44 px tall`).toBeGreaterThanOrEqual(44);
    const reached = await control.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      return hit !== null && (hit === element || element.contains(hit));
    });
    expect(reached, `${label} must not be covered ${pass}`).toBe(true);
  }
  await assertNoHorizontalOverflow(page);
}

/**
 * MIN_FORM_AGE_MS in lib/auth/bot-check.ts — which imports `server-only`, so
 * a spec cannot load it.
 */
const FORM_MIN_AGE_MS = 2_000;

/**
 * Wait until the page's forms are old enough to be accepted.
 *
 * Every form that sends email carries the time its page was made, signed
 * (lib/auth/bot-check.ts), and one sent back in under two seconds — faster
 * than a person types — is asked to try again. Playwright fills a form in
 * milliseconds, so a test that means to be a person waits out the rest of
 * those two seconds first. The browser and the server share this machine's
 * clock.
 */
export async function waitForFormAge(page: Page): Promise<void> {
  const issued = [0];
  for (const field of await page.locator('input[name="bh_ts"]').all()) {
    issued.push(Number((await field.getAttribute("value"))?.split(".")[0]) || 0);
  }
  const wait = Math.max(...issued) + FORM_MIN_AGE_MS + 150 - Date.now();
  if (wait > 0) await page.waitForTimeout(wait);
}

/**
 * A form token made `ageMs` ago, signed as the :3300 server signs one — it
 * runs with the fake's service key (playwright.config.ts). For the specs that
 * play a bot: a page submitted the instant it was made, or one kept for hours.
 */
export function formTokenAged(ageMs: number): string {
  const secret = createHmac("sha256", MOCK_SERVICE_KEY).update("bh-form-token/v1").digest("hex");
  const issuedAt = Date.now() - ageMs;
  return `${issuedAt}.${createHmac("sha256", secret).update(`form\n${issuedAt}`).digest("base64url")}`;
}

export async function fillRegistration(page: Page, email: string, name = "سىناق") {
  await page.locator('input[name="display_name"]').fill(name);
  await page.getByTestId("register-email").fill(email);
  await page.locator('input[name="password"]').fill(freshPassword());
}

export function registerButton(page: Page) {
  return page.getByRole("button", { name: "تىزىمدىن ئۆتۈش", exact: true });
}

/**
 * Click a submit button and wait until the Server Action has answered.
 *
 * Not optional: the answer carries the device cookie the counter keys on, and
 * a test that navigates on before it has arrived throws the cookie away — the
 * next attempt then looks like a brand-new device, and "three chances" quietly
 * becomes three per attempt.
 */
export async function submit(page: Page, button: Locator) {
  await Promise.all([
    page.waitForResponse(
      (response) => response.request().method() === "POST" && new URL(response.url()).port === "3300",
    ),
    button.click(),
  ]);
}

export async function register(page: Page, email: string) {
  await page.goto("/register");
  await fillRegistration(page, email);
  await waitForFormAge(page);
  await submit(page, registerButton(page));
}

export async function signIn(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.locator('form:has(input[name="password"]) input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(password);
  await submit(page, page.getByRole("button", { name: "كىرىش", exact: true }));
}

/** The typo notice appears on leaving the field — once React is listening. */
export async function blurUntilSuggested(page: Page) {
  const field = page.getByTestId("register-email");
  await expect(async () => {
    await field.focus();
    await field.blur();
    await expect(page.getByTestId("email-suggestion")).toBeVisible({ timeout: 1500 });
  }).toPass({ timeout: 20_000 });
}
