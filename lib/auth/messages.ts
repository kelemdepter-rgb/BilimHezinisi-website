/**
 * Uyghur wording shared by the sign-in, registration and password pages and
 * the email field that runs in the browser — a plain module, so a client
 * component can import the same strings a Server Component renders.
 *
 * The first two are the owner's own words (PROMPT-38) and are used verbatim:
 * do not re-punctuate, re-spell or "improve" them.
 */

/** Three failed attempts: the form is locked for an hour. */
export const LOCKED_MESSAGE = "email نى كىرگۈزۈش چېكى توشۇپ قالدى. بىر سائەتتىن كېيىن قايتا سىناڭ.";

/** An address under Chinese (PRC) jurisdiction, Hong Kong and Macau included. */
export const BLOCKED_MESSAGE = "خىتاي تەۋەلىكىدىكى email بىلەن كىرىش چەكلىنىدۇ.";

/**
 * The answer to «resend the confirmation email», whatever happened. It must
 * not depend on whether the address has an account, or whether that account
 * is already confirmed — anything else would turn the button into a way to
 * ask the site who is registered here.
 */
export const RESENT_MESSAGE =
  "ئەگەر بۇ ئادرېس بىلەن تىزىملاتقان بولسىڭىز، جەزملەش خېتى قايتا ئەۋەتىلدى. ساندۇق ۋە spam قىسقۇچىنى تەكشۈرۈڭ.";

/** The project's hourly allowance of confirmation emails is used up. */
export const EMAIL_CAP_MESSAGE =
  "ھازىر جەزملەش خېتى ئەۋەتىش سانى ۋاقىتلىق توشۇپ قالدى. بىرئاز ۋاقىتتىن كېيىن قايتا سىناڭ.";

/** How long a reader waits after asking for a resend before the button returns. */
export const RESEND_COOLDOWN_SECONDS = 60;

/**
 * «Wait about N seconds» — the per-address window Supabase enforces between
 * two emails to one address, which is a matter of seconds, never an hour.
 * Whole minutes from two minutes up, so nobody is asked to count to 600.
 */
export function waitMessage(seconds: number): string {
  const amount = seconds < 120 ? `${seconds} سېكۇنتتىن` : `${Math.ceil(seconds / 60)} مىنۇتتىن`;
  return `بىر ئاز ساقلاڭ — تەخمىنەن ${amount} كېيىن قايتا سىناڭ.`;
}

/** «This became ‹gmial.com› — did you mean ‹gmail.com›?» */
export function typoMessage(typed: string, suggestion: string): string {
  return `بۇ ‹${typed}› بولۇپ قالدى — ‹${suggestion}› دېمەكچىمۇ؟`;
}

/**
 * The `s` a wait message was redirected with, read back off the URL — where
 * anyone can type anything, so it is re-clamped here rather than trusted.
 */
export function readWaitSeconds(raw: string | string[] | undefined): number | null {
  const value = Number.parseInt(typeof raw === "string" ? raw : "", 10);
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.min(3600, Math.max(5, Math.ceil(value / 5) * 5));
}
