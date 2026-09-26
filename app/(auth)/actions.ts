"use server";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ensureAdminBootstrap } from "@/lib/auth/bootstrap";
import { isRegistrationPaused } from "@/lib/auth/account-security";
import { attemptsFor, type Attempts } from "@/lib/auth/attempts";
import { checkBotFields, type BotVerdict } from "@/lib/auth/bot-check";
import { isDisposableDomain } from "@/lib/auth/disposable-domains";
import {
  COMMON_DOMAINS,
  isBlockedJurisdiction,
  parseEmail,
  suggestDomain,
  withDomain,
  type ParsedEmail,
} from "@/lib/auth/email";
import { checkMailDomain } from "@/lib/auth/email-dns";
import {
  clearLoginDraft,
  clearRegisterDraft,
  clearSentTo,
  markResent,
  writeLoginDraft,
  writeRegisterDraft,
  writeSentTo,
} from "@/lib/auth/flash";
import {
  resetOutcome,
  signInOutcome,
  signUpOutcome,
  updatePasswordOutcome,
  type AuthOutcome,
} from "@/lib/auth/reasons";
import {
  PASSWORD_RESET_RULE,
  RESEND_RULE,
  SIGN_IN_RULE,
  SIGN_UP_RULE,
  callerKey,
  isRateLimited,
} from "@/lib/rate-limit";
import { absoluteUrl } from "@/lib/seo";

/** Where a recovery link ends up, and where the new password is set. */
const RESET_PATH = "/reset-password";

/**
 * One line in the server log (Vercel → Logs) for the owner. Only a reason and,
 * at most, the address's domain — never the address, an IP, a password or a
 * token.
 */
function logAuth(where: string, outcome: AuthOutcome, domain?: string): void {
  if (!outcome.log) return;
  console.error(`[auth] ${where}: ${outcome.log}${domain ? ` (domain ${domain})` : ""}`);
}

/**
 * The bot checks' verdict, logged as a reason code and nothing else. Stale
 * tokens are ordinary (a page left open for hours) and are not logged.
 */
function botVerdict(form: string, formData: FormData): BotVerdict {
  const verdict = checkBotFields(formData);
  if (verdict === "honeypot" || verdict === "too_fast") console.warn(`[auth] ${form}: bot:${verdict}`);
  return verdict;
}

/**
 * What DNS says, for the checks that need it. The familiar providers are
 * known to exist and known not to be PRC-hosted, so most readers never wait
 * on a lookup at all.
 */
async function mailDomainVerdict(parsed: ParsedEmail) {
  return COMMON_DOMAINS.includes(parsed.domain) ? "ok" : checkMailDomain(parsed.domain);
}

/* ── Registration ─────────────────────────────────────────────────────────── */

/**
 * The checks run in this order (PROMPT-38 B4, PROMPT-39), and nothing before
 * the Supabase call can spend an email:
 *
 *   1. the in-process burst brake      7. blocked jurisdiction, by name
 *   2. the bot checks: honeypot,       8. a probable typo of a common domain
 *      then the signed timestamp       9. a disposable (throwaway) domain
 *   3. registration paused?           10. DNS: does the domain exist, and is
 *   4. the three-chances lock              its mail PRC-hosted?
 *   5. empty fields, short password   11. Supabase — whose Before User Created
 *   6. the address's syntax               hook repeats 3, 7 and 9 for anyone
 *                                         who skips this form
 *
 * A bot costs nothing past step 2 but the honeypot's own count; a locked
 * person is answered at step 4, before any lookup or Supabase call. The
 * honeypot, steps 6, 7, 9 and 10, and Supabase's own `email_address_invalid`,
 * `exists` and the hook's blocked/disposable refusals are failed attempts; a
 * too-fast or stale form, a pause, a suggestion, a wait, a rate limit and a
 * server fault are not.
 */
