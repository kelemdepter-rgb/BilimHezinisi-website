/**
 * Supabase Auth's error codes, turned into what the reader is told.
 *
 * Every outcome names a `reason` — the `?xata=` code the page maps to Uyghur —
 * and says whether it `counts` as one of the three failed attempts
 * (lib/auth/attempts.ts). A `log` line is for the owner in Vercel's logs: the
 * conditions a reader cannot fix and should not be told how to fix (dashboard
 * settings, the email allowance) are written there instead of on the page.
 *
 * Pure, so the mapping is unit-tested without a network.
 */

export type AuthErrorLike = { code?: string | null; status?: number; message?: string };

export type AuthOutcome = {
  reason: string;
  /** For `wait`: how long, already rounded and clamped. */
  seconds?: number;
  /** Whether this is one of the three failed attempts. */
  counts?: boolean;
  /** A line for the server log. Never an address, never a token. */
  log?: string;
};

/** Anything shaped like an email address, wherever a provider message quotes one. */
const ADDRESS = /[^\s"'<>@]+@[^\s"'<>]+/g;

/** Provider messages can quote the address they refused; the log must not. */
export function redactAddresses(text: string): string {
  return text.replace(ADDRESS, "‹address›");
}

/**
 * The wait Supabase asked for, from its own message: "For security purposes,
 * you can only request this after 42 seconds." (supabase/auth,
 * generateFrequencyLimitErrorMessage). Rounded up to five seconds and kept
 * between five seconds and an hour; null when the message carries no number,
 * which is how the project-wide cap ("email rate limit exceeded") reads.
 */
export function waitSecondsFrom(message: string | undefined): number | null {
  const match = /(\d{1,6})\s*(?:seconds?|secs?)\b/i.exec(message ?? "");
  if (!match) return null;
  const seconds = Number.parseInt(match[1], 10);
  if (!Number.isFinite(seconds)) return null;
  return Math.min(3600, Math.max(5, Math.ceil(seconds / 5) * 5));
}

function unmapped(error: AuthErrorLike): AuthOutcome {
  return {
    reason: "failed",
    log: `unmapped auth error code=${error.code ?? "?"} status=${error.status ?? "?"} ${redactAddresses(
      String(error.message ?? ""),
    ).slice(0, 200)}`,
  };
}

/** For the owner, when the project's hourly email allowance is spent. */
const EMAIL_CAP_LOG =
  "the project-wide email allowance is used up (over_email_send_rate_limit with no wait) — Authentication → Rate Limits";

/**
 * `over_email_send_rate_limit` means two different things, and the reader
 * deserves to know which: Supabase's per-address window between two emails
 * to one address (seconds — its message says how many), or the project's
 * hourly allowance of emails, which no reader can do anything about.
 */
function emailLimit(error: AuthErrorLike): AuthOutcome {
  const seconds = waitSecondsFrom(error.message);
  if (seconds !== null) return { reason: "wait", seconds };
  return { reason: "email_limit", log: EMAIL_CAP_LOG };
}

const PROVIDER_OFF_LOG =
  "email sign-in is switched off (email_provider_disabled) — Authentication → Sign In / Providers → Email";

/**
 * The Before User Created hook's refusals (migration 0027). Supabase passes
 * the hook's message through as the error's message, under nothing more
 * telling than its generic `unknown` code, so the message is what is
 * matched. Blocked and disposable are failed attempts, as the same checks in
 * our own form are; a pause is not.
 */
function hookOutcome(message: string | undefined): AuthOutcome | null {
  if (!message) return null;
  if (message.includes("bh:blocked")) return { reason: "blocked", counts: true };
  if (message.includes("bh:disposable")) return { reason: "disposable", counts: true };
  if (message.includes("bh:registration_paused")) return { reason: "paused" };
  return null;
}

export function signUpOutcome(error: AuthErrorLike): AuthOutcome {
  const refusedByHook = hookOutcome(error.message);
  if (refusedByHook) return refusedByHook;
  switch (error.code) {
    case "user_already_exists":
    case "email_exists":
      return { reason: "exists", counts: true };
    case "email_address_invalid":
      return { reason: "bad_email", counts: true };
    case "weak_password":
      return { reason: "short" };
    case "signup_disabled":
      return { reason: "disabled" };
    case "email_provider_disabled":
      return { reason: "provider_off", log: PROVIDER_OFF_LOG };
    case "email_address_not_authorized":
      return {
        reason: "send_failed",
        log: "the built-in email service only mails team members (email_address_not_authorized) — custom SMTP is not set up",
      };
    case "over_email_send_rate_limit":
      return emailLimit(error);
    case "over_request_rate_limit":
      return { reason: "rate_limit" };
    default:
      return unmapped(error);
  }
}

export function signInOutcome(error: AuthErrorLike): AuthOutcome {
  switch (error.code) {
    case "invalid_credentials":
      return { reason: "credentials", counts: true };
    case "email_not_confirmed":
      return { reason: "unconfirmed" };
    case "email_provider_disabled":
      return { reason: "provider_off", log: PROVIDER_OFF_LOG };
    case "over_request_rate_limit":
      return { reason: "rate_limit" };
    default:
      return unmapped(error);
  }
}

/**
 * Password recovery: two failures are put on the page, and everything else is
 * answered with the same «if this address has an account…» as a success
 * (`sent`) — the unfamiliar ones logged, as they always were.
 *
 * Supabase's per-address wait is one of the "everything else", on the owner's
 * decision (2026-09-25). Supabase answers an address with no account with an
 * empty success and never makes it wait, so saying "wait" for the second
 * request in a minute told whoever asked that the address IS registered.
 * «A link was sent» is true there too: one went a moment ago. The project's
 * hourly cap still says so, and is logged: a reader then really gets no
 * email, and telling them otherwise would leave them waiting for nothing.
 */
export function resetOutcome(error: AuthErrorLike): AuthOutcome {
  switch (error.code) {
    case "over_email_send_rate_limit":
      if (waitSecondsFrom(error.message) !== null) return { reason: "sent" };
      return { reason: "email_limit", log: EMAIL_CAP_LOG };
    case "email_provider_disabled":
      return { reason: "provider_off", log: PROVIDER_OFF_LOG };
    case "email_address_invalid":
    case "over_request_rate_limit":
      return { reason: "sent" };
    default:
      return { ...unmapped(error), reason: "sent" };
  }
}

export function updatePasswordOutcome(error: AuthErrorLike): AuthOutcome {
  switch (error.code) {
    case "weak_password":
      return { reason: "short" };
    case "same_password":
      return { reason: "same" };
    case "session_not_found":
      return { reason: "expired" };
    case "over_request_rate_limit":
      return { reason: "rate_limit" };
    default:
      return unmapped(error);
  }
}
