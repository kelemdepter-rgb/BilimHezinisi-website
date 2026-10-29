import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  SURA_META,
  TOTAL_AYAS,
  cleanUyghurTranslation,
  multiVerseGroups,
  parseUyghurXml,
} from "@/scripts/quran-text.mjs";
import { GROUP_TEXT_AYA, QURAN_GROUPS } from "@/lib/quran/groups.generated";
import { groupQuranHits } from "@/lib/quran/search-groups";
import { groupOf, groupTextAya, label, unitOf, units, withLabel } from "@/lib/quran/verse-label";
import { unitText } from "@/lib/quran/copy";
import type { Aya, QuranHit } from "@/lib/quran/types";

/**
 * PROMPT-53 — the verse labels «[7]» / «[4 _ 6]» and the 186 translation
 * groups, ported from the desktop's 3.6 (`src/verse-label.js`,
 * `scripts/seed-quran.js`).
 */

/** A «(digits and separators)» verse marker, wherever it stands. */
const MARKER = /\([\s0-9٠-٩\-–ـ،,‌‍]*[0-9٠-٩][\s0-9٠-٩\-–ـ،,‌‍]*\)/;

describe("label", () => {
  it("writes [7] for a verse and [4 _ 6] for a group, Western digits, no isolation", () => {
    expect(label(7)).toBe("[7]");
    expect(label(7, 7)).toBe("[7]");
    expect(label(4, 6)).toBe("[4 _ 6]");
    // Exactly «[», from, « _ » (U+005F with a space each side), to, «]».
    expect([...label(160, 161)].map((c) => c.codePointAt(0))).toEqual(
      [..."[160 _ 161]"].map((c) => c.codePointAt(0)),
    );
    expect(label(4, 6)).not.toMatch(/[⁦-⁩‎‏‪-‮]/);
  });

  it("follows the translation with a space, and gives nothing for no translation", () => {
    expect(withLabel("ئىگىسىدۇر.", 4)).toBe("ئىگىسىدۇر. [4]");
    expect(withLabel("  مەتىن ", 4, 6)).toBe("مەتىن [4 _ 6]");
    expect(withLabel("", 4)).toBe("");
  });
});

describe("the generated group table", () => {
  it("holds 186 groups with the measured sizes", () => {
    expect(QURAN_GROUPS).toHaveLength(186);
    const sizes = new Map<number, number>();
    for (const [, from, to] of QURAN_GROUPS) {
      sizes.set(to - from + 1, (sizes.get(to - from + 1) ?? 0) + 1);
    }
    // 185 identical runs (149×2, 24×3, 6×4, 3×5, 2×6, 1×7) and 53:13–14.
    expect(Object.fromEntries(sizes)).toEqual({ 2: 150, 3: 24, 4: 6, 5: 3, 6: 2, 7: 1 });
  });

  it("joins 53:13–14 and 23:55–56 (written «(56- 55)» in the file)", () => {
    expect(groupOf(53, 13)).toEqual({ from: 13, to: 14 });
    expect(groupOf(53, 14)).toEqual({ from: 13, to: 14 });
    expect(groupOf(23, 55)).toEqual({ from: 55, to: 56 });
    expect(groupOf(4, 161)).toEqual({ from: 160, to: 161 });
    expect(groupOf(1, 4)).toEqual({ from: 4, to: 4 });
  });

  it("has groups in order, inside one sura each, never overlapping", () => {
    let previous: readonly [number, number, number] | null = null;
    for (const group of QURAN_GROUPS) {
      const [sura, from, to] = group;
      const meta = SURA_META[sura - 1];
      expect(meta.n).toBe(sura);
      expect(from).toBeGreaterThanOrEqual(1);
      expect(to).toBeGreaterThan(from);
      expect(to, `${sura}:${from}-${to}`).toBeLessThanOrEqual(meta.count);
      if (previous && previous[0] === sura) expect(from).toBeGreaterThan(previous[2]);
      if (previous) expect(sura).toBeGreaterThanOrEqual(previous[0]);
      previous = group;
    }
  });

  it("names 53:13 as the text of 53:13–14 and no other group as uneven", () => {
    expect(GROUP_TEXT_AYA).toEqual([[53, 13, 13]]);
    expect(groupTextAya(53, 14)).toBe(13);
    expect(groupTextAya(4, 160)).toBeNull();
    expect(groupTextAya(1, 4)).toBeNull();
  });
});

const aya = (sura: number, n: number, text_ug: string): Aya => ({
  sura,
  aya: n,
  text_ar: `ar ${sura}:${n}`,
  text_ug,
});

describe("units", () => {
  it("makes a run of a group's verses one unit with the longer text", () => {
    const rows = [aya(53, 12, "a"), aya(53, 13, "ئۇزۇن مەتىن"), aya(53, 14, "مەتىن"), aya(53, 15, "b")];
    const out = units(rows);
    expect(out.map((u) => [u.from, u.to, u.ayas.length, u.text, u.label])).toEqual([
      [12, 12, 1, "a", "[12]"],
      [13, 14, 2, "ئۇزۇن مەتىن", "[13 _ 14]"],
      [15, 15, 1, "b", "[15]"],
    ]);
  });

  it("writes a group's translation once when the run covers it", () => {
    const [unit] = units([aya(4, 160, "t"), aya(4, 161, "t")]);
    expect(unitText(unit, "both")).toBe("﴿ar 4:160﴾ ﴿ar 4:161﴾ «t» [160 _ 161]");
    expect(unitText(unit, "ug")).toBe("«t» [160 _ 161]");
  });

  it("gives one verse of a group the group's translation and label", () => {
    const sura = [aya(53, 13, "ئۇزۇن مەتىن"), aya(53, 14, "مەتىن")];
    const unit = unitOf(sura[1], sura);
    expect(unit.ayas).toHaveLength(1);
    expect(unitText(unit, "both")).toBe("﴿ar 53:14﴾ «ئۇزۇن مەتىن» [13 _ 14]");
    expect(unitText(unitOf(aya(1, 7, "x"), []), "ug")).toBe("«x» [7]");
  });
});