export async function signUpAction(formData: FormData) {
  const typed = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const displayName = String(formData.get("display_name") ?? "").trim().slice(0, 60);
  const keptDomain = String(formData.get("keep_domain") ?? "");

  /** Back to the form with the message — and with what was typed, bar the password. */
  const back = async (reason: string, extra = "") => {
    await writeRegisterDraft({ email: typed.slice(0, 254), name: displayName });
    redirect(`/register?xata=${reason}${extra}`);
  };

  if (isRateLimited(`signup:${await callerKey()}`, SIGN_UP_RULE)) return back("rate_limit");

  const bot = botVerdict("register", formData);
  if (bot === "honeypot") {
    // No person ever sees the field, so a bot filling it locks itself out.
    await (await attemptsFor("register")).fail();
    return back("bot");
  }
  if (bot !== "ok") return back("bot");

  if (await isRegistrationPaused()) return back("paused");

  const tries = await attemptsFor("register");
  if (await tries.locked()) return back("locked");

  /** A failed attempt: counted, and the third one answers with the lock. */
  const refuse = async (reason: string) => back((await tries.fail()) ? "locked" : reason);

  if (!typed || !password) return back("empty");
  if (password.length < 6) return back("short");

  const parsed = parseEmail(typed);
  if (!parsed) return refuse("bad_email");
  if (isBlockedJurisdiction(parsed.domain)) return refuse("blocked");

  // A probable typo is shown before anything is sent, and only once: the
  // reader who taps «keep» comes back with keep_domain set. It is offered
  // BEFORE the disposable list and DNS on purpose. The list names the typo
  // domains that catch other people's misdirected mail — `gmial.com`,
  // `hotmial.com` and some thirty more — and `gmal.com` has no mail servers
  // at all; a reader who slipped deserves «gmail.com دېمەكچىمۇ؟» — as the
  // browser already says to anyone with JavaScript — not a spent chance.
  // Only a reader who keeps such a domain is refused.
  const suggestion = suggestDomain(parsed.domain);
  if (suggestion && keptDomain !== parsed.domain) {
    await writeRegisterDraft({ email: typed, name: displayName, suggestion });
    redirect("/register");
  }

  if (isDisposableDomain(parsed.domain)) return refuse("disposable");

  const dns = await mailDomainVerdict(parsed);
  if (dns === "blocked") return refuse("blocked");
  if (dns === "undeliverable") return refuse("bad_email");

  const supabase = await createSupabaseServerClient();
  if (!supabase) return back("config");

  const { data, error } = await supabase.auth.signUp({
    email: parsed.email,
    password,
    options: { data: { display_name: displayName } },
  });
  if (error) {
    const outcome = signUpOutcome(error);
    logAuth("sign-up", outcome, parsed.domain);
    if (outcome.counts) return refuse(outcome.reason);
    return back(outcome.reason, outcome.reason === "wait" ? `&s=${outcome.seconds}` : "");
  }

  await clearRegisterDraft();
  if (data.session && data.user) {
    // Email confirmation disabled — signed in immediately.
    await ensureAdminBootstrap(data.user.id, data.user.email);
    redirect("/");
  }
  // Email confirmation enabled — a link was sent. The page says where to.
  await writeSentTo({ email: parsed.email, name: displayName });
  redirect("/login?uqtur=confirm");
}

/**
 * The two buttons under a typo suggestion, for a browser without
 * JavaScript: «use the suggested domain» or «keep what I typed». Either way
 * the form comes back filled in and nothing is sent yet; with JavaScript the
 * same buttons act in place and never reach these. The suggestion is worked
 * out again here rather than taken from the form.
 *
 * One action per button, not one action reading the button's name: React
 * gives a button whose formAction is a Server Action the action's id as its
 * name when it renders the page, so a `choice` field would never arrive.
 */
async function chooseSuggestion(formData: FormData, choice: "accept" | "keep") {
  const typed = String(formData.get("email") ?? "").trim().slice(0, 254);
  const name = String(formData.get("display_name") ?? "").trim().slice(0, 60);

  const parsed = parseEmail(typed);
  const suggestion = parsed ? suggestDomain(parsed.domain) : null;
  if (parsed && suggestion && choice === "accept") {
    await writeRegisterDraft({ email: withDomain(typed, suggestion), name });
  } else if (parsed && choice === "keep") {
    await writeRegisterDraft({ email: typed, name, kept: parsed.domain });
  } else {
    await writeRegisterDraft({ email: typed, name });
  }
  redirect("/register");
}

