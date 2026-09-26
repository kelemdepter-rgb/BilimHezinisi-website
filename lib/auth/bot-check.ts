import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Two quiet checks against form bots on the forms that send email —
 * /register, /forgot-password and «resend the confirmation» (PROMPT-39,
 * part B). Not /login: it sends nothing and has the three-chances lock.
 *
 * A HONEYPOT: one more text field, hidden from people (and from screen
 * readers and the keyboard). A person never fills it; a bot filling every
 * field it finds does.
 *
 * A TIMESTAMP, signed with a server-only secret and rendered into the form:
 * a submission less than two seconds after the page was made is faster than
 * a person types. A fast person with autofill is simply asked to press again
 * — never counted against them — and their second press passes.
 *
 * Both run before anything costs money or rows: no DNS lookup, no
 * attempts-table row (bar the honeypot's own count on /register) and no
 * Supabase call reaches a bot. Neither says anything about an address.
 */

/**
 * The honeypot's name. Nothing a browser or password manager recognises —
 * no email, name, phone, address, url or website — so autofill leaves it
 * alone; tests/unit/no-autofill.test.ts keeps it that way.
 */
export const HONEYPOT_FIELD = "bh_note";

/** The signed issue time. */
export const FORM_TOKEN_FIELD = "bh_ts";

/** Faster than this, from page to submit, is not a person typing. */
export const MIN_FORM_AGE_MS = 2_000;

/** A form older than this is re-rendered: its page has been open for hours. */
export const MAX_FORM_AGE_MS = 2 * 60 * 60 * 1000;

export type BotVerdict = "ok" | "honeypot" | "too_fast" | "stale";

/**
 * The HMAC key, derived from the one server-only secret the site has, like
 * the attempt counter's (lib/auth/attempts.ts) but for its own purpose.
 */
function tokenSecret(): string | null {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) return null;
  return createHmac("sha256", serviceKey).update("bh-form-token/v1").digest("hex");
}

function sign(issuedAt: number, secret: string): string {
  return createHmac("sha256", secret).update(`form\n${issuedAt}`).digest("base64url");
}

/** `issuedAt.signature`, for the hidden field. Empty when there is no secret to sign with. */
export function issueFormToken(now: number = Date.now()): string {
  const secret = tokenSecret();
  return secret ? `${now}.${sign(now, secret)}` : "";
}

/**
 * Judge a submission. Without a secret (Supabase not configured) there is
 * nothing to verify against, and the timestamp is not checked at all.
 */
export function checkBotFields(formData: FormData, now: number = Date.now()): BotVerdict {
  if (String(formData.get(HONEYPOT_FIELD) ?? "").trim() !== "") return "honeypot";

  const secret = tokenSecret();
  if (!secret) return "ok";

  const [issued, signature] = String(formData.get(FORM_TOKEN_FIELD) ?? "").split(".");
  const issuedAt = Number(issued);
  if (!signature || !/^\d{10,16}$/.test(issued ?? "") || !Number.isSafeInteger(issuedAt)) return "stale";

  const expected = Buffer.from(sign(issuedAt, secret));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return "stale";

  const age = now - issuedAt;
  // A token from the future is a forgery or a broken clock; either way, a fresh page.
  if (age > MAX_FORM_AGE_MS || age < -60_000) return "stale";
  if (age < MIN_FORM_AGE_MS) return "too_fast";
  return "ok";
}
