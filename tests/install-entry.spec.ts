import { expect, test, type Locator, type Page } from "@playwright/test";

/**
 * «ئەپ قىلىپ قاچىلاش» in the menu (PROMPT-55): one quiet row from which a
 * reader can install the site as an app — never a pop-up, and never a lesson
 * in the browser's own menu: where a browser can install, the row is there
 * only once one tap does it. The iPhone (no way to install from a page) gets
 * three steps; another app's browser gets the way out.
 *
 * Chrome's real `beforeinstallprompt` needs 30 s of engagement and a real
 * install path, neither of which a test has, so the offer is a synthetic
 * event dispatched on load with a stubbed `prompt()` and `userChoice` —
 * exactly the two members the page uses. Everything is anonymous: installing
 * is for every reader, account or not.
 */

const LABEL = "ئەپ قىلىپ قاچىلاش";
const DONE = "قاچىلاندى";

const ANDROID_CHROME =
  "Mozilla/5.0 (Linux; Android 14; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36";
const IPHONE_SAFARI =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1";
const FACEBOOK_ANDROID =
  "Mozilla/5.0 (Linux; Android 14; SM-S911B Build/UP1A.231005.007; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/131.0.6778.81 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/490.0.0.50.80;]";

type InstallRecord = {
  prompts: number;
  event: Event | null;
  listening: boolean;
  /** Whether the page was already listening when `load` fired. */
  listeningAtLoad: boolean | null;
  offer: () => void;
};

declare global {
  interface Window {
    __install?: InstallRecord;
  }
}

/**
 * Records when the page starts listening for `beforeinstallprompt`, and
 * offers an install on `load` when asked to — the way Chrome does once it
 * has decided the reader is engaged.
 */
async function instrument(page: Page, options: { offer?: "accepted" | "dismissed" } = {}) {
  await page.addInitScript((choice: "accepted" | "dismissed" | null) => {
    const record = {
      prompts: 0,
      event: null as Event | null,
      listening: false,
      listeningAtLoad: null as boolean | null,
      offer() {
        const event = new Event("beforeinstallprompt", { cancelable: true });
        const answer = { outcome: choice ?? "accepted", platform: "web" };
        Object.assign(event, {
          prompt: () => {
            record.prompts += 1;
            return Promise.resolve(answer);
          },
          userChoice: Promise.resolve(answer),
        });
        record.event = event;
        window.dispatchEvent(event);
      },
    };
    window.__install = record;
    const add = window.addEventListener;
    window.addEventListener = function (this: Window, ...args: Parameters<typeof add>) {
      if (String(args[0]) === "beforeinstallprompt") record.listening = true;
      return add.apply(this, args);
    } as typeof add;
    window.addEventListener("load", () => {
      record.listeningAtLoad = record.listening;
    });
    if (choice) window.addEventListener("load", () => setTimeout(() => record.offer(), 0));
  }, options.offer ?? null);
}

/** Pretends this page is running as the installed app. */
async function runAsInstalledApp(page: Page) {
  await page.addInitScript(() => {
    const real = window.matchMedia.bind(window);
    window.matchMedia = (query: string) => {
      if (!query.includes("display-mode: standalone")) return real(query);
      const list = real("all");
      Object.defineProperty(list, "matches", { value: true });
      Object.defineProperty(list, "media", { value: query });
      return list;
    };
  });
}

/** The page's install listeners are attached, and React has had time to draw. */
async function settled(page: Page) {
  await page.waitForFunction(() => window.__install?.listening === true);
  await page.waitForLoadState("load");
  await page.waitForTimeout(600);
}

/** The menu that holds the row: the drawer on a phone, the sidebar at 1280. */
async function openMenu(page: Page, isMobile: boolean): Promise<Locator> {
  if (!isMobile) return page.getByTestId("sidebar-desktop");
  await page.getByTestId("menu-button").click();
  const drawer = page.getByTestId("drawer");
  await expect(drawer).toBeVisible();
  return drawer;
}

