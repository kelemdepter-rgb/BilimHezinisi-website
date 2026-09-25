import "server-only";
import { cookies } from "next/headers";
import { RESEND_COOLDOWN_SECONDS } from "./messages";

/**
 * Short-lived, httpOnly cookies that carry what a reader typed across the
 * redirect a Server Action ends with.
 *
 * Why cookies and never the URL: an address in a query string lands in
 * Vercel's request logs, the browser's history and the Referer header of
 * whatever is opened next. A cookie goes back to this site only, is invisible
 * to page scripts, and expires on its own within minutes. What is carried is
 * the reader's own input, shown back to them — a password never is.
 *
 * These are only valid inside Server Actions (reading works anywhere).
 */

/** The registration form as it was submitted, minus the password. */
export type RegisterDraft = {
  email: string;
  name: string;
  /** A domain the server suggested instead of the one typed (no-JS path). */
  suggestion?: string;
  /** A domain the reader chose to keep despite a suggestion. */
  kept?: string;
};

/** The sign-in form's address, kept after a failed attempt. */
export type LoginDraft = { email: string };

/** Where the confirmation email went, for «ئادرېس خاتا بولسا…». */
export type SentTo = { email: string; name: string };

const REGISTER_DRAFT = "bh_reg";
const LOGIN_DRAFT = "bh_login";
const SENT_TO = "bh_sent";
const RESENT_AT = "bh_resent";

/** Long enough to fix a typo and submit again; short on a shared computer. */
const DRAFT_SECONDS = 10 * 60;
/** Long enough to go and look in the inbox and come back. */
const SENT_TO_SECONDS = 15 * 60;

/** An address is at most 254 characters, a display name 60. */
const MAX_FIELD = 254;

function options(maxAge: number) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge,
  };
}

/** JSON → base64url: Uyghur display names are not cookie-safe as they are. */
export function encodeFlash(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.length <= MAX_FIELD ? value : undefined;
}

/**
 * Parse a cookie back, keeping only well-formed string fields. A cookie is
 * the reader's own browser talking, so a malformed one is ignored, never
 * trusted and never thrown on.
 */
export function decodeFlash(raw: string | undefined): Record<string, string> | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const fields: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed)) {
      const safe = text(value);
      if (safe !== undefined) fields[key] = safe;
    }
    return fields;
  } catch {
    return null;
  }
}

async function read(name: string): Promise<Record<string, string> | null> {
  return decodeFlash((await cookies()).get(name)?.value);
}

async function write(name: string, value: object, maxAge: number): Promise<void> {
  (await cookies()).set(name, encodeFlash(value), options(maxAge));
}

async function remove(name: string): Promise<void> {
  const store = await cookies();
  if (store.has(name)) store.delete(name);
}

export async function readRegisterDraft(): Promise<RegisterDraft | null> {
  const fields = await read(REGISTER_DRAFT);
  if (!fields) return null;
  return {
    email: fields.email ?? "",
    name: fields.name ?? "",
    ...(fields.suggestion ? { suggestion: fields.suggestion } : {}),
    ...(fields.kept ? { kept: fields.kept } : {}),
  };
}

export async function writeRegisterDraft(draft: RegisterDraft): Promise<void> {
  if (!draft.email && !draft.name) return remove(REGISTER_DRAFT);
  await write(REGISTER_DRAFT, draft, DRAFT_SECONDS);
}

export async function clearRegisterDraft(): Promise<void> {
  await remove(REGISTER_DRAFT);
}

export async function readLoginDraft(): Promise<LoginDraft | null> {
  const fields = await read(LOGIN_DRAFT);
  return fields?.email ? { email: fields.email } : null;
}

export async function writeLoginDraft(email: string): Promise<void> {
  if (!email) return remove(LOGIN_DRAFT);
  await write(LOGIN_DRAFT, { email }, DRAFT_SECONDS);
}

export async function clearLoginDraft(): Promise<void> {
  await remove(LOGIN_DRAFT);
}

export async function readSentTo(): Promise<SentTo | null> {
  const fields = await read(SENT_TO);
  return fields?.email ? { email: fields.email, name: fields.name ?? "" } : null;
}

export async function writeSentTo(sent: SentTo): Promise<void> {
  await write(SENT_TO, sent, SENT_TO_SECONDS);
}

export async function clearSentTo(): Promise<void> {
  await remove(SENT_TO);
}

/** Seconds until another resend may be asked for, from the reader's last one. */
export async function resendSecondsLeft(now: number = Date.now()): Promise<number> {
  const at = Number((await cookies()).get(RESENT_AT)?.value);
  if (!Number.isFinite(at) || at <= 0) return 0;
  const left = Math.ceil(RESEND_COOLDOWN_SECONDS - (now - at) / 1000);
  return Math.min(RESEND_COOLDOWN_SECONDS, Math.max(0, left));
}

export async function markResent(now: number = Date.now()): Promise<void> {
  (await cookies()).set(RESENT_AT, String(now), options(RESEND_COOLDOWN_SECONDS));
}
