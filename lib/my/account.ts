import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Role } from "@/lib/types";

/**
 * Everything one account owns: what an export has to contain, and what a
 * deletion has to remove. Keeping the list in one place is the point — a
 * future table that holds personal rows is added here once and both the
 * export and the deletion pick it up.
 *
 * `profiles` is not in the list: it is the parent every one of these cascades
 * from, and it goes with the auth user itself.
 */
export const PERSONAL_TABLES = [
  "bookmarks",
  "book_notes",
  "reading_progress",
  "recent_reads",
  "quran_bookmarks",
  "note_documents",
  /**
   * Always empty, and meant to be: AI runs entirely in the reader's browser,
   * so nothing writes here. The table stays because an applied migration is
   * never edited, and it stays in THIS list because if it ever did hold a row
   * it would be personal — an export must carry it and a deletion must take it.
   */
  "ai_usage",
] as const;

export type PersonalTable = (typeof PERSONAL_TABLES)[number];

export type AccountOwner = {
  userId: string;
  email: string;
  displayName: string;
  role: Role;
  createdAt: string;
};

/** The signed-in account, resolved server-side. Null when signed out. */
export async function getAccountOwner(): Promise<AccountOwner | null> {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return null;
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, display_name, created_at")
    .eq("id", user.id)
    .maybeSingle();

  const role: Role =
    profile?.role === "admin" || profile?.role === "uploader" ? profile.role : "reader";

  return {
    userId: user.id,
    email: user.email ?? "",
    displayName: (profile?.display_name as string | null) || user.email || "",
    role,
    createdAt: (profile?.created_at as string | null) ?? user.created_at,
  };
}

export type AccountExport = {
  exported_at: string;
  account: { email: string; display_name: string; role: Role; created_at: string };
} & Record<string, unknown>;

/**
 * Gather one account's own rows.
 *
 * Read with the CALLER's client, not the service role: RLS then guarantees
 * that even a mistake in this function cannot hand somebody another person's
 * notes. The owner is passed in so the caller has already proved who they are.
 */
export async function buildAccountExport(owner: AccountOwner): Promise<AccountExport | null> {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return null;

  const result: AccountExport = {
    exported_at: new Date().toISOString(),
    account: {
      email: owner.email,
      display_name: owner.displayName,
      role: owner.role,
      created_at: owner.createdAt,
    },
  };

  for (const table of PERSONAL_TABLES) {
    const { data, error } = await supabase.from(table).select("*").eq("user_id", owner.userId);
    // A table that fails to read must not silently look empty in the export.
    result[table] = error ? { error: "unavailable" } : (data ?? []);
  }

  return result;
}

/** How many admins the site has. Used to refuse deleting the last one. */
export async function countAdmins(): Promise<number | null> {
  const admin = createSupabaseAdminClient();
  if (!admin) return null;
  const { count, error } = await admin
    .from("profiles")
    .select("id", { count: "exact", head: true })
    .eq("role", "admin");
  return error ? null : (count ?? 0);
}

/**
 * Remove every row belonging to a user, then the auth user itself.
 *
 * The per-user rows would go anyway — each of these tables cascades from
 * `profiles`, which cascades from `auth.users` — but they are deleted
 * explicitly first so the promise made on /privacy holds even if a future
 * migration changes a foreign key. The auth user goes last: while it exists,
 * a half-finished deletion can still be retried.
 */
export async function purgeAccount(userId: string): Promise<{ ok: boolean; failedAt?: string }> {
  const admin = createSupabaseAdminClient();
  if (!admin) return { ok: false, failedAt: "config" };

  for (const table of PERSONAL_TABLES) {
    const { error } = await admin.from(table).delete().eq("user_id", userId);
    if (error) return { ok: false, failedAt: table };
  }

  const { error: profileError } = await admin.from("profiles").delete().eq("id", userId);
  if (profileError) return { ok: false, failedAt: "profiles" };

  const { error: authError } = await admin.auth.admin.deleteUser(userId);
  if (authError) return { ok: false, failedAt: "auth" };

  return { ok: true };
}

/** True when the user still owns a row anywhere. The deletion's own proof. */
export async function accountHasAnyData(userId: string): Promise<boolean | null> {
  const admin = createSupabaseAdminClient();
  if (!admin) return null;

  for (const table of PERSONAL_TABLES) {
    const { count, error } = await admin
      .from(table)
      .select("user_id", { count: "exact", head: true })
      .eq("user_id", userId);
    if (error) return null;
    if ((count ?? 0) > 0) return true;
  }

  const { count: profileCount, error: profileError } = await admin
    .from("profiles")
    .select("id", { count: "exact", head: true })
    .eq("id", userId);
  if (profileError) return null;
  return (profileCount ?? 0) > 0;
}
