import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test, expect, type Page } from "@playwright/test";
import { hasStaffTestEnv, loadEnvLocal } from "./env";

loadEnvLocal();

test.skip(!hasStaffTestEnv(), "Supabase env not configured");

/**
 * PROMPT-53 — the verse number as the Uthmani font's own medallion, and
 * every translation ending with its label: «[7]», or «[4 _ 6]» under the last
 * verse of a group whose earlier verses point to it. Anonymous throughout.
 */

/** A «(digits and separators)» verse marker — none may be left on the page. */
const MARKER = /\([\s0-9٠-٩\-–ـ،,‌‍]*[0-9٠-٩][\s0-9٠-٩\-–ـ،,‌‍]*\)/;

type Case = { sura: number; aya: number; clean: string };
const cases: Case[] = JSON.parse(
  readFileSync(join(process.cwd(), "tests", "fixtures", "quran-markers.json"), "utf-8"),
);
const text53_13 = cases.find((c) => c.sura === 53 && c.aya === 13)!.clean;

const verse = (page: Page, n: number) => page.locator(`[data-testid="aya"][data-aya="${n}"]`);

async function assertNoHorizontalOverflow(page: Page) {
  const metrics = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(metrics.scrollWidth, "page must not scroll horizontally").toBeLessThanOrEqual(
    metrics.innerWidth + 1,
  );
}

/** both → ar → ug: the toggle cycles, and the choice is kept in this browser. */
async function translationOnly(page: Page) {
  const toggle = page.getByTestId("translation-toggle");
  await toggle.click();
  await expect(page.getByTestId("aya-uyghur")).toHaveCount(0);
  await toggle.click();
  await expect(page.getByTestId("aya-arabic")).toHaveCount(0);
}

test("Al-Fatiha ends every translation with its own label [1]…[7]", async ({ page }) => {
  await page.goto("/quran/1");
  await expect(page.getByTestId("aya")).toHaveCount(7);
  await expect(page.getByTestId("aya-label")).toHaveText(["[1]", "[2]", "[3]", "[4]", "[5]", "[6]", "[7]"]);
  for (const text of await page.getByTestId("aya-uyghur").allInnerTexts()) {
    expect(text.trim()).toMatch(/ \[[1-7]\]$/);
    expect(text).not.toMatch(MARKER);
  }
  await expect(page.getByTestId("aya-group-pointer")).toHaveCount(0);
});

test("4:160–161 shows one translation under 161 and a pointer under 160", async ({ page }) => {
  await page.goto("/quran/4?aya=160");
  const first = verse(page, 160);
  const last = verse(page, 161);
  await expect(first).toBeVisible();

  await expect(first.getByTestId("aya-uyghur")).toHaveCount(0);
  const pointer = first.getByTestId("aya-group-pointer");
  await expect(pointer).toHaveText("تەرجىمىسى 161-ئايەتنىڭ ئاستىدا [160 _ 161]");
  const box = await pointer.boundingBox();
  expect(box!.height, "the pointer is a ≥ 44 px target").toBeGreaterThanOrEqual(44);

  const translation = (await last.getByTestId("aya-uyghur").innerText()).trim();
  expect(translation.endsWith(" [160 _ 161]"), translation.slice(-40)).toBe(true);
  expect(translation, "no verse marker inside the translation").not.toMatch(MARKER);
  await assertNoHorizontalOverflow(page);
});

test("53:13–14 shows the longer text once, under 14", async ({ page }) => {
  await page.goto("/quran/53?aya=13");
  await expect(verse(page, 13).getByTestId("aya-group-pointer")).toHaveText(
    "تەرجىمىسى 14-ئايەتنىڭ ئاستىدا [13 _ 14]",
  );
  const translation = (await verse(page, 14).getByTestId("aya-uyghur").innerText()).trim();
  expect(translation.startsWith(text53_13.slice(0, 24)), "53:13's (the longer) text").toBe(true);
  expect(translation.endsWith(" [13 _ 14]")).toBe(true);
});

test("the pointer scrolls to the group's last verse and selects it", async ({ page }) => {
  await page.goto("/quran/4?aya=160");
  await verse(page, 160).getByTestId("aya-group-pointer").click();
  const last = verse(page, 161);
  await expect(last).toHaveClass(/selected/);
  await expect(verse(page, 160)).not.toHaveClass(/selected/);
  await expect(last.getByTestId("aya-uyghur")).toBeInViewport();
  await expect(last.getByTestId("aya-number")).toBeFocused();
});

