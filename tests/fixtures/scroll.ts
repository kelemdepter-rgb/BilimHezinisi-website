import { expect, test, type Page } from "@playwright/test";

/**
 * Scrolling the page the same way in every engine the notebook runs in.
 *
 * Playwright cannot send wheel events to mobile WebKit ("Mouse wheel is not
 * supported in mobile WebKit") and has no touch-scroll gesture for it either.
 * There the page is scrolled directly. What the specs assert — every control
 * still visible and tappable after scrolling down and back up — is about the
 * state the page ends in, which is the same either way.
 */
export function wheelWorks(page: Page): boolean {
  const engine = page.context().browser()?.browserType().name();
  return !(engine === "webkit" && test.info().project.use.isMobile);
}

export async function scrollPage(page: Page, dy: number) {
  if (wheelWorks(page)) await page.mouse.wheel(0, dy);
  else await page.evaluate((delta) => window.scrollBy(0, delta), dy);
  await page.waitForTimeout(200);
}

/**
 * Scroll to the very top, and make it stick.
 *
 * Firefox scrolls the caret into view a frame AFTER the last keystroke, so a
 * scrollTo(0, 0) sent straight after typing can be undone a moment later and
 * the page is measured half a screen down. Repeat until the page is still at
 * the top a few frames after being put there.
 */
export async function scrollToTop(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(async () => {
        window.scrollTo(0, 0);
        for (let frame = 0; frame < 3; frame += 1) {
          await new Promise((done) => requestAnimationFrame(done));
        }
        return window.scrollY;
      }),
    )
    .toBe(0);
}