async function noHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, "the page must not scroll sideways").toBeLessThanOrEqual(1);
}

/** The element actually on top at a locator's centre is that locator (or inside it). */
async function onTop(locator: Locator) {
  const hit = await locator.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const top = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
    return !!top && (top === element || element.contains(top));
  });
  expect(hit, "nothing may cover the row").toBe(true);
}

test("nothing appears by itself, even when the browser makes an offer", async ({ page }) => {
  await instrument(page, { offer: "accepted" });
  await page.goto("/");
  await settled(page);
  // No banner, no dialog, no toast, and no prompt() nobody asked for.
  await expect(page.getByTestId("drawer")).not.toBeVisible();
  await expect(page.getByRole("dialog", { includeHidden: false })).toHaveCount(0);
  await expect(page.getByTestId("install-panel").filter({ visible: true })).toHaveCount(0);
  expect(await page.evaluate(() => window.__install!.prompts)).toBe(0);
});

test.describe("Android before the browser's offer", () => {
  test.skip(({ isMobile, browserName }) => !isMobile || browserName !== "chromium", "Android phones only");
  test.use({ userAgent: ANDROID_CHROME });

  test("no row and no lesson in the browser's menu — then one tap, once Chrome is ready", async ({ page }) => {
    await instrument(page);
    await page.goto("/");
    await settled(page);
    const drawer = await openMenu(page, true);
    await expect(drawer.getByRole("navigation", { name: "بۆلۈملەر" })).toBeVisible();
    await expect(page.getByTestId("install-entry")).toHaveCount(0);
    await expect(page.getByTestId("install-panel")).toHaveCount(0);

    // Chrome makes its offer while the drawer is open: the row arrives as
    // the last one, and one tap installs.
    await page.evaluate(() => window.__install!.offer());
    const row = drawer.getByTestId("install-entry");
    await expect(row).toHaveAttribute("data-kind", "prompt");
    await expect(row).toBeVisible();
    const last = await drawer
      .getByRole("navigation", { name: "بۆلۈملەر" })
      .evaluate((nav) => nav.lastElementChild?.getAttribute("data-testid"));
    expect(last).toBe("install-entry");
    await row.click();
    await expect(drawer.getByTestId("install-done")).toContainText(DONE);
    expect(await page.evaluate(() => window.__install!.prompts)).toBe(1);
  });
});