test("the verse number is the font's medallion at 1.75 em, a ≥ 44 px button", async ({ page }) => {
  await page.goto("/quran/4");
  const row = verse(page, 160);
  const number = row.getByTestId("aya-number");
  await expect(number).toBeVisible();

  const measured = await number.evaluate((button) => {
    const style = getComputedStyle(button);
    const text = getComputedStyle(button.parentElement!);
    return {
      ratio: parseFloat(style.fontSize) / parseFloat(text.fontSize),
      family: style.fontFamily,
      ligatures: style.fontVariantLigatures,
      features: style.fontFeatureSettings,
      border: style.borderTopWidth,
      background: style.backgroundColor,
    };
  });
  expect(measured.ratio).toBeCloseTo(1.75, 1);
  expect(measured.family).toContain("Uthmanic Hafs");
  expect(measured.ligatures, "liga stays on").not.toBe("none");
  expect(measured.features).not.toMatch(/liga.*0|liga.*off/);
  expect(measured.border, "no drawn circle").toBe("0px");
  expect(measured.background).toMatch(/rgba\(0, 0, 0, 0\)|transparent/);

  const box = await number.boundingBox();
  expect(box!.width).toBeGreaterThanOrEqual(44);
  expect(box!.height).toBeGreaterThanOrEqual(44);

  // Still the verse's action trigger, by keyboard too.
  await number.focus();
  await page.keyboard.press("Enter");
  await expect(row.getByTestId("aya-actions")).toBeVisible();
  await expect(number).toHaveAttribute("aria-expanded", "true");
});

test("the translation-only mode opens each verse with its number, groups included", async ({ page }) => {
  await page.goto("/quran/4?aya=160");
  await translationOnly(page);

  const pointerRow = verse(page, 160).getByTestId("aya-uyghur-pointer");
  await expect(pointerRow.getByTestId("aya-number")).toBeVisible();
  await expect(pointerRow.getByTestId("aya-group-pointer")).toBeVisible();

  const last = verse(page, 161).getByTestId("aya-uyghur");
  const number = last.getByTestId("aya-number");
  await expect(number).toBeVisible();
  const box = await number.boundingBox();
  expect(box!.width).toBeGreaterThanOrEqual(44);
  expect(box!.height).toBeGreaterThanOrEqual(44);
  expect((await last.innerText()).trim().endsWith("[160 _ 161]")).toBe(true);

  await number.click();
  await expect(verse(page, 161).getByTestId("aya-actions")).toBeVisible();
  await assertNoHorizontalOverflow(page);
});

test("no horizontal scroll at 360 px", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  for (const path of ["/quran/1", "/quran/4?aya=160", "/quran/53?aya=13"]) {
    await page.goto(path);
    await expect(page.getByTestId("aya").first()).toBeVisible();
    await assertNoHorizontalOverflow(page);
  }
  await translationOnly(page);
  await assertNoHorizontalOverflow(page);
});

test("copying a verse of a group copies the group's translation with its label", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/quran/4?aya=160");
  const first = verse(page, 160);
  await expect(first).toBeVisible();
  const actions = first.getByTestId("aya-actions");
  if (!(await actions.isVisible())) await first.getByTestId("aya-number").click();
  await expect(actions).toBeVisible();

  const groupTranslation = (await verse(page, 161).getByTestId("aya-uyghur").innerText())
    .trim()
    .replace(/ \[160 _ 161\]$/, "");

  await actions.getByTestId("copy-with-translation").click();
  await expect(page.getByTestId("quran-toast")).toHaveText("ئايەت تەرجىمىسى بىلەن كۆچۈرۈلدى");
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toContain(`«${groupTranslation}» [160 _ 161]`);
  // One verse's Arabic: 160's only.
  expect(copied.match(/﴿/g)).toHaveLength(1);
});

test("Qur'an search lists a group once, with its label", async ({ page }) => {
  // The words of 4:160–161's shared translation find both verses.
  await page.goto("/quran/4?aya=161");
  const words = (await verse(page, 161).getByTestId("aya-uyghur").innerText())
    .trim()
    .split(/\s+/)
    .slice(1, 4)
    .join(" ");

  await page.goto(`/quran?q=${encodeURIComponent(words)}`);
  await expect(page.getByTestId("quran-search-results")).toBeVisible();
  const card = page.locator('[data-testid="quran-search-result"][data-sura="4"][data-group="160-161"]');
  await expect(card).toHaveCount(1);
  await expect(card.getByTestId("quran-hit-arabic")).toHaveCount(2);
  await expect(card.getByTestId("quran-hit-uyghur")).toContainText("[160 _ 161]");
  await expect(page.locator('[data-testid="quran-search-result"][data-sura="4"][data-aya="161"]')).toHaveCount(0);

  const cards = await page.getByTestId("quran-search-result").count();
  await expect(page.getByTestId("quran-search-meta")).toContainText(`بۇ بەتتە ${cards} نەتىجە`);
  await assertNoHorizontalOverflow(page);
});
