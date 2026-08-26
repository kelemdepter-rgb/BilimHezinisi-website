/**
 * Telling Gemini's failures apart.
 *
 * Two of these distinctions decide whether a reader is sent to do the right
 * thing or the wrong one, and both are counter-intuitive enough to be worth
 * pinning down: a 429 that reads `limit: 0` is a paid-only MODEL rather than an
 * exhausted quota, and a 503 means the key is perfectly good. Getting either
 * backwards sends someone off to regenerate a key that was never the problem.
 */
import { describe, expect, it } from "vitest";
import {
  GeminiError,
  canFailOver,
  describeFailure,
  emptyAnswerMessage,
  isKeyInvalidError,
  isModelUnavailableError,
  isNetworkError,
  isPaidOnlyModelError,
  isQuotaError,
  isServerBusyError,
  isSizeError,
  quotaAllMessage,
} from "@/lib/ai/errors";

/** The shapes Google actually sends, verbatim enough to be worth testing. */
const QUOTA = new GeminiError(
  "HTTP 429 — Resource has been exhausted (e.g. check quota).",
  { status: 429, retryDelayMs: 26_000 },
);
const PAID_ONLY = new GeminiError(
  "HTTP 429 — Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests, limit: 0, model: gemini-3.1-pro",
  { status: 429 },
);
const BUSY = new GeminiError("HTTP 503 — The model is overloaded.", { status: 503 });
const DEAD_KEY = new GeminiError("HTTP 400 — API key not valid. Please pass a valid API key.", {
  status: 400,
});
const SUSPENDED = new GeminiError(
  "HTTP 403 — Consumer 'api_key:AIza…' has been suspended.",
  { status: 403 },
);
const GONE = new GeminiError("HTTP 404 — models/gemini-x is not found.", {
  status: 404,
  notFound: true,
});
const TOO_BIG = new GeminiError(
  "HTTP 400 — The request exceeds the maximum number of tokens.",
  { status: 400 },
);
const OFFLINE = new GeminiError("fetch failed");

describe("a 429 that is not a quota problem", () => {
  it("reads `limit: 0` as the model needing billing, not as an exhausted quota", () => {
    expect(isPaidOnlyModelError(PAID_ONLY)).toBe(true);
    expect(isPaidOnlyModelError(QUOTA)).toBe(false);
    // It IS a 429, which is exactly why the order of the checks matters.
    expect(isQuotaError(PAID_ONLY)).toBe(true);
  });

  it("names the model and says nothing was switched", () => {
    const failure = describeFailure(PAID_ONLY, "gemini-3.1-pro-preview");
    expect(failure.paidOnlyModel).toBe(true);
    expect(failure.error).toContain("gemini-3.1-pro-preview");
    expect(failure.error).toContain("پۇللۇق مودېل");
    expect(failure.error).toContain("ئۆزلۈكىدىن ئۆزگەرتىلمىدى");
    expect(failure.error).not.toContain("ھەققىڭىز توشۇپ قالدى");
    // The free ones are offered as the way out, by name.
    expect(failure.error).toContain("gemini-3.7-flash");
  });

  it("still fails over, because another key may have billing", () => {
    expect(canFailOver(PAID_ONLY)).toBe(true);
  });
});

describe("a busy model is not a broken key", () => {
  it("reads 503 as overloaded", () => {
    expect(isServerBusyError(BUSY)).toBe(true);
    expect(isKeyInvalidError(BUSY)).toBe(false);
    expect(describeFailure(BUSY, "gemini-3.7-flash").busy).toBe(true);
  });
});

describe("a dead key", () => {
  it("is recognised from the 400 and from a suspended consumer", () => {
    expect(isKeyInvalidError(DEAD_KEY)).toBe(true);
    expect(isKeyInvalidError(SUSPENDED)).toBe(true);
    // Checked before the model checks, which own 400/403 and would swallow it.
    expect(isModelUnavailableError(DEAD_KEY)).toBe(false);
    expect(isModelUnavailableError(SUSPENDED)).toBe(false);
    expect(canFailOver(DEAD_KEY)).toBe(true);
  });
});

describe("failures no other key can fix", () => {
  it("stops the walk on a missing model and on a rejected size", () => {
    expect(isModelUnavailableError(GONE)).toBe(true);
    expect(canFailOver(GONE)).toBe(false);
    expect(isSizeError(TOO_BIG)).toBe(true);
    expect(canFailOver(TOO_BIG)).toBe(false);
  });

  it("names the model when the model itself is gone", () => {
    const failure = describeFailure(GONE, "gemini-3.7-flash");
    expect(failure.modelUnavailable).toBe(true);
    expect(failure.error).toContain("gemini-3.7-flash");
    expect(failure.error).toContain("ئۆزلۈكىدىن ئالماشتۇرۇلمىدى");
  });
});

describe("nothing reached Google", () => {
  it("blames the connection, not the key, and says what still works", () => {
    expect(isNetworkError(OFFLINE)).toBe(true);
    expect(canFailOver(OFFLINE)).toBe(true);
    const failure = describeFailure(OFFLINE, "gemini-3.7-flash");
    expect(failure.offline).toBe(true);
    expect(failure.error).toContain("ئىنتېرنېتقا باغلىنالمىدى");
    // Reading a book has nothing to do with any of this, and the message says so.
    expect(failure.error).toContain("ئىنتېرنېتسىزمۇ");
  });
});

describe("what the reader is told about waiting", () => {
  it("quotes Google's own retry delay rather than inventing a limit", () => {
    expect(quotaAllMessage(26_000)).toContain("26 سېكۇنت");
    expect(quotaAllMessage(180_000)).toContain("3 مىنۇت");
    // No delay reported: say nothing about time rather than guess.
    const silent = quotaAllMessage(null);
    expect(silent).not.toMatch(/سېكۇنت|مىنۇت/);
    expect(silent).toContain("توشۇپ قالدى");
  });

  it("never shows a raw English API string", () => {
    for (const error of [QUOTA, PAID_ONLY, BUSY, DEAD_KEY, GONE, TOO_BIG, OFFLINE]) {
      const { error: message } = describeFailure(error, "gemini-3.7-flash");
      expect(message).not.toContain("HTTP 4");
      expect(message).not.toContain("HTTP 5");
      expect(message).not.toContain("Resource has been exhausted");
      expect(message).not.toContain("API key not valid");
    }
  });
});

describe("an answer that came back empty", () => {
  it("turns each finishReason into something to do about it", () => {
    expect(emptyAnswerMessage("SAFETY")).toContain("بىخەتەرلىك سۈزگۈچى");
    expect(emptyAnswerMessage("MAX_TOKENS")).toContain("ئۇزۇن");
    expect(emptyAnswerMessage("RECITATION")).toContain("نەقىل");
    // An unknown reason is reported as itself rather than swallowed.
    expect(emptyAnswerMessage("SOMETHING_NEW")).toContain("SOMETHING_NEW");
  });
});