test.describe("on an iPhone", () => {
  test.skip(({ isMobile }) => !isMobile, "phones only");
  test.use({ userAgent: IPHONE_SAFARI });

  test("the row is in the drawer, 44 px tall, and unfolds the three steps in place", async ({ page }) => {
    await instrument(page);
    await page.goto("/");
    const drawer = await openMenu(page, true);
    const row = drawer.getByTestId("install-entry");
    await expect(row).toBeVisible();
    await expect(row).toHaveText(new RegExp(LABEL));
    await expect(row).toHaveAttribute("data-kind", "ios");
    // The last row of «بۆلۈملەر», its folded panel after it.
    const lastTwo = await drawer
      .getByRole("navigation", { name: "بۆلۈملەر" })
      .evaluate((nav) => [...nav.children].slice(-2).map((child) => child.getAttribute("data-testid")));
    expect(lastTwo).toEqual(["install-entry", "install-panel"]);
    const box = await row.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);

    await expect(row).toHaveAttribute("aria-expanded", "false");
    await row.click();
    await expect(row).toHaveAttribute("aria-expanded", "true");
    const panel = drawer.getByTestId("install-panel");
    await expect(panel).toBeVisible();
    // Share → «Add to Home Screen» → «Add», with the share glyph drawn in.
    await expect(panel.getByTestId("install-steps").locator("li")).toHaveCount(3);
    await expect(panel.getByTestId("install-share-icon")).toBeVisible();
    await expect(panel).toContainText("Add to Home Screen");
    // The drawer stays open: the row is a place to read, not a link away.
    await expect(drawer).toBeVisible();

    await row.click();
    await expect(row).toHaveAttribute("aria-expanded", "false");
    await expect(panel).toBeHidden();
  });

  test("the drawer still scrolls, closes and fits 360 px with the steps open", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await instrument(page);
    await page.goto("/");
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await page.waitForTimeout(250);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(250);

    const drawer = await openMenu(page, true);
    const row = drawer.getByTestId("install-entry");
    await row.click();
    await expect(drawer.getByTestId("install-panel")).toBeVisible();
    await noHorizontalOverflow(page);

    const scroller = drawer.locator(".overflow-y-auto");
    const sideways = await scroller.evaluate((element) => element.scrollWidth - element.clientWidth);
    expect(sideways, "the drawer must not scroll sideways").toBeLessThanOrEqual(1);

    // Scroll the drawer to its end and back: it moves (or has nothing to
    // move), and the row is on top and tappable afterwards.
    const moved = await scroller.evaluate(async (element) => {
      element.scrollTop = element.scrollHeight;
      await new Promise((resolve) => setTimeout(resolve, 200));
      const bottom = element.scrollTop;
      element.scrollTop = 0;
      await new Promise((resolve) => setTimeout(resolve, 200));
      return { bottom, room: element.scrollHeight - element.clientHeight, top: element.scrollTop };
    });
    if (moved.room > 1) expect(moved.bottom).toBeGreaterThan(0);
    expect(moved.top).toBe(0);
    await onTop(row);
    await row.click();
    await expect(row).toHaveAttribute("aria-expanded", "false");

    // Closing works as before, and the page scrolls again afterwards.
    await page.getByTestId("drawer-close").click();
    await expect(drawer).not.toBeVisible();
    expect(await page.evaluate(() => document.documentElement.style.overflow)).not.toBe("hidden");
    await page.getByTestId("menu-button").click();
    await expect(drawer).toBeVisible();
    await page.getByTestId("drawer-overlay").click({ position: { x: 10, y: 300 } });
    await expect(drawer).not.toBeVisible();
  });
});

test("the page listens for the browser's offer before it has finished loading", async ({ page }) => {
  // Chrome makes its offer once, shortly after `load`. The shell's own code
  // was measured arriving after `load`, so instrumentation-client.ts attaches
  // the listeners before hydration; this holds it there.
  await instrument(page);
  await page.goto("/");
  await expect.poll(() => page.evaluate(() => window.__install!.listeningAtLoad)).toBe(true);
});

