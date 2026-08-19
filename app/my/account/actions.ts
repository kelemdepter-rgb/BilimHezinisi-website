"use server";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  accountHasAnyData,
  countAdmins,
  getAccountOwner,
  purgeAccount,
} from "@/lib/my/account";
import { reportServerError } from "@/lib/server-log";

const ACCOUNT_PATH = "/my/account";

/**
 * Delete the caller's own account and everything in it.
 *
 * Three gates, in this order:
 *  1. the session is re-read on the server — the form cannot say who it is;
 *  2. the typed email must match that session's own address, so the
 *     destructive step needs a deliberate act, not a stray tap;
 *  3. the last remaining admin is refused, because an account-less site
 *     cannot publish another book or promote anyone to fix it.
 */
export async function deleteAccountAction(formData: FormData) {
  const typedEmail = String(formData.get("confirm_email") ?? "").trim().toLowerCase();

  const owner = await getAccountOwner();
  if (!owner) redirect("/login");

  if (!typedEmail || typedEmail !== owner.email.trim().toLowerCase()) {
    redirect(`${ACCOUNT_PATH}?xata=email_mismatch`);
  }

  if (owner.role === "admin") {
    const admins = await countAdmins();
    if (admins === null) redirect(`${ACCOUNT_PATH}?xata=config`);
    if (admins <= 1) redirect(`${ACCOUNT_PATH}?xata=last_admin`);
  }

  let result;
  try {
    result = await purgeAccount(owner.userId);
  } catch (error) {
    reportServerError("my/account/delete", error);
    redirect(`${ACCOUNT_PATH}?xata=failed`);
  }
  if (!result.ok) {
    // The table name is useful in the platform log and useless to a visitor.
    reportServerError("my/account/delete", new Error(`purge stopped at ${result.failedAt}`));
    redirect(`${ACCOUNT_PATH}?xata=${result.failedAt === "config" ? "config" : "failed"}`);
  }

  // The promise on /privacy is "everything", so it is checked rather than
  // assumed. A leftover row means the deletion is reported as failed and can
  // be retried, instead of quietly leaving data behind.
  const leftovers = await accountHasAnyData(owner.userId);
  if (leftovers) {
    reportServerError("my/account/delete", new Error("rows survived the purge"));
    redirect(`${ACCOUNT_PATH}?xata=failed`);
  }

  // The auth user is gone; the cookies in this browser are now stale.
  const supabase = await createSupabaseServerClient();
  if (supabase) await supabase.auth.signOut();

  redirect("/?uqtur=account_deleted");
}
