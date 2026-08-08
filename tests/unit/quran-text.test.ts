import { describe, expect, it } from "vitest";
import {
  SURA_META,
  TOTAL_AYAS,
  buildAyaRows,
  buildSuraRows,
  checkIntegrity,
  cleanUyghurTranslation,
  parseTanzil,
  parseUyghurXml,
  stripBasmalaPrefix,
  stripTashkil,
} from "@/scripts/quran-text.mjs";

/**
 * The seeder writes reference text that must never drift, so these assert on
 * exact codepoints rather than on rendered shapes.
 */
const BASMALA_UTHMANI = "بِسْمِ ٱللَّهِ ٱلرَّحْمَٰنِ ٱلرَّحِيمِ";
const BASMALA_PLAIN = "بسم الله الرحمن الرحيم";

describe("stripTashkil", () => {
  it("removes tashkil and unifies alif variants", () => {
    expect(stripTashkil(BASMALA_UTHMANI)).toBe(BASMALA_PLAIN);
  });

  it("maps every alif variant to a plain alif", () => {
    // ٱ آ أ إ → ا
    expect(stripTashkil("ٱآأإ")).toBe("اااا");
  });

  it("drops tatweel and the Quranic annotation marks", () => {
    // Tatweel (U+0640) and the small high signs U+06D6..U+06ED.
    expect(stripTashkil("مـمۚ")).toBe("مم");
  });

  it("collapses whitespace runs and trims", () => {
    expect(stripTashkil("  مم   ن  ")).toBe("مم ن");
  });

  it("returns an empty string for empty input", () => {
    expect(stripTashkil("")).toBe("");
    expect(stripTashkil(null)).toBe("");
  });
});

describe("stripBasmalaPrefix", () => {
  it("removes a leading basmala together with the separator that follows it", () => {
    const verse = "الٓمٓ"; // الٓمٓ (2:1)
    expect(stripBasmalaPrefix(`${BASMALA_UTHMANI} ${verse}`)).toBe(verse);
  });

  it("leaves a verse that does not open with the basmala untouched", () => {
    // 9:1 — At-Tawba has no basmala at all.
    const tawba = "بَريْءٌ";
    expect(stripBasmalaPrefix(tawba)).toBe(tawba);
  });

  it("keeps a basmala that sits inside the verse (27:30)", () => {
    const verse = `إِنَّهُۥ مِن سُليْمَٰنَ وَإِنَّهُۥ ${BASMALA_UTHMANI}`;
    expect(stripBasmalaPrefix(verse)).toBe(verse);
  });

  it("matches whatever alif and diacritic spelling the source uses", () => {
    // Same words, plain alif and no tashkil at all.
    expect(stripBasmalaPrefix(`${BASMALA_PLAIN} abc`)).toBe("abc");
  });

  it("passes empty input straight through", () => {
    expect(stripBasmalaPrefix("")).toBe("");
  });
});

describe("cleanUyghurTranslation", () => {
  it("removes the tafsir citation markers the Saleh translation carries", () => {
    expect(cleanUyghurTranslation("قىيامەت(4).")).toBe(
      "قىيامەت.",
    );
    expect(cleanUyghurTranslation("a(2،3) b[12] c")).toBe("a b c");
  });

  it("collapses whitespace left behind and trims", () => {
    expect(cleanUyghurTranslation("  a   b  ")).toBe("a b");
  });
});

describe("SURA_META", () => {
  it("holds all 114 suras, numbered in order", () => {
    expect(SURA_META).toHaveLength(114);
    expect(SURA_META.map((sura) => sura.n)).toEqual(
      Array.from({ length: 114 }, (_, index) => index + 1),
    );
  });

  it("adds up to the 6,236 ayas of the Quran", () => {
    const total = SURA_META.reduce((sum, sura) => sum + sura.count, 0);
    expect(total).toBe(TOTAL_AYAS);
    expect(total).toBe(6236);
  });

  it("gives every sura an Arabic name, a Uyghur name and a revelation place", () => {
    for (const sura of SURA_META) {
      expect(sura.ar.length, `sura ${sura.n} Arabic name`).toBeGreaterThan(0);
      expect(sura.ug.length, `sura ${sura.n} Uyghur name`).toBeGreaterThan(0);
      expect(sura.tr.length, `sura ${sura.n} transliteration`).toBeGreaterThan(0);
      expect(["meccan", "medinan"]).toContain(sura.rev);
      expect(sura.count).toBeGreaterThan(0);
    }
  });

  it("keeps the well-known aya counts", () => {
    const counts = new Map(SURA_META.map((sura) => [sura.n, sura.count]));
    expect(counts.get(1)).toBe(7); // Al-Fatiha
    expect(counts.get(2)).toBe(286); // Al-Baqara
    expect(counts.get(9)).toBe(129); // At-Tawba
    expect(counts.get(114)).toBe(6); // An-Nas
  });

  it("builds sura rows in the shape quran_suras stores", () => {
    const rows = buildSuraRows();
    expect(rows).toHaveLength(114);
    expect(rows[0]).toEqual({
      number: 1,
      name_ar: "الفاتحة",
      name_ug: "فاتىھە",
      name_translit: "Al-Fatiha",
      revelation: "meccan",
      aya_count: 7,
    });
  });
});

