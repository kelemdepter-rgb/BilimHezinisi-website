import { test, expect, type Page } from "@playwright/test";
import {
  GEMINI_ORIGIN,
  geminiCalls,
  installGeminiMock,
  setGeminiBehaviour,
} from "./fixtures/gemini-mock";

/**
 * The AI layer, against a fake Google.
 *
 * Nothing in here spends real quota — tests/fixtures/gemini-mock.ts stands in
 * for the endpoint inside the page, so lib/ai/client.ts runs its real parser,
 * its real watchdogs and its real failover against responses a test controls.
 *
 * The four keys are named so a failure message says which slot broke.
 */
const KEY_1 = "AIzaTestKeySlotOne0000000000000001";
const KEY_2 = "AIzaTestKeySlotTwo0000000000000002";
const KEY_3 = "AIzaTestKeySlotThree000000000000003";
const KEY_4 = "AIzaTestKeySlotFour000000000000004";
const ALL_KEYS = [KEY_1, KEY_2, KEY_3, KEY_4] as const;

/** Every localStorage entry the AI layer is allowed to write. */
const AI_STORAGE_KEYS = [
  "bh-ai-enabled",
  "bh-ai-keys",
  "bh-ai-model",
  "bh-ai-last-good-slot",
  "bh-ai-usage",
];

async function assertNoHorizontalOverflow(page: Page) {
  const metrics = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(metrics.scrollWidth, "page must not scroll horizontally").toBeLessThanOrEqual(
    metrics.innerWidth + 1,
  );
}

/**
 * Tick the switch, and keep at it until it stays ticked.
 *
 * The box is a controlled input fed from localStorage, so a click that lands
 * before React has hydrated flips the DOM and is then rendered straight back —
 * Playwright calls that "clicking the checkbox did not change its state". The
 * notice that used to stand above the switch gave hydration a head start this
 * now has to ask for outright.
 */
async function tickTheSwitch(page: Page) {
  const toggle = page.getByTestId("ai-enable");
  await expect(async () => {
    await toggle.check();
    await expect(toggle).toBeChecked();
  }).toPass({ timeout: 15_000 });
}

/** Turn AI on and save the given keys, the way a reader would. */
async function enableWithKeys(page: Page, keys: readonly string[]) {
  await page.goto("/my/ai");
  await tickTheSwitch(page);
  for (const [slot, key] of keys.entries()) {
    await page.getByTestId(`ai-key-${slot}`).fill(key);
  }
  await page.getByTestId("ai-save").click();
  await expect(page.getByTestId("ai-saved")).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await installGeminiMock(page);
  /**
    * A clean slate per test, without touching anything else the browser holds
    * — the signed-in session among it.
    *
    * ONCE per test, not once per navigation: a reload is how a test proves a
    * setting was really persisted, and wiping storage on the way into it would
    * make that assertion prove nothing. Playwright gives each test its own
    * context, so the sessionStorage marker starts unset every time.
    */
  await page.addInitScript((storageKeys: string[]) => {
    try {
      if (sessionStorage.getItem("bh-ai-test-clean") === "1") return;
      for (const key of storageKeys) localStorage.removeItem(key);
      sessionStorage.setItem("bh-ai-test-clean", "1");
    } catch {
      // A browser that blocks storage has nothing to clear.
    }
  }, AI_STORAGE_KEYS);
});

/* ── The library without AI ──────────────────────────────────────────────── */

test.describe("a visitor with no account", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("reads, searches and sees no sign of AI anywhere", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("login-link")).toBeVisible();
    await expect(page.getByTestId("ai-sidebar-link")).toHaveCount(0);
    await expect(page.getByText("سۈنئىي ئىدراك")).toHaveCount(0);

    await page.goto("/search?q=%D9%83%D9%89%D8%AA%D8%A7%D8%A8");
    await expect(page.getByTestId("ai-sidebar-link")).toHaveCount(0);

    // The settings screen is not reachable without an account at all.
    await page.goto("/my/ai");
    await expect(page).toHaveURL(/\/login/);
    await assertNoHorizontalOverflow(page);
  });
});

/* ── Off by default ──────────────────────────────────────────────────────── */

