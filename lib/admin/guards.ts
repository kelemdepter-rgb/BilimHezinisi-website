import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Role } from "@/lib/types";

export type StaffSession = {
  userId: string;
  email: string;
  role: Role;
};

/**
 * Resolve the caller's role from the DATABASE on every call — never from a
 * client-supplied value or a JWT claim. Returns null when signed out or when
 * Supabase is not configured.
 */
export async function getServerRole(): Promise<StaffSession | null> {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return null;
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  const role: Role =
    profile?.role === "admin" || profile?.role === "uploader" ? profile.role : "reader";
  return { userId: user.id, email: user.email ?? "", role };
}

/** Throws unless the caller is an admin or uploader. Use in every mutating action. */
export async function requireStaff(): Promise<StaffSession> {
  const session = await getServerRole();
  if (!session || (session.role !== "admin" && session.role !== "uploader")) {
    throw new Error("FORBIDDEN");
  }
  return session;
}

/** Throws unless the caller is an admin. */
export async function requireAdmin(): Promise<StaffSession> {
  const session = await getServerRole();
  if (!session || session.role !== "admin") {
    throw new Error("FORBIDDEN");
  }
  return session;
}

export function isForbidden(error: unknown): boolean {
  return error instanceof Error && error.message === "FORBIDDEN";
}
