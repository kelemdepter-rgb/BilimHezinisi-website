"use server";

import { redirect } from "next/navigation";
import type { AuthError } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ensureAdminBootstrap } from "@/lib/auth/bootstrap";
import {
  PASSWORD_RESET_RULE,
  SIGN_IN_RULE,
  SIGN_UP_RULE,
  callerKey,
  isRateLimited,
} from "@/lib/rate-limit";
import { absoluteUrl } from "@/lib/seo";

/** Where a recovery link ends up, and where the new password is set. */
const RESET_PATH = "/reset-password";

/**
 * Supabase auth error code → query key understood by the login/register
 * pages. Anything unmapped falls back to a generic message, so the real
 * reason is logged server-side to keep it diagnosable.
 */
const SIGN_UP_REASONS: Record<string, string> = {
  user_already_exists: "exists",
  email_exists: "exists",
  email_address_invalid: "bad_email",
  weak_password: "short",
  signup_disabled: "disabled",
  email_provider_disabled: "provider_off",
  over_email_send_rate_limit: "email_limit",
  over_request_rate_limit: "rate_limit",
};

const SIGN_IN_REASONS: Record<string, string> = {
  invalid_credentials: "credentials",
  email_not_confirmed: "unconfirmed",
  email_provider_disabled: "provider_off",
  over_request_rate_limit: "rate_limit",
};

function reasonFor(error: AuthError, table: Record<string, string>, fallback: string) {
  const mapped = error.code ? table[error.code] : undefined;
  if (!mapped) {
    // Never log tokens or passwords — only the provider's own error fields.
    console.error("[auth] unmapped error", {
      code: error.code,
      status: error.status,
      message: error.message,
    });
  }
  return mapped ?? fallback;
}

export async function signInAction(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  if (!email || !password) redirect("/login?xata=empty");

  // Turned away before the request reaches Supabase at all.
  if (isRateLimited(`signin:${await callerKey()}`, SIGN_IN_RULE)) {
    redirect("/login?xata=rate_limit");
  }

  const supabase = await createSupabaseServerClient();
  if (!supabase) redirect("/login?xata=config");

  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error || !data.user) {
    redirect(`/login?xata=${error ? reasonFor(error, SIGN_IN_REASONS, "failed") : "failed"}`);
  }

  await ensureAdminBootstrap(data.user.id, data.user.email);
  redirect("/");
}

export async function signUpAction(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const displayName = String(formData.get("display_name") ?? "").trim();
  if (!email || !password) redirect("/register?xata=empty");
  if (password.length < 6) redirect("/register?xata=short");

  // Each signup costs an email send, which is the scarcest thing here.
  if (isRateLimited(`signup:${await callerKey()}`, SIGN_UP_RULE)) {
    redirect("/register?xata=rate_limit");
  }

  const supabase = await createSupabaseServerClient();
  if (!supabase) redirect("/register?xata=config");

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { display_name: displayName } },
  });
  if (error) {
    redirect(`/register?xata=${reasonFor(error, SIGN_UP_REASONS, "failed")}`);
  }

  if (data.session && data.user) {
    // Email confirmation disabled — signed in immediately.
    await ensureAdminBootstrap(data.user.id, data.user.email);
    redirect("/");
  }
  // Email confirmation enabled — a verification link was sent.
  redirect("/login?uqtur=confirm");
}

export async function signOutAction() {
  const supabase = await createSupabaseServerClient();
  if (supabase) await supabase.auth.signOut();
  redirect("/");
}

const RESET_REASONS: Record<string, string> = {
  email_address_invalid: "bad_email",
  over_email_send_rate_limit: "email_limit",
  over_request_rate_limit: "rate_limit",
  email_provider_disabled: "provider_off",
};

const UPDATE_PASSWORD_REASONS: Record<string, string> = {
  weak_password: "short",
  same_password: "same",
  session_not_found: "expired",
  over_request_rate_limit: "rate_limit",
};

/**
 * Send a password-recovery email.
 *
 * The answer is deliberately the same whether or not the address has an
 * account: anything else turns this form into a way to ask the site which of
 * a list of emails are registered here. Supabase's own response does not
 * distinguish either, so nothing but our own redirect could leak it.
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

  const supabase = await createSupabaseServerClient();
  if (!supabase) redirect("/forgot-password?xata=config");

  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: absoluteUrl(`/auth/callback?next=${encodeURIComponent(RESET_PATH)}`),
  });

  // Only failures that say nothing about THIS address are surfaced.
  if (error && (error.code === "over_email_send_rate_limit" || error.code === "email_provider_disabled")) {
    redirect(`/forgot-password?xata=${reasonFor(error, RESET_REASONS, "failed")}`);
  }
  if (error) reasonFor(error, RESET_REASONS, "failed"); // logs the unmapped ones

  redirect("/forgot-password?uqtur=sent");
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
    redirect(`${RESET_PATH}?xata=${reasonFor(updateError, UPDATE_PASSWORD_REASONS, "failed")}`);
  }

  // updateUser keeps the session, so they are already signed in with the new
  // password — no second trip through the login form.
  redirect("/my/account?uqtur=password_changed");
}
