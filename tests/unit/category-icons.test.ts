import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { IconSprite } from "@/components/icons";
import { CATEGORY_SYMBOL_NAMES, CategoryIconSprite } from "@/components/category-icons";
import { CATEGORY_ICON_GROUPS, CATEGORY_ICON_OPTIONS } from "@/lib/category-icons";

/** The ids a sprite defines, without the `i-` prefix. */
function symbolIds(html: string): string[] {
  return [...html.matchAll(/<symbol id="i-([^"]+)"/g)].map((match) => match[1]);
}

const shared = new Set(symbolIds(renderToStaticMarkup(createElement(IconSprite))));

describe("category icon picker", () => {
  it("offers only pictures that exist, in one sprite or the other", () => {
    for (const option of CATEGORY_ICON_OPTIONS) {
      const drawn = shared.has(option.name) || CATEGORY_SYMBOL_NAMES.includes(option.name as never);
      expect(drawn, `${option.name} has no symbol`).toBe(true);
    }
  });

  it("offers every category-only picture, so none is drawn for nothing", () => {
    const offered = new Set(CATEGORY_ICON_OPTIONS.map((option) => option.name));
    for (const name of CATEGORY_SYMBOL_NAMES) expect(offered.has(name), name).toBe(true);
  });

  it("never draws one id in both sprites", () => {
    for (const name of CATEGORY_SYMBOL_NAMES) expect(shared.has(name), name).toBe(false);
  });

  it("names each picture once, in Uyghur only", () => {
    const names = CATEGORY_ICON_OPTIONS.map((option) => option.name);
    const labels = CATEGORY_ICON_OPTIONS.map((option) => option.label);
    expect(new Set(names).size).toBe(names.length);
    expect(new Set(labels).size).toBe(labels.length);
    for (const label of [...labels, ...CATEGORY_ICON_GROUPS.map((group) => group.label)]) {
      expect(label, label).not.toMatch(/[A-Za-z]/);
      expect(label.trim()).not.toBe("");
    }
  });

  it("keeps the crescent and star, and starts on the default folder", () => {
    expect(CATEGORY_ICON_OPTIONS[0]).toEqual({ name: "folder", label: "ھۆججەت قىسقۇچ" });
    expect(CATEGORY_ICON_OPTIONS).toContainEqual({ name: "crescent-star", label: "ئاي يۇلتۇز" });
  });

  it("still offers every picture the live categories wore before", () => {
    // What the library's twenty categories used on 2026-11-19.
    const worn = ["mosque", "scroll", "scale", "star", "landmark", "feather", "languages",
      "book-marked", "folder", "notebook-pen", "book-open", "smile"];
    const offered = new Set<string>(CATEGORY_ICON_OPTIONS.map((option) => option.name));
    for (const name of worn) expect(offered.has(name), name).toBe(true);
  });
});

describe("CategoryIconSprite", () => {
  const render = (names: string[]) => renderToStaticMarkup(createElement(CategoryIconSprite, { names }));

  it("draws only the category-only pictures asked for, each once", () => {
    const ids = symbolIds(render(["kaaba", "book", "kaaba", "lantern", "no-such-icon"]));
    expect(ids).toEqual(["kaaba", "lantern"]);
  });

  it("renders nothing when no category wears a category-only picture", () => {
    expect(render(["book", "mosque", "folder"])).toBe("");
    expect(render([])).toBe("");
  });
});