test.describe("a reader who has not set anything up", () => {
  test("finds AI off, with no key field and no nagging", async ({ page }) => {
    await page.goto("/my/ai");

    const toggle = page.getByTestId("ai-enable");
    await expect(toggle).not.toBeChecked();
    await expect(page.getByTestId("ai-off-note")).toBeVisible();

    // Nothing that could send anything anywhere exists until it is switched on.
    await expect(page.getByTestId("ai-key-0")).toHaveCount(0);
    await expect(page.getByTestId("ai-model")).toHaveCount(0);
    await expect(page.getByTestId("ai-send")).toHaveCount(0);

    // And the library never asks: the home page says nothing about it.
    await page.goto("/");
    await expect(page.getByText("ئاچقۇچ")).toHaveCount(0);
    await assertNoHorizontalOverflow(page);
  });
});

/* ── Keys ────────────────────────────────────────────────────────────────── */

test.describe("the four key slots", () => {
  test("all four save, and each reports its own verdict", async ({ page }) => {
    await enableWithKeys(page, ALL_KEYS);

    // A saved key is only ever shown masked, and the field is emptied.
    for (let slot = 0; slot < 4; slot += 1) {
      await expect(page.getByTestId(`ai-key-mask-${slot}`)).toBeVisible();
      await expect(page.getByTestId(`ai-key-${slot}`)).toHaveValue("");
    }
    await expect(page.getByTestId("ai-key-mask-0")).toContainText("AIza");

    await setGeminiBehaviour(page, {
      [KEY_1]: { kind: "ok", chunks: ["سالام"] },
      [KEY_2]: { kind: "quota" },
      [KEY_3]: { kind: "invalid" },
      [KEY_4]: { kind: "busy" },
    });

    const expected = ["valid", "quota", "invalid", "busy"] as const;
    for (const [slot, status] of expected.entries()) {
      await page.getByTestId(`ai-test-${slot}`).click();
      await expect(page.getByTestId(`ai-result-${slot}`)).toHaveAttribute("data-status", status);
    }

    // Each verdict is its own, and an exhausted key is not called a broken one.
    await expect(page.getByTestId("ai-result-1")).toContainText("ئاچقۇچ توغرا");
    await expect(page.getByTestId("ai-result-2")).toContainText("ئىناۋەتسىز");
    await expect(page.getByTestId("ai-result-3")).toContainText("ئالدىراش");
    await assertNoHorizontalOverflow(page);
  });

  test("the key never appears in a request to this site, nor in plain storage", async ({
    page,
  }) => {
    const leaks: string[] = [];
    page.on("request", (request) => {
      const url = request.url();
      if (url.startsWith(GEMINI_ORIGIN)) return;
      const body = request.postData() ?? "";
      if (url.includes(KEY_1) || body.includes(KEY_1)) leaks.push(`${request.method()} ${url}`);
    });

    await enableWithKeys(page, [KEY_1]);
    await setGeminiBehaviour(page, { [KEY_1]: { kind: "ok", chunks: ["جاۋاب"] } });
    await page.getByTestId("ai-question").fill("سىناق");
    await page.getByTestId("ai-send").click();
    await expect(page.getByTestId("ai-answer")).toContainText("جاۋاب");

    expect(leaks, "no request to our own origin may carry the key").toEqual([]);

    // Stored, but not in plain sight: the obfuscated form is what is on disk.
    const stored = await page.evaluate(() => localStorage.getItem("bh-ai-keys"));
    expect(stored).not.toBeNull();
    expect(stored).not.toContain(KEY_1);

    // It reached Google in a header, never in the URL.
    const calls = await geminiCalls(page);
    expect(calls.length).toBeGreaterThan(0);
    expect(calls[0].key).toBe(KEY_1);
    expect(calls[0].url).not.toContain(KEY_1);
  });
});

/* ── Asking ──────────────────────────────────────────────────────────────── */