export async function acceptSuggestionAction(formData: FormData) {
  return chooseSuggestion(formData, "accept");
}

export async function keepSuggestionAction(formData: FormData) {
  return chooseSuggestion(formData, "keep");
}

/* ── Signing in ───────────────────────────────────────────────────────────── */

export async function signInAction(formData: FormData) {
  const typed = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  const back = async (reason: string) => {
    await writeLoginDraft(typed.slice(0, 254));
    redirect(`/login?xata=${reason}`);
  };

  // Turned away before the request reaches Supabase at all.
  if (isRateLimited(`signin:${await callerKey()}`, SIGN_IN_RULE)) return back("rate_limit");

  const tries = await attemptsFor("login");
  if (await tries.locked()) return back("locked");

  const refuse = async (reason: string) => back((await tries.fail()) ? "locked" : reason);

  if (!typed || !password) return back("empty");

  const parsed = parseEmail(typed);
  if (!parsed) return refuse("bad_email");
  if (isBlockedJurisdiction(parsed.domain)) return refuse("blocked");
  // An account that exists can only be on a domain that exists, so the
  // lookup here asks one thing: is its mail PRC-hosted?
  if ((await mailDomainVerdict(parsed)) === "blocked") return refuse("blocked");

  const supabase = await createSupabaseServerClient();
  if (!supabase) return back("config");

  const { data, error } = await supabase.auth.signInWithPassword({
    email: parsed.email,
    password,
  });
  if (error || !data.user) {
    const outcome: AuthOutcome = error ? signInOutcome(error) : { reason: "failed" };
    logAuth("sign-in", outcome, parsed.domain);
    if (outcome.counts) return refuse(outcome.reason);
    return back(outcome.reason);
  }

  await tries.clear();
  await clearLoginDraft();
  await clearSentTo();
  await ensureAdminBootstrap(data.user.id, data.user.email);
  redirect("/");
}

/**
 * Send the confirmation email again (PROMPT-38 B7).
 *
 * The answer is the same whatever happened — sent, already confirmed, no such
 * account, or Supabase's own per-address wait — because each of those says
 * something about THIS address, and the button must not become a way to ask
 * the site who is registered here. Supabase answers "no such user" and
 * "already confirmed" with the same empty success itself; its wait and its
 * email allowance only ever come back for an address with an unconfirmed
 * account, so they are logged, not shown. Only what is true of every address
 * alike is put on the page: a broken, blocked or disposable address, a form
 * bot, a pause, and our own brake. Not one of the three failed attempts,
 * either way.
 */
export async function resendConfirmationAction(formData: FormData) {
  const typed = String(formData.get("email") ?? "").trim();
  const back = (reason: string) => redirect(`/login?xata=${reason}&resend=1`);

  if (isRateLimited(`resend:${await callerKey()}`, RESEND_RULE)) return back("rate_limit");
  if (botVerdict("resend", formData) !== "ok") return back("bot");
  if (await isRegistrationPaused()) return back("paused");
  if (!typed) return back("empty_resend");

  const parsed = parseEmail(typed);
  if (!parsed) return back("bad_email");
  if (isBlockedJurisdiction(parsed.domain)) return back("blocked");
  if (isDisposableDomain(parsed.domain)) return back("disposable");
  const dns = await mailDomainVerdict(parsed);
  if (dns === "blocked") return back("blocked");
  if (dns === "undeliverable") return back("bad_email");

  const supabase = await createSupabaseServerClient();
  if (!supabase) return back("config");

  // No emailRedirectTo, exactly as signUpAction: both links land on the
  // project's Site URL, so a resent link behaves as the first one did.
  const { error } = await supabase.auth.resend({ type: "signup", email: parsed.email });
  if (error) {
    const outcome = signUpOutcome(error);
    const log = outcome.log ?? `${outcome.reason} (${error.code ?? "?"}), answered as sent`;
    logAuth("resend", { ...outcome, log }, parsed.domain);
    if (outcome.reason === "rate_limit") return back("rate_limit");
  }

  await markResent();
  redirect("/login?uqtur=resent");
}

