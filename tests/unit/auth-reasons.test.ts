import { describe, expect, it } from "vitest";
import {
  EMAIL_CAP_MESSAGE,
  readWaitSeconds,
  waitMessage,
} from "@/lib/auth/messages";
import {
  redactAddresses,
  resetOutcome,
  signInOutcome,
  signUpOutcome,
  updatePasswordOutcome,
  waitSecondsFrom,
} from "@/lib/auth/reasons";

/**
 * Supabase's error codes → what the reader is told (PROMPT-38 B6). The two
 * meanings of over_email_send_rate_limit are the heart of it: a per-address
 * wait of seconds, which must never be reported as "wait an hour", and the
 * project's hourly allowance, which a reader cannot fix and must not be told
 * how to fix.
 */

/** Supabase Auth's own wording (supabase/auth, generateFrequencyLimitErrorMessage). */
const perAddress = (seconds: number) => ({
  code: "over_email_send_rate_limit",
  status: 429,
  message: `For security purposes, you can only request this after ${seconds} seconds.`,
});
/** And its EmailRateLimitExceeded. */
const projectCap = { code: "over_email_send_rate_limit", status: 429, message: "email rate limit exceeded" };

describe("the wait Supabase asked for", () => {
  it("is read out of its message, rounded up to five seconds", () => {
    expect(waitSecondsFrom(perAddress(42).message)).toBe(45);
    expect(waitSecondsFrom(perAddress(45).message)).toBe(45);
    expect(waitSecondsFrom(perAddress(59).message)).toBe(60);
    expect(waitSecondsFrom("try again in 7 secs")).toBe(10);
  });

  it("is kept between five seconds and an hour", () => {
    expect(waitSecondsFrom(perAddress(0).message)).toBe(5);
    expect(waitSecondsFrom(perAddress(1).message)).toBe(5);
    expect(waitSecondsFrom(perAddress(99_999).message)).toBe(3600);
  });

  it("is absent when the message has no number — that is the project-wide cap", () => {
    expect(waitSecondsFrom(projectCap.message)).toBeNull();
    expect(waitSecondsFrom(undefined)).toBeNull();
    expect(waitSecondsFrom("")).toBeNull();
  });
});

describe("registration", () => {
  it("a message with seconds becomes a wait of that many seconds, and is not a failure", () => {
    expect(signUpOutcome(perAddress(42))).toEqual({ reason: "wait", seconds: 45 });
  });

  it("the cap becomes the reader-friendly message, with a line for the owner's log", () => {
    const outcome = signUpOutcome(projectCap);
    expect(outcome.reason).toBe("email_limit");
    expect(outcome.counts).toBeUndefined();
    expect(outcome.log).toMatch(/allowance/);
    expect(EMAIL_CAP_MESSAGE).not.toMatch(/Supabase|Confirm email|Authentication|تەڭشەك/);
  });

  it("counts an invalid address and an existing account as failed attempts", () => {
    expect(signUpOutcome({ code: "email_address_invalid" })).toEqual({ reason: "bad_email", counts: true });
    expect(signUpOutcome({ code: "user_already_exists" })).toEqual({ reason: "exists", counts: true });
    expect(signUpOutcome({ code: "email_exists" })).toEqual({ reason: "exists", counts: true });
  });

  it("does not count what the reader did not do wrong", () => {
    for (const code of [
      "over_request_rate_limit",
      "email_provider_disabled",
      "email_address_not_authorized",
      "signup_disabled",
      "weak_password",
    ]) {
      expect(signUpOutcome({ code }).counts, code).toBeUndefined();
    }
  });

  it("logs, and never shows, what only the owner can fix", () => {
    expect(signUpOutcome({ code: "email_provider_disabled" })).toMatchObject({
      reason: "provider_off",
      log: expect.stringContaining("Sign In / Providers"),
    });
    expect(signUpOutcome({ code: "email_address_not_authorized" })).toMatchObject({
      reason: "send_failed",
      log: expect.stringContaining("custom SMTP"),
    });
  });

  it("an unknown code is `failed` plus a log line — with any address in it removed", () => {
    const outcome = signUpOutcome({
      code: "something_new",
      status: 422,
      message: 'Email address "reader@example.org" is invalid',
    });
    expect(outcome.reason).toBe("failed");
    expect(outcome.log).toContain("something_new");
    expect(outcome.log).toContain("422");
    expect(outcome.log).not.toContain("reader@example.org");
    expect(outcome.log).toContain("‹address›");
  });
});

describe("signing in", () => {
  it("a wrong password is a failed attempt; an unconfirmed address is not", () => {
    expect(signInOutcome({ code: "invalid_credentials" })).toEqual({ reason: "credentials", counts: true });
    expect(signInOutcome({ code: "email_not_confirmed" })).toEqual({ reason: "unconfirmed" });
    expect(signInOutcome({ code: "over_request_rate_limit" })).toEqual({ reason: "rate_limit" });
  });
});

describe("password recovery", () => {
  it("still says so when the project's email allowance is spent, and logs it", () => {
    expect(resetOutcome(projectCap)).toMatchObject({
      reason: "email_limit",
      log: expect.stringContaining("allowance"),
    });
    expect(resetOutcome({ code: "email_provider_disabled" }).reason).toBe("provider_off");
  });

  it("answers Supabase's per-address wait like a success — only a registered address ever gets one", () => {
    expect(resetOutcome(perAddress(55))).toEqual({ reason: "sent" });
    expect(resetOutcome(perAddress(3))).toEqual({ reason: "sent" });
  });

  it("answers everything else like a success", () => {
    expect(resetOutcome({ code: "email_address_invalid" })).toEqual({ reason: "sent" });
    expect(resetOutcome({ code: "over_request_rate_limit" })).toEqual({ reason: "sent" });
    const unknown = resetOutcome({ code: "whatever", status: 500, message: "x" });
    expect(unknown.reason).toBe("sent");
    expect(unknown.log).toContain("whatever");
  });

  it("a new password's errors map as before", () => {
    expect(updatePasswordOutcome({ code: "same_password" }).reason).toBe("same");
    expect(updatePasswordOutcome({ code: "session_not_found" }).reason).toBe("expired");
    expect(updatePasswordOutcome({ code: "weak_password" }).reason).toBe("short");
    expect(updatePasswordOutcome({ code: "nope" }).reason).toBe("failed");
  });
});

describe("the page's side of a wait", () => {
  it("re-reads the seconds off the URL defensively", () => {
    expect(readWaitSeconds("45")).toBe(45);
    expect(readWaitSeconds("42")).toBe(45);
    expect(readWaitSeconds("abc")).toBeNull();
    expect(readWaitSeconds("-5")).toBeNull();
    expect(readWaitSeconds(["45"])).toBeNull();
    expect(readWaitSeconds("99999")).toBe(3600);
  });

  it("says seconds under two minutes, whole minutes above", () => {
    expect(waitMessage(45)).toBe("بىر ئاز ساقلاڭ — تەخمىنەن 45 سېكۇنتتىن كېيىن قايتا سىناڭ.");
    expect(waitMessage(300)).toBe("بىر ئاز ساقلاڭ — تەخمىنەن 5 مىنۇتتىن كېيىن قايتا سىناڭ.");
    expect(waitMessage(45)).not.toContain("سائەت");
  });

  it("removes every address from a string meant for a log", () => {
    expect(redactAddresses("a@b.com and c.d+e@f.org")).toBe("‹address› and ‹address›");
  });
});
