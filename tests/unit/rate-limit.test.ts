import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BOOK_DOWNLOAD_RULE,
  NOTE_CREATE_RULE,
  NOTE_SAVE_RULE,
  SIGN_IN_RULE,
  SIGN_UP_RULE,
  isRateLimited,
  resetRateLimits,
} from "@/lib/rate-limit";
import { MIN_SAVE_GAP_MS } from "@/lib/notes/save-loop";

afterEach(() => {
  resetRateLimits();
  vi.useRealTimers();
});

describe("whole-book downloads", () => {
  it("lets a reader collect a shelf, then brakes", () => {
    for (let attempt = 0; attempt < BOOK_DOWNLOAD_RULE.limit; attempt += 1) {
      expect(isRateLimited("download:reader", BOOK_DOWNLOAD_RULE), `attempt ${attempt + 1}`).toBe(
        false,
      );
    }
    expect(isRateLimited("download:reader", BOOK_DOWNLOAD_RULE)).toBe(true);
  });

  it("is looser than signing in, because a download is not a guess at a password", () => {
    expect(BOOK_DOWNLOAD_RULE.limit).toBeGreaterThan(SIGN_IN_RULE.limit);
  });

  it("does not spend the sign-in allowance", () => {
    for (let attempt = 0; attempt < BOOK_DOWNLOAD_RULE.limit + 5; attempt += 1) {
      isRateLimited("download:shared", BOOK_DOWNLOAD_RULE);
    }
    expect(isRateLimited("signin:shared", SIGN_IN_RULE)).toBe(false);
  });
});

describe("isRateLimited", () => {
  it("allows exactly the rule's allowance, then turns the caller away", () => {
    const rule = { limit: 3, windowMs: 60_000 };
    expect(isRateLimited("a", rule)).toBe(false);
    expect(isRateLimited("a", rule)).toBe(false);
    expect(isRateLimited("a", rule)).toBe(false);
    expect(isRateLimited("a", rule)).toBe(true);
    expect(isRateLimited("a", rule)).toBe(true);
  });

  it("counts each caller separately", () => {
    const rule = { limit: 1, windowMs: 60_000 };
    expect(isRateLimited("first", rule)).toBe(false);
    expect(isRateLimited("second", rule)).toBe(false);
    expect(isRateLimited("first", rule)).toBe(true);
    expect(isRateLimited("second", rule)).toBe(true);
  });

  it("lets the caller back in once the window has passed", () => {
    vi.useFakeTimers();
    const rule = { limit: 2, windowMs: 60_000 };
    expect(isRateLimited("a", rule)).toBe(false);
    expect(isRateLimited("a", rule)).toBe(false);
    expect(isRateLimited("a", rule)).toBe(true);

    vi.advanceTimersByTime(60_001);
    expect(isRateLimited("a", rule), "a new window starts clean").toBe(false);
  });

  it("keeps sign-in and sign-up in separate buckets", () => {
    // The actions prefix the key, so guessing a password cannot exhaust the
    // signup allowance or the other way round.
    for (let attempt = 0; attempt < SIGN_IN_RULE.limit; attempt++) {
      expect(isRateLimited("signin:1.2.3.4", SIGN_IN_RULE)).toBe(false);
    }
    expect(isRateLimited("signin:1.2.3.4", SIGN_IN_RULE)).toBe(true);
    expect(isRateLimited("signup:1.2.3.4", SIGN_UP_RULE)).toBe(false);
  });

  it("is tighter on signup than on signin, because signup sends email", () => {
    expect(SIGN_UP_RULE.limit).toBeLessThan(SIGN_IN_RULE.limit);
    expect(SIGN_UP_RULE.windowMs).toBeGreaterThan(SIGN_IN_RULE.windowMs);
  });
});

describe("the notebook's write limits (PROMPT-44)", () => {
  it("are the owner's numbers: 30 new notes an hour, 600 saves in ten minutes", () => {
    expect(NOTE_CREATE_RULE).toEqual({ limit: 30, windowMs: 60 * 60_000 });
    expect(NOTE_SAVE_RULE).toEqual({ limit: 600, windowMs: 10 * 60_000 });
  });

  it("never touch a real writer: three tabs typing without a pause stay under the save limit", () => {
    // The editor sends one note at most every MIN_SAVE_GAP_MS.
    const onePerTab = NOTE_SAVE_RULE.windowMs / MIN_SAVE_GAP_MS;
    expect(onePerTab).toBe(200);
    expect(3 * onePerTab).toBeLessThanOrEqual(NOTE_SAVE_RULE.limit);
  });

  it("are counted per writer, and one rule does not spend the other", () => {
    for (let save = 0; save < NOTE_SAVE_RULE.limit; save += 1) {
      expect(isRateLimited("note-save:a", NOTE_SAVE_RULE)).toBe(false);
    }
    expect(isRateLimited("note-save:a", NOTE_SAVE_RULE)).toBe(true);
    expect(isRateLimited("note-save:b", NOTE_SAVE_RULE)).toBe(false);
    expect(isRateLimited("note-create:a", NOTE_CREATE_RULE)).toBe(false);
  });

  it("let a writer save again once the ten minutes are over", () => {
    vi.useFakeTimers();
    for (let save = 0; save <= NOTE_SAVE_RULE.limit; save += 1) isRateLimited("note-save:a", NOTE_SAVE_RULE);
    expect(isRateLimited("note-save:a", NOTE_SAVE_RULE)).toBe(true);
    vi.advanceTimersByTime(NOTE_SAVE_RULE.windowMs);
    expect(isRateLimited("note-save:a", NOTE_SAVE_RULE)).toBe(false);
  });
});
