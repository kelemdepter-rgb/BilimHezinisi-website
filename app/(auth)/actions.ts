"use server";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ensureAdminBootstrap } from "@/lib/auth/bootstrap";

export async function signInAction(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  if (!email || !password) redirect("/login?xata=empty");

  const supabase = await createSupabaseServerClient();
  if (!supabase) redirect("/login?xata=config");

  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error || !data.user) {
    redirect(error?.code === "email_not_confirmed" ? "/login?xata=unconfirmed" : "/login?xata=credentials");
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
    redirect(error.code === "user_already_exists" ? "/register?xata=exists" : "/register?xata=failed");
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