const hit = (sura: number, n: number, text_ug: string): QuranHit => ({
  sura,
  aya: n,
  sura_name_ar: "س",
  sura_name_ug: "س",
  text_ar: `ar ${n}`,
  text_ug,
  rank: 1,
});

describe("Qur'an search cards", () => {
  it("lists a group once, with each found verse's Arabic, in the hits' order", () => {
    const cards = groupQuranHits([hit(4, 161, "t"), hit(1, 4, "u"), hit(4, 160, "t")]);
    expect(cards.map((c) => [c.sura, c.from, c.to, c.label, c.verses.map((v) => v.aya)])).toEqual([
      [4, 160, 161, "[160 _ 161]", [160, 161]],
      [1, 4, 4, "[4]", [4]],
    ]);
    expect(cards.every((c) => c.needsTextOf === null)).toBe(true);
  });

  it("asks for 53:13's text only when 53:14 was found without it", () => {
    expect(groupQuranHits([hit(53, 14, "short")])[0].needsTextOf).toBe(13);
    const both = groupQuranHits([hit(53, 14, "short"), hit(53, 13, "the longer one")]);
    expect(both[0]).toMatchObject({ text_ug: "the longer one", needsTextOf: null });
  });
});

/**
 * The cleaner never changes a letter or a punctuation mark: tried over a
 * dozen raw translations that hold every odd marker the file has. Committed,
 * so it always runs.
 */
type Case = { sura: number; aya: number; note: string; raw: string; clean: string };
const cases: Case[] = JSON.parse(
  readFileSync(join(process.cwd(), "tests", "fixtures", "quran-markers.json"), "utf-8"),
);

/** What the cleaner may remove: marker groups and whitespace, nothing more. */
function expectOnlyMarkersRemoved(raw: string, clean: string, where: string) {
  const markersOut = raw.replace(/\([^()]*\)/g, (group) => (MARKER.test(group) ? "" : group));
  expect(clean.replace(/\s+/g, ""), where).toBe(markersOut.replace(/\s+/g, ""));
  expect(clean, where).not.toMatch(MARKER);
  expect(clean, where).toBe(clean.trim());
  expect(clean, where).not.toMatch(/\s{2}/);
}

describe("cleanUyghurTranslation on the committed odd cases", () => {
  it.each(cases.map((c) => [`${c.sura}:${c.aya} — ${c.note}`, c] as const))("%s", (_name, c) => {
    expect(cleanUyghurTranslation(c.raw)).toBe(c.clean);
    expectOnlyMarkersRemoved(c.raw, c.clean, `${c.sura}:${c.aya}`);
  });

  it("keeps 58:4's parentheses with words", () => {
    const verse = cases.find((c) => c.sura === 58 && c.aya === 4)!;
    expect(verse.clean).toContain("(60 مىسكىنگە بىر ۋاخ تاماق بېرىشى لازىم)");
  });
});

const XML = join(process.cwd(), "migration-data", "uyghur_saleh_v1.0.2-xml.1.xml");
const haveXml = existsSync(XML);
if (!haveXml) {
  console.warn(
    "[quran-labels] SKIPPED the whole-corpus checks: migration-data/uyghur_saleh_v1.0.2-xml.1.xml " +
      "is not on this machine (it is gitignored; copy it from the desktop's assets/seed/).",
  );
}

describe.skipIf(!haveXml)("the whole translation (needs migration-data/, skipped without it)", () => {
  const map = haveXml ? parseUyghurXml(readFileSync(XML, "utf-8")) : {};

  it("removes only marker groups and whitespace from all 6,236 verses", () => {
    let verses = 0;
    for (const sura of Object.keys(map).map(Number)) {
      for (const n of Object.keys(map[sura]).map(Number)) {
        const raw = map[sura][n];
        expectOnlyMarkersRemoved(raw, cleanUyghurTranslation(raw), `${sura}:${n}`);
        // Not a letter lost: the same letters, in the same number. The
        // tatweel is a letter to Unicode (Lm) and a separator in a marker,
        // so it is counted only outside the markers.
        const letters = (s: string) =>
          (s.replace(/\([^()]*\)/g, (g) => (MARKER.test(g) ? "" : g)).match(/\p{L}/gu) ?? []).length;
        expect(letters(cleanUyghurTranslation(raw)), `${sura}:${n}`).toBe(letters(raw));
        verses++;
      }
    }
    expect(verses).toBe(TOTAL_AYAS);
  });

  it("matches the committed group table exactly", () => {
    const groups = multiVerseGroups(map);
    expect(groups.map((g) => [g.sura, g.from, g.to])).toEqual(QURAN_GROUPS.map((g) => [...g]));
    expect(groups.filter((g) => !g.same).map((g) => [g.sura, g.from, g.textAya])).toEqual(
      GROUP_TEXT_AYA.map((g) => [...g]),
    );
  });

  it("carries the committed odd cases as the file has them", () => {
    for (const c of cases) expect(map[c.sura][c.aya], `${c.sura}:${c.aya}`).toBe(c.raw);
  });
});
