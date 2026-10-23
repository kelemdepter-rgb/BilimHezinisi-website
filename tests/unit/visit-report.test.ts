import { describe, expect, it } from "vitest";
import { EAST_TURKISTAN } from "@/lib/visits/count";
import { countryName, isOwnCode, parseCountryVisitReport, shareOf } from "@/lib/visits/report";

describe("reading the database's answer", () => {
  it("turns the jsonb into rows and totals", () => {
    const report = parseCountryVisitReport({
      since: "2026-10-22",
      rows: [
        { country: "TR", d7: 5, d30: 20, total: 40 },
        { country: "DE", d7: "1", d30: 3, total: 9 },
      ],
    });
    expect(report).toEqual({
      available: true,
      since: "2026-10-22",
      rows: [
        { country: "TR", d7: 5, d30: 20, total: 40 },
        { country: "DE", d7: 1, d30: 3, total: 9 },
      ],
      totals: { d7: 6, d30: 23, total: 49 },
    });
  });

  it("reads an empty tally as empty — available, with nothing in it", () => {
    expect(parseCountryVisitReport({ since: null, rows: [] })).toEqual({
      available: true,
      since: null,
      rows: [],
      totals: { d7: 0, d30: 0, total: 0 },
    });
  });

  it.each([null, undefined, "x", 3, {}, { rows: "no" }])(
    "reads %j as not available, never as «nobody came»",
    (answer) => {
      expect(parseCountryVisitReport(answer)).toEqual({ available: false });
    },
  );

  it("drops rows that are not a country, and a date that is not a date", () => {
    const report = parseCountryVisitReport({
      since: "yesterday",
      rows: [{ country: "tr", d7: 1, d30: 1, total: 1 }, null, 5, { country: "KZ", d7: -4, d30: "x", total: 2 }],
    });
    expect(report).toMatchObject({
      available: true,
      since: null,
      rows: [{ country: "KZ", d7: 0, d30: 0, total: 2 }],
    });
  });
});

describe("naming a country", () => {
  it("names it in Uyghur", () => {
    expect(countryName("TR")).toBe("تۈركىيە");
    expect(countryName("DE")).toBe("گېرمانىيە");
  });

  it("names East Turkistan, and marks it as one of ours", () => {
    expect(countryName(EAST_TURKISTAN)).toBe("شەرقىي تۈركىستان");
    expect(isOwnCode(EAST_TURKISTAN)).toBe(true);
    expect(isOwnCode("CN")).toBe(false);
    expect(countryName("CN")).not.toBe("شەرقىي تۈركىستان");
  });

  it("falls back to the code rather than to nothing", () => {
    expect(countryName("XX")).toBeTruthy();
    expect(countryName("not a code")).toBeTruthy();
  });
});

describe("a share", () => {
  it("is a percentage, and never divides by nothing", () => {
    expect(shareOf(25, 100)).toBe(25);
    expect(shareOf(1, 3)).toBeCloseTo(33.33, 1);
    expect(shareOf(5, 0)).toBe(0);
    expect(shareOf(0, 10)).toBe(0);
  });
});