test.describe("asking a question", () => {
  test("streams the answer in, and counts the request", async ({ page }) => {
    await enableWithKeys(page, [KEY_1]);
    await setGeminiBehaviour(page, {
      [KEY_1]: { kind: "ok", chunks: ["ئىلىم ", "ئۆگىنىش ", "ياخشى."], delayMs: 120 },
    });

    await page.getByTestId("ai-question").fill("ئىلىم ھەققىدە");
    await page.getByTestId("ai-send").click();

    // Seen part-written, then whole: that is what streaming means.
    await expect(page.getByTestId("ai-answer")).toContainText("ئىلىم");
    await expect(page.getByTestId("ai-answer")).toContainText("ئىلىم ئۆگىنىش ياخشى.");
    await expect(page.getByTestId("ai-slot")).toContainText("1");
    await expect(page.getByTestId("ai-usage-requests")).toHaveText("1");
    await assertNoHorizontalOverflow(page);
  });

  test("cancelling mid-stream leaves nothing half-written", async ({ page }) => {
    await enableWithKeys(page, [KEY_1]);
    await setGeminiBehaviour(page, {
      [KEY_1]: {
        kind: "ok",
        chunks: ["بىرىنچى ", "ئىككىنچى ", "ئۈچىنچى ", "تۆتىنچى ", "بەشىنچى"],
        delayMs: 400,
      },
    });

    await page.getByTestId("ai-question").fill("ئۇزۇن جاۋاب");
    await page.getByTestId("ai-send").click();
    await expect(page.getByTestId("ai-answer")).toContainText("بىرىنچى");

    await page.getByTestId("ai-cancel").click();

    await expect(page.getByTestId("ai-answer")).toHaveCount(0);
    await expect(page.getByTestId("ai-error")).toHaveCount(0);
    await expect(page.getByTestId("ai-streaming")).toHaveCount(0);
    await expect(page.getByTestId("ai-send")).toBeEnabled();

    // Still nothing after the rest of the answer would have arrived.
    await page.waitForTimeout(1200);
    await expect(page.getByTestId("ai-answer")).toHaveCount(0);
    await assertNoHorizontalOverflow(page);
  });
});

/* ── Failover ────────────────────────────────────────────────────────────── */

test.describe("automatic failover", () => {
  test("a 429 walks down the slots on its own, without changing the model", async ({ page }) => {
    await enableWithKeys(page, ALL_KEYS);
    await setGeminiBehaviour(page, {
      [KEY_1]: { kind: "quota" },
      [KEY_2]: { kind: "quota" },
      [KEY_3]: { kind: "quota" },
      [KEY_4]: { kind: "ok", chunks: ["تۆتىنچى ئاچقۇچتىن كەلدى"] },
    });

    await page.getByTestId("ai-question").fill("سوئال");
    await page.getByTestId("ai-send").click();

    // The reader did nothing and still got their answer.
    await expect(page.getByTestId("ai-answer")).toContainText("تۆتىنچى ئاچقۇچتىن كەلدى");
    await expect(page.getByTestId("ai-error")).toHaveCount(0);

    const calls = await geminiCalls(page);
    expect(calls.map((call) => call.key)).toEqual([KEY_1, KEY_2, KEY_3, KEY_4]);
    // The KEY changed four times. The MODEL never changed once.
    expect(new Set(calls.map((call) => call.model)).size).toBe(1);
    expect(calls[0].model).toBe("gemini-3.7-flash");
    await expect(page.getByTestId("ai-slot")).toContainText("4");
  });

  test("an overloaded model (503) fails over too, not just a quota error", async ({ page }) => {
    await enableWithKeys(page, [KEY_1, KEY_2]);
    await setGeminiBehaviour(page, {
      [KEY_1]: { kind: "busy" },
      [KEY_2]: { kind: "ok", chunks: ["ئىككىنچى ئاچقۇچ"] },
    });

    await page.getByTestId("ai-question").fill("سوئال");
    await page.getByTestId("ai-send").click();
    await expect(page.getByTestId("ai-answer")).toContainText("ئىككىنچى ئاچقۇچ");

    const calls = await geminiCalls(page);
    expect(calls.map((call) => call.key)).toEqual([KEY_1, KEY_2]);
  });

  test("only when all four are exhausted does an error appear", async ({ page }) => {
    await enableWithKeys(page, ALL_KEYS);
    await setGeminiBehaviour(page, {
      [KEY_1]: { kind: "quota" },
      [KEY_2]: { kind: "quota" },
      [KEY_3]: { kind: "quota" },
      [KEY_4]: { kind: "quota", retryDelay: "30s" },
    });

    await page.getByTestId("ai-question").fill("سوئال");
    await page.getByTestId("ai-send").click();

    const error = page.getByTestId("ai-error");
    await expect(error).toBeVisible({ timeout: 30_000 });
    await expect(error).toContainText("ھەققىڭىز توشۇپ قالدى");
    // Google's own wait, not a number we made up.
    await expect(error).toContainText("30 سېكۇنت");
    await expect(page.getByTestId("ai-answer")).toHaveCount(0);

    const calls = await geminiCalls(page);
    expect(new Set(calls.map((call) => call.key))).toEqual(new Set(ALL_KEYS));
    await assertNoHorizontalOverflow(page);
  });

  test("the slot that last worked is tried first next time", async ({ page }) => {
    await enableWithKeys(page, [KEY_1, KEY_2]);
    await setGeminiBehaviour(page, {
      [KEY_1]: { kind: "quota" },
      [KEY_2]: { kind: "ok", chunks: ["ئىككىنچىدىن"] },
    });

    await page.getByTestId("ai-question").fill("بىرىنچى سوئال");
    await page.getByTestId("ai-send").click();
    await expect(page.getByTestId("ai-answer")).toContainText("ئىككىنچىدىن");
    await expect(page.getByTestId("ai-last-good")).toBeVisible();

    // Both keys work now. The remembered one must still go first, so a reader
    // whose primary key is permanently spent stops paying a failed round trip.
    await setGeminiBehaviour(page, {
      [KEY_1]: { kind: "ok", chunks: ["بىرىنچىدىن"] },
      [KEY_2]: { kind: "ok", chunks: ["ئىككىنچىدىن يەنە"] },
    });
    await page.getByTestId("ai-question").fill("ئىككىنچى سوئال");
    await page.getByTestId("ai-send").click();
    await expect(page.getByTestId("ai-answer")).toContainText("ئىككىنچىدىن يەنە");

    const calls = await geminiCalls(page);
    expect(calls[0].key, "the remembered slot goes first").toBe(KEY_2);
    expect(calls).toHaveLength(1);
  });
});

