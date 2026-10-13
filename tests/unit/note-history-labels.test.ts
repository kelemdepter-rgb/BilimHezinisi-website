import { describe, expect, it } from "vitest";
import { REASON_LABEL, versionAge, versionLength, versionTime } from "@/lib/notes/history-labels";

/**
 * What «ئىلگىرىكى نۇسخىلار» says about a version (PROMPT-46): the day and
 * time in the writer's own clock, how long ago, its length and why it was
 * kept. Dates are built in local time, so the tests hold in any time zone.
 */

describe("what the panel says", () => {
  const now = new Date(2026, 9, 13, 16, 45).getTime();

  it("names the day the way the writer would", () => {
    expect(versionTime(new Date(2026, 9, 13, 15, 40).getTime(), now)).toBe("بۈگۈن 15:40");
    expect(versionTime(new Date(2026, 9, 13, 0, 5).getTime(), now)).toBe("بۈگۈن 00:05");
    expect(versionTime(new Date(2026, 9, 12, 9, 12).getTime(), now)).toBe("تۈنۈگۈن 09:12");
    expect(versionTime(new Date(2026, 9, 7, 15, 40).getTime(), now)).toBe("2026-10-07 15:40");
    // The first of the month: yesterday is the last day of the one before.
    expect(versionTime(new Date(2026, 8, 30, 23, 59).getTime(), new Date(2026, 9, 1, 8, 0).getTime())).toBe(
      "تۈنۈگۈن 23:59",
    );
  });

  it("says how long ago", () => {
    expect(versionAge(now - 20_000, now)).toBe("ھازىرلا");
    expect(versionAge(now - 5 * 60_000, now)).toBe("5 مىنۇت ئىلگىرى");
    expect(versionAge(now - 2 * 3_600_000 - 1, now)).toBe("2 سائەت ئىلگىرى");
    expect(versionAge(now - 3 * 86_400_000, now)).toBe("3 كۈن ئىلگىرى");
    // A clock that moved backwards is not "in the future".
    expect(versionAge(now + 60_000, now)).toBe("ھازىرلا");
  });

  it("gives the length in grouped Latin digits, and every reason a label", () => {
    expect(versionLength(1234)).toBe("1,234 ھەرپ");
    expect(REASON_LABEL).toEqual({
      auto: "ئاپتوماتىك",
      open: "ئېچىلغاندا",
      "before-replace-all": "ئالماشتۇرۇشتىن بۇرۇن",
      "before-ai": "AI تۈزىتىشتىن بۇرۇن",
      "before-restore": "ئەسلىگە قايتۇرۇشتىن بۇرۇن",
      "before-conflict": "زىددىيەتتىن بۇرۇن",
    });
  });
});
