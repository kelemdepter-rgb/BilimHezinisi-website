import { describe, expect, it } from "vitest";
import { formatNoteTime } from "@/lib/notes/dates";

/**
 * The list's date (PROMPT-47, N19): the reader's own time, never UTC. The
 * owner's readers are mostly in Istanbul (UTC+3), where the old UTC date was
 * a day behind for every edit made between midnight and three.
 */

const ISTANBUL = "Europe/Istanbul";

describe("formatNoteTime", () => {
  it("an edit at half past midnight in Istanbul is that day, not the day before", () => {
    const stamp = "2026-10-06T21:30:00.123456+00:00";
    expect(formatNoteTime(stamp, ISTANBUL)).toBe("2026-10-07 00:30");
    // What the list used to print.
    expect(stamp.slice(0, 10)).toBe("2026-10-06");
  });

  it("a minute before midnight in Istanbul is still that day", () => {
    expect(formatNoteTime("2026-10-06T20:59:59.999999+00:00", ISTANBUL)).toBe("2026-10-06 23:59");
    expect(formatNoteTime("2026-10-06T21:00:00+00:00", ISTANBUL)).toBe("2026-10-07 00:00");
  });

  it("writes hours 00–23, two digits each, Latin digits", () => {
    expect(formatNoteTime("2026-01-02T03:04:00Z", "UTC")).toBe("2026-01-02 03:04");
    expect(formatNoteTime("2026-01-02T23:59:00Z", "UTC")).toBe("2026-01-02 23:59");
    expect(formatNoteTime("2026-01-02T00:00:00Z", "UTC")).toBe("2026-01-02 00:00");
  });

  it("reads every form PostgREST prints — microseconds, trimmed zeros, short offsets", () => {
    for (const stamp of [
      "2026-10-06T21:30:00.5+00:00",
      "2026-10-06T21:30:00.000001+00",
      "2026-10-07T00:30:00.5+03:00",
      "2026-10-06T21:30:00Z",
    ]) {
      expect(formatNoteTime(stamp, ISTANBUL), stamp).toBe("2026-10-07 00:30");
    }
  });

  it("is empty for a stamp it cannot read, or a zone that does not exist", () => {
    expect(formatNoteTime("not a time", ISTANBUL)).toBe("");
    expect(formatNoteTime("2026-10-06T21:30:00Z", "Nowhere/Atlantis")).toBe("");
  });
});