describe("parseTanzil", () => {
  it("reads sura|aya|text lines and skips comments", () => {
    const parsed = parseTanzil(["# a comment", "1|1|alif", "", "2|3|ba", "broken line"].join("\n"));
    expect(parsed[1][1]).toBe("alif");
    expect(parsed[2][3]).toBe("ba");
    expect(Object.keys(parsed)).toHaveLength(2);
  });
});

describe("parseUyghurXml", () => {
  const xml = `<translation_root><sura_list>
<sura number="1">
<aya number="1"><translation><![CDATA[بىر(1).]]></translation><footnotes></footnotes></aya>
<aya number="2"><translation><![CDATA[ئىككى]]></translation><footnotes></footnotes></aya>
</sura>
<sura number="2">
<aya number="1"><translation><![CDATA[ۇچ]]></translation></aya>
</sura>
</sura_list></translation_root>`;

  it("returns a sura → aya → text map", () => {
    const parsed = parseUyghurXml(xml);
    expect(Object.keys(parsed)).toHaveLength(2);
    expect(parsed[1][2]).toBe("ئىككى");
    expect(parsed[2][1]).toBe("ۇچ");
  });

  it("unwraps CDATA and drops the trailing verse-number marker", () => {
    expect(parseUyghurXml(xml)[1][1]).toBe("بىر");
  });
});

describe("buildAyaRows", () => {
  /**
   * Arabic for every aya of every sura. Aya 1 opens with the basmala
   * everywhere, exactly as the Uthmani source spells it — that is the case
   * the basmala rule has to get right.
   */
  function completeArabic(): Record<number, Record<number, string>> {
    const map: Record<number, Record<number, string>> = {};
    for (const sura of SURA_META) {
      map[sura.n] = {};
      for (let aya = 1; aya <= sura.count; aya++) {
        map[sura.n][aya] = aya === 1 ? `${BASMALA_UTHMANI} verse` : "verse";
      }
    }
    return map;
  }

  it("produces exactly 6,236 rows, one per aya", () => {
    const rows = buildAyaRows(completeArabic(), {});
    expect(rows).toHaveLength(TOTAL_AYAS);
    expect(rows[0]).toMatchObject({ sura: 1, aya: 1 });
    expect(rows[rows.length - 1]).toMatchObject({ sura: 114, aya: 6 });
  });

  it("strips the basmala from aya 1 of every sura except Al-Fatiha", () => {
    const rows = buildAyaRows(completeArabic(), {});
    const firstAyas = rows.filter((row) => row.aya === 1);
    expect(firstAyas).toHaveLength(114);
    for (const row of firstAyas) {
      // Al-Fatiha's first aya IS the basmala, so it must survive untouched.
      if (row.sura === 1) expect(row.text_ar).toBe(`${BASMALA_UTHMANI} verse`);
      else expect(row.text_ar, `sura ${row.sura}`).toBe("verse");
    }
  });

  it("refuses to write a placeholder when the Arabic side is incomplete", () => {
    const map = completeArabic();
    delete map[2][5];
    expect(() => buildAyaRows(map, {})).toThrow(/2:5/);
  });

  it("cleans the Uyghur translation as it goes", () => {
    const rows = buildAyaRows(completeArabic(), { 1: { 1: "بىر(1)." } });
    expect(rows[0].text_ug).toBe("بىر.");
  });
});

describe("checkIntegrity", () => {
  function completeArabic(): Record<number, Record<number, string>> {
    const map: Record<number, Record<number, string>> = {};
    for (const sura of SURA_META) {
      map[sura.n] = {};
      for (let aya = 1; aya <= sura.count; aya++) map[sura.n][aya] = "verse";
    }
    return map;
  }

  it("accepts a complete Arabic source", () => {
    const { errors, totalAr } = checkIntegrity(completeArabic(), {});
    expect(errors).toEqual([]);
    expect(totalAr).toBe(TOTAL_AYAS);
  });

  it("reports a sura whose aya count does not match SURA_META", () => {
    const map = completeArabic();
    delete map[112][4];
    const { errors } = checkIntegrity(map, {});
    expect(errors.join("\n")).toMatch(/Sura 112/);
  });

  it("reports missing translations as warnings, not as errors", () => {
    const { errors, warnings } = checkIntegrity(completeArabic(), {});
    expect(errors).toEqual([]);
    expect(warnings).toHaveLength(TOTAL_AYAS);
  });
});
