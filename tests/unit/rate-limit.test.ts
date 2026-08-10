import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SIGN_IN_RULE,
  SIGN_UP_RULE,
  isRateLimited,
  resetRateLimits,
} from "@/lib/rate-limit";

afterEach(() => {
  resetRateLimits();
  vi.useRealTimers();
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
