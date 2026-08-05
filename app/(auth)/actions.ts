"use server";

import { redirect } from "next/navigation";
import type { AuthError } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ensureAdminBootstrap } from "@/lib/auth/bootstrap";

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
  over_email_send_rate_limit: "email_limit",
  over_request_rate_limit: "rate_limit",
};

const SIGN_IN_REASONS: Record<string, string> = {
  invalid_credentials: "credentials",
  email_not_confirmed: "unconfirmed",
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