test.describe("with the browser's install offer", () => {
  test.skip(({ browserName }) => browserName === "webkit", "Safari never makes an offer");

  test("a tap opens it once, and the row says it is installed", async ({ page, isMobile }) => {
    await instrument(page, { offer: "accepted" });
    await page.goto("/");
    await page.waitForFunction(() => window.__install?.event !== null);
    // Saved, not suppressed: Chrome's own notice keeps appearing.
    expect(await page.evaluate(() => window.__install!.event!.defaultPrevented)).toBe(false);

    const menu = await openMenu(page, isMobile);
    const row = menu.getByTestId("install-entry");
    await expect(row).toHaveAttribute("data-kind", "prompt");
    await expect(row).toBeVisible();
    // One tap installs: nothing to unfold.
    expect(await row.getAttribute("aria-expanded")).toBeNull();
    const box = await row.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
    await onTop(row);

    await row.click();
    await expect(menu.getByTestId("install-done")).toContainText(DONE);
    await expect(menu.getByTestId("install-entry")).toHaveCount(0);
    expect(await page.evaluate(() => window.__install!.prompts)).toBe(1);
    if (isMobile) await noHorizontalOverflow(page);
  });

  test("after a «no», the browser's next offer brings the one-tap row back", async ({ page, isMobile }) => {
    await instrument(page, { offer: "dismissed" });
    await page.goto("/");
    await page.waitForFunction(() => window.__install?.event !== null);
    const menu = await openMenu(page, isMobile);
    const row = menu.getByTestId("install-entry");
    await expect(row).toHaveAttribute("data-kind", "prompt");
    await row.click();
    await expect.poll(() => page.evaluate(() => window.__install!.prompts)).toBe(1);
    await expect(menu.getByTestId("install-done")).toHaveCount(0);
    // An offer is used once; Chrome sends a fresh one after a dismissal, and
    // until it does there is nothing a tap could install.
    await page.evaluate(() => window.__install!.offer());
    await expect(row).toHaveAttribute("data-kind", "prompt");
    await expect(row).toBeVisible();
    await row.click();
    await expect.poll(() => page.evaluate(() => window.__install!.prompts)).toBe(2);
  });

  test("an install the browser made by itself takes the row away", async ({ page, isMobile }) => {
    await instrument(page, { offer: "accepted" });
    await page.goto("/");
    const menu = await openMenu(page, isMobile);
    await expect(menu.getByTestId("install-entry")).toHaveAttribute("data-kind", "prompt");
    await page.evaluate(() => window.dispatchEvent(new Event("appinstalled")));
    await expect(page.getByTestId("install-entry")).toHaveCount(0);
    await expect(page.getByTestId("install-done")).toHaveCount(0);
  });
});

test.describe("on a computer", () => {
  test.skip(({ isMobile }) => !!isMobile, "desktop only");

  test("no row without an offer", async ({ page }) => {
    await instrument(page);
    await page.goto("/");
    await settled(page);
    await expect(page.getByTestId("sidebar-desktop")).toBeVisible();
    await expect(page.getByTestId("install-entry")).toHaveCount(0);
  });
});

test.describe("inside the installed app", () => {
  test("no row in the drawer or the sidebar, offer or not", async ({ page, isMobile }) => {
    await runAsInstalledApp(page);
    await instrument(page);
    await page.goto("/");
    await settled(page);
    await page.evaluate(() => window.__install!.offer());
    await page.waitForTimeout(300);
    const menu = await openMenu(page, isMobile);
    await expect(menu).toBeVisible();
    await expect(page.getByTestId("install-entry")).toHaveCount(0);
    await expect(page.getByTestId("install-done")).toHaveCount(0);
  });
});

test.describe("inside another app's browser", () => {
  test.skip(({ isMobile, browserName }) => !isMobile || browserName !== "chromium", "Android phones only");
  test.use({ userAgent: FACEBOOK_ANDROID });

  test("the row says to open the page in Safari or Chrome, and copies the link", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await instrument(page);
    await page.goto("/");
    const drawer = await openMenu(page, true);
    const row = drawer.getByTestId("install-entry");
    await expect(row).toHaveAttribute("data-kind", "in-app");
    await row.click();
    const notice = drawer.getByTestId("install-in-app");
    await expect(notice).toBeVisible();
    await expect(notice).toContainText("Safari ياكى Chrome");
    const copy = notice.getByTestId("install-copy-link");
    const box = await copy.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
    await copy.click();
    await expect(notice.getByTestId("install-copied")).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(page.url());
    await noHorizontalOverflow(page);
  });

  test("where the clipboard is refused, the address is shown to copy by hand", async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "clipboard", {
        value: { writeText: () => Promise.reject(new DOMException("refused", "NotAllowedError")) },
      });
    });
    await instrument(page);
    await page.goto("/");
    const drawer = await openMenu(page, true);
    await drawer.getByTestId("install-entry").click();
    await drawer.getByTestId("install-copy-link").click();
    await expect(drawer.getByTestId("install-address")).toHaveValue(page.url());
    await noHorizontalOverflow(page);
  });
});