export async function signOutAction() {
  const supabase = await createSupabaseServerClient();
  if (supabase) await supabase.auth.signOut();
  redirect("/");
}

/* ── Password recovery — unchanged, and never locked ─────────────────────── */

/**
 * Send a password-recovery email.
 *
 * The answer is deliberately the same whether or not the address has an
 * account: anything else turns this form into a way to ask the site which of
 * a list of emails are registered here. Supabase's own response does not
 * distinguish either, so nothing but our own redirect could leak it.
 *
 * The three-chances lock never applies here. PROMPT-38 added one thing: an
 * address under the Chinese-jurisdiction block is told the rule and sent
 * nothing — which says something about the domain, public by design, and
 * nothing about whether an account exists. And it closed one leak, on the
 * owner's word: Supabase's wait between two emails to one address is only
 * ever imposed on a registered address, so it is now answered like a success
 * too (lib/auth/reasons.ts, resetOutcome).
 *
 * PROMPT-39 put the form-bot checks in front (lib/auth/bot-check.ts): a bot
 * gets a generic «try again», which says nothing about the address and is
 * never counted. A person's answer is exactly what it was.
 *
 * The link lands on /auth/callback, which exchanges the code for a session
 * and forwards to /reset-password — the only place the new password is set.
 */
export async function requestPasswordResetAction(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  if (!email) redirect("/forgot-password?xata=empty");

  if (isRateLimited(`reset:${await callerKey()}`, PASSWORD_RESET_RULE)) {
    redirect("/forgot-password?xata=rate_limit");
  }

  if (botVerdict("password reset", formData) !== "ok") redirect("/forgot-password?xata=bot");

  const parsed = parseEmail(email);
  if (
    parsed &&
    (isBlockedJurisdiction(parsed.domain) || (await mailDomainVerdict(parsed)) === "blocked")
  ) {
    redirect("/forgot-password?xata=blocked");
  }

  const supabase = await createSupabaseServerClient();
  if (!supabase) redirect("/forgot-password?xata=config");

  const { error } = await supabase.auth.resetPasswordForEmail(parsed?.email ?? email, {
    redirectTo: absoluteUrl(`/auth/callback?next=${encodeURIComponent(RESET_PATH)}`),
  });

  // Only failures that say nothing about THIS address are surfaced.
  if (error) {
    const outcome = resetOutcome(error);
    logAuth("password reset", outcome, parsed?.domain);
    if (outcome.reason !== "sent") redirect(`/forgot-password?xata=${outcome.reason}`);
  }

  redirect("/forgot-password?uqtur=sent");
}

/** Forget this person's failed attempts on both forms. */
async function forgetFailures(): Promise<void> {
  const counters: Attempts[] = await Promise.all([attemptsFor("login"), attemptsFor("register")]);
  await Promise.all(counters.map((counter) => counter.clear()));
}

/**
 * Set a new password. Reachable only with the session the recovery link
 * created, which `updateUser` enforces server-side — a signed-out caller gets
 * an error from Supabase rather than a changed password.
 */
export async function updatePasswordAction(formData: FormData) {
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");
  if (!password || !confirm) redirect(`${RESET_PATH}?xata=empty`);
  if (password.length < 6) redirect(`${RESET_PATH}?xata=short`);
  if (password !== confirm) redirect(`${RESET_PATH}?xata=mismatch`);

  const supabase = await createSupabaseServerClient();
  if (!supabase) redirect(`${RESET_PATH}?xata=config`);

  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) redirect(`${RESET_PATH}?xata=expired`);

  const { error: updateError } = await supabase.auth.updateUser({ password });
  if (updateError) {
    const outcome = updatePasswordOutcome(updateError);
    logAuth("password change", outcome);
    redirect(`${RESET_PATH}?xata=${outcome.reason}`);
  }

  // Whoever just proved they own the account starts afresh on both forms.
  await forgetFailures();

  // updateUser keeps the session, so they are already signed in with the new
  // password — no second trip through the login form.
  redirect("/my/account?uqtur=password_changed");
}