/* ── Models ──────────────────────────────────────────────────────────────── */

test.describe("choosing a model", () => {
  test("every model is offered with its price badge, closed and open", async ({ page }) => {
    await page.goto("/my/ai");
    await tickTheSwitch(page);

    const picker = page.getByTestId("ai-model");
    // The closed control shows the selected option's own text, badge included.
    await expect(picker).toHaveValue("gemini-3.7-flash");
    const labels = await picker.locator("option").allTextContents();
    expect(labels).toEqual([
      "gemini-3.7-flash — ھەقسىز",
      "gemini-3.5-flash-lite — ھەقسىز",
      "gemini-3.1-pro-preview — پۇللۇق",
    ]);

    // Nobody has to open the list to learn a model costs money.
    await expect(page.getByTestId("ai-model-info")).toContainText("پۇللۇق");
    await expect(page.getByTestId("ai-pricing-link")).toHaveAttribute(
      "href",
      "https://ai.google.dev/pricing",
    );
    await assertNoHorizontalOverflow(page);
  });

  test("each of the three answers when the key suits it", async ({ page }) => {
    await enableWithKeys(page, [KEY_1]);
    for (const model of [
      "gemini-3.7-flash",
      "gemini-3.5-flash-lite",
      "gemini-3.1-pro-preview",
    ]) {
      await page.getByTestId("ai-model").selectOption(model);
      await setGeminiBehaviour(page, { [KEY_1]: { kind: "ok", chunks: [`جاۋاب: ${model}`] } });
      await page.getByTestId("ai-question").fill(`${model} سىنىقى`);
      await page.getByTestId("ai-send").click();
      await expect(page.getByTestId("ai-answer")).toContainText(`جاۋاب: ${model}`);

      const calls = await geminiCalls(page);
      expect(calls.map((call) => call.model)).toEqual([model]);
    }
  });

  test("a paid model on a key with no billing says exactly that, and switches nothing", async ({
    page,
  }) => {
    await enableWithKeys(page, ALL_KEYS);
    await page.getByTestId("ai-model").selectOption("gemini-3.1-pro-preview");
    await setGeminiBehaviour(page, Object.fromEntries(ALL_KEYS.map((key) => [key, { kind: "paid_only" as const }])));

    await page.getByTestId("ai-question").fill("سوئال");
    await page.getByTestId("ai-send").click();

    const error = page.getByTestId("ai-error");
    await expect(error).toBeVisible();
    // Named, explained, and not a generic failure.
    await expect(error).toContainText("gemini-3.1-pro-preview");
    await expect(error).toContainText("پۇللۇق مودېل");
    await expect(error).toContainText("billing");
    await expect(error).toContainText("ئۆزلۈكىدىن ئۆزگەرتىلمىدى");
    await expect(error).not.toContainText("ھەققىڭىز توشۇپ قالدى");

    // Cycling through four billing-less keys must not disguise it, and the
    // chosen model must still be the chosen model.
    const calls = await geminiCalls(page);
    expect(calls.every((call) => call.model === "gemini-3.1-pro-preview")).toBe(true);
    await expect(page.getByTestId("ai-model")).toHaveValue("gemini-3.1-pro-preview");
    await page.reload();
    await expect(page.getByTestId("ai-model")).toHaveValue("gemini-3.1-pro-preview");
    await assertNoHorizontalOverflow(page);
  });
});

