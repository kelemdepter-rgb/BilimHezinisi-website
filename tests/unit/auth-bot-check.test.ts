import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  FORM_TOKEN_FIELD,
  HONEYPOT_FIELD,
  MAX_FORM_AGE_MS,
  MIN_FORM_AGE_MS,
  checkBotFields,
  issueFormToken,
} from "@/lib/auth/bot-check";

/**
 * The form-bot checks (PROMPT-39 B): a honeypot a person never fills, and a
 * signed page-made time that a bot either skips, forges or submits too soon.
 * Every verdict but "ok" is answered with the same «refresh and try again»,
 * so what matters here is that a person is never caught and a bot always is.
 */

const NOW = 1_790_000_000_000;
const previousKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

function submitted(fields: Record<string, string>): FormData {
  const data = new FormData();
  data.set(HONEYPOT_FIELD, "");
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}

/** A form whose page was made `age` ms before NOW. */
const madeAgo = (age: number) => submitted({ [FORM_TOKEN_FIELD]: issueFormToken(NOW - age) });

beforeEach(() => {
  process.env.SUPABASE_SERVICE_ROLE_KEY = "unit-test-service-key";
});

afterEach(() => {
  if (previousKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  else process.env.SUPABASE_SERVICE_ROLE_KEY = previousKey;
});

describe("a person", () => {
  it("passes from two seconds on, up to two hours", () => {
    expect(checkBotFields(madeAgo(MIN_FORM_AGE_MS), NOW)).toBe("ok");
    expect(checkBotFields(madeAgo(45_000), NOW)).toBe("ok");
    expect(checkBotFields(madeAgo(MAX_FORM_AGE_MS), NOW)).toBe("ok");
  });

  it("who is very quick is asked again, not refused", () => {
    expect(checkBotFields(madeAgo(0), NOW)).toBe("too_fast");
    expect(checkBotFields(madeAgo(MIN_FORM_AGE_MS - 1), NOW)).toBe("too_fast");
  });

  it("with a clock a few seconds ahead of the server's is not treated as a forger", () => {
    expect(checkBotFields(madeAgo(-30_000), NOW)).toBe("too_fast");
  });

  it("who left the page open for hours gets a fresh one", () => {
    expect(checkBotFields(madeAgo(MAX_FORM_AGE_MS + 1), NOW)).toBe("stale");
  });

  it("whose browser typed only spaces into the honeypot is not caught", () => {
    expect(checkBotFields(submitted({ [HONEYPOT_FIELD]: "  ", [FORM_TOKEN_FIELD]: issueFormToken(NOW - 5_000) }), NOW)).toBe(
      "ok",
    );
  });
});

describe("a bot", () => {
  it("that fills the honeypot is caught whatever its timestamp", () => {
    for (const token of [issueFormToken(NOW - 5_000), issueFormToken(NOW), ""]) {
      expect(checkBotFields(submitted({ [HONEYPOT_FIELD]: "hello", [FORM_TOKEN_FIELD]: token }), NOW)).toBe("honeypot");
    }
  });

  it("that sends no timestamp, or a malformed one, is caught", () => {
    expect(checkBotFields(submitted({}), NOW)).toBe("stale");
    for (const token of ["", ".", "abc", "123.abc", `${NOW}`, `${NOW}.`, `-${NOW}.x`, `${NOW}.a.b`]) {
      expect(checkBotFields(submitted({ [FORM_TOKEN_FIELD]: token }), NOW), token).toBe("stale");
    }
  });

  it("that moves the time but keeps the signature is caught", () => {
    const signature = issueFormToken(NOW - 1_000).split(".")[1];
    expect(checkBotFields(submitted({ [FORM_TOKEN_FIELD]: `${NOW - 60_000}.${signature}` }), NOW)).toBe("stale");
  });

  it("that signs with any other key is caught", () => {
    const forged = issueFormToken(NOW - 5_000);
    process.env.SUPABASE_SERVICE_ROLE_KEY = "a-different-key";
    expect(checkBotFields(submitted({ [FORM_TOKEN_FIELD]: forged }), NOW)).toBe("stale");
  });

  it("that sends a time from the future is caught", () => {
    expect(checkBotFields(madeAgo(-5 * 60_000), NOW)).toBe("stale");
  });
});

describe("the token", () => {
  it("is the time and a signature, nothing else", () => {
    expect(issueFormToken(NOW)).toMatch(/^\d{13}\.[A-Za-z0-9_-]{43}$/);
    expect(issueFormToken(NOW)).not.toBe(issueFormToken(NOW + 1));
  });

  it("is not issued, nor checked, when there is no secret to sign with", () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    expect(issueFormToken(NOW)).toBe("");
    expect(checkBotFields(submitted({ [FORM_TOKEN_FIELD]: "" }), NOW)).toBe("ok");
    // The honeypot needs no secret.
    expect(checkBotFields(submitted({ [HONEYPOT_FIELD]: "x" }), NOW)).toBe("honeypot");
  });
});
