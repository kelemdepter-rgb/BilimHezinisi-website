import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  DEFAULT_SETTINGS,
  FONT_STACKS,
  READER_FONTS,
  clampSettings,
} from "@/lib/reader/settings";

/**
 * Three fonts were removed because their licences forbid redistribution:
 * Bahij Nazanin ("Not for reproduction, distribution or commercial use") and
 * Monotype's Traditional Arabic, a "Microsoft supplied font" that ships with
 * Windows. Putting any of them back into public/fonts/ would make every page
 * load an unlicensed copy, so it has to fail the build, not a code review.
 */
const FORBIDDEN = [
  "Bahij_Nazanin-Regular.ttf",
  "trad-arabic.ttf",
  "trad-arabic-bold.ttf",
];

const FONTS_DIR = join(process.cwd(), "public", "fonts");

describe("shipped fonts", () => {
  const shipped = readdirSync(FONTS_DIR);

  it("does not redistribute any font we have no licence for", () => {
    for (const name of FORBIDDEN) {
      expect(shipped, `${name} may not be served — see THIRD-PARTY-NOTICES.md`).not.toContain(
        name,
      );
    }
  });

  it("declares no @font-face for a font we do not ship", () => {
    const css = readFileSync(join(process.cwd(), "app", "globals.css"), "utf8");
    const urls = [...css.matchAll(/url\("\/fonts\/([^"]+)"\)/g)].map((match) => match[1]);

    expect(urls.length).toBeGreaterThan(0);
    for (const url of urls) {
      expect(shipped, `@font-face points at a missing file: ${url}`).toContain(url);
    }
    for (const name of FORBIDDEN) {
      expect(css).not.toContain(name);
    }
  });

  it("keeps the Quran fonts in their original .otf form", () => {
    // KFGQPC's licence permits redistribution but forbids modifying the font
    // software, and converting to woff2 modifies it.
    expect(shipped).toContain("UthmanicHafs1-Ex1-Ver12.otf");
    expect(shipped).toContain("UthmanicHafs1B-Ex1-Ver12.otf");
    expect(shipped.filter((name) => name.startsWith("UthmanicHafs"))).toHaveLength(2);
  });

  it("serves every font it does ship as woff2", () => {
    const ours = shipped.filter((name) => !name.startsWith("UthmanicHafs"));
    expect(ours.length).toBeGreaterThan(0);
    for (const name of ours) {
      expect(name.endsWith(".woff2"), `${name} should be woff2`).toBe(true);
    }
  });
});

describe("the reader's font picker", () => {
  it("offers only fonts we serve or resolve from the reader's own system", () => {
    const shipped = readdirSync(FONTS_DIR);
    // 'Traditional Arabic' is the one system-resolved family: named in the
    // stack, never served. Everything else must have a file behind it.
    for (const font of READER_FONTS) {
      const families = FONT_STACKS[font].match(/'([^']+)'/g) ?? [];
      expect(families.length).toBeGreaterThan(0);
      expect(FONT_STACKS[font]).not.toContain("Bahij");
    }
    expect(shipped.some((name) => name.startsWith("ukijekran"))).toBe(true);
  });

  it("offers more choices than the three it had before the clean-up", () => {
    expect(READER_FONTS.length).toBeGreaterThan(3);
  });
});

describe("readers who had a removed font selected", () => {
  it("silently falls back to the default instead of throwing", () => {
    const stored = { fontSize: 22, lineHeight: 2.4, font: "bahij" } as never;
    const settings = clampSettings(stored);

    expect(settings.font).toBe(DEFAULT_SETTINGS.font);
    // Their other choices survive — only the font they can no longer have moves.
    expect(settings.fontSize).toBe(22);
    expect(settings.lineHeight).toBe(2.4);
    expect(FONT_STACKS[settings.font]).toBeDefined();
  });

  it("keeps a font that is still offered", () => {
    expect(clampSettings({ font: "tuzkitab" }).font).toBe("tuzkitab");
    expect(clampSettings({ font: "trad" }).font).toBe("trad");
  });
});