/* ── Erasing ─────────────────────────────────────────────────────────────── */

test.describe("erasing everything", () => {
  test("takes all four keys and every trace of AI out of the browser", async ({ page }) => {
    await enableWithKeys(page, ALL_KEYS);
    await setGeminiBehaviour(page, { [KEY_1]: { kind: "ok", chunks: ["جاۋاب"] } });
    await page.getByTestId("ai-question").fill("سوئال");
    await page.getByTestId("ai-send").click();
    await expect(page.getByTestId("ai-answer")).toBeVisible();

    const before = await page.evaluate(
      (storageKeys: string[]) => storageKeys.filter((key) => localStorage.getItem(key) !== null),
      AI_STORAGE_KEYS,
    );
    expect(before.length).toBeGreaterThan(0);

    await page.getByTestId("ai-erase").click();
    await expect(page.getByTestId("ai-erased")).toBeVisible();

    const after = await page.evaluate(
      (storageKeys: string[]) => storageKeys.filter((key) => localStorage.getItem(key) !== null),
      AI_STORAGE_KEYS,
    );
    expect(after, "nothing AI wrote may survive").toEqual([]);

    // And the screen agrees: back to off, with no key fields at all.
    await expect(page.getByTestId("ai-enable")).not.toBeChecked();
    await expect(page.getByTestId("ai-key-0")).toHaveCount(0);

    await page.reload();
    await expect(page.getByTestId("ai-enable")).not.toBeChecked();
    await assertNoHorizontalOverflow(page);
  });
});

/* ── With no connection ──────────────────────────────────────────────────── */

test.describe("when the network is gone", () => {
  test("AI says so in Uyghur, reading carries on, and nothing is cached", async ({ page }) => {
    await enableWithKeys(page, [KEY_1, KEY_2]);
    await setGeminiBehaviour(page, {
      [KEY_1]: { kind: "offline" },
      [KEY_2]: { kind: "offline" },
    });

    await page.getByTestId("ai-question").fill("سوئال");
    await page.getByTestId("ai-send").click();

    const error = page.getByTestId("ai-error");
    await expect(error).toBeVisible();
    await expect(error).toContainText("ئىنتېرنېتقا باغلىنالمىدى");
    // The message has to say what still works, because most of the site does.
    await expect(error).toContainText("ئىنتېرنېتسىزمۇ");
    await expect(error).not.toContainText("Failed to fetch");

    // Not one AI request may sit in a cache: they are POSTs, which the service
    // worker declines outright, and they are sent `cache: "no-store"` besides.
    const cachedAi = await page.evaluate(async () => {
      if (typeof caches === "undefined") return [];
      const found: string[] = [];
      for (const name of await caches.keys()) {
        const cache = await caches.open(name);
        for (const request of await cache.keys()) {
          if (request.url.includes("generativelanguage")) found.push(request.url);
        }
      }
      return found;
    });
    expect(cachedAi, "an answer to somebody's question is not a cacheable asset").toEqual([]);

    // And the library itself is entirely unaffected. (The shell renders its
    // sidebar twice — the desktop rail and the mobile drawer — so the link is
    // there twice, which is why this checks the first rather than the count.)
    await page.goto("/");
    await expect(page.getByTestId("ai-sidebar-link").first()).toBeAttached();
    await assertNoHorizontalOverflow(page);
  });
});

/* ── The policy that lets any of this happen ─────────────────────────────── */

test.describe("the content security policy", () => {
  test("allows Google in connect-src and nowhere else", async ({ page }) => {
    const response = await page.goto("/my/ai");
    const policy = response!.headers()["content-security-policy"] ?? "";
    expect(policy).not.toBe("");

    const directives = Object.fromEntries(
      policy.split(";").map((part) => {
        const [name, ...values] = part.trim().split(/\s+/);
        return [name, values];
      }),
    ) as Record<string, string[]>;

    expect(directives["connect-src"]).toContain(GEMINI_ORIGIN);
    // One host, one directive. Everything else is untouched by the AI layer.
    const mentions = policy.split(GEMINI_ORIGIN).length - 1;
    expect(mentions, "the Gemini host belongs in connect-src only").toBe(1);
    expect(directives["script-src"]).not.toContain(GEMINI_ORIGIN);
    expect(directives["font-src"]).toEqual(["'self'"]);
    expect(directives["object-src"]).toEqual(["'none'"]);
  });
});
