import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * CLAUDE.md bootstrap rule: the user whose email equals env ADMIN_EMAIL is
 * auto-promoted to admin on sign-in. Also mirrors the email into
 * settings.admin_email so the DB trigger promotes correctly on re-signup.
 * Never throws — a bootstrap failure must not break login.
 */
export async function ensureAdminBootstrap(userId: string, email: string | null | undefined) {
  const adminEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  if (!adminEmail || !email || email.trim().toLowerCase() !== adminEmail) return;
  const admin = createSupabaseAdminClient();
  if (!admin) return;
  try {
    await admin.from("profiles").update({ role: "admin" }).eq("id", userId);
    await admin
      .from("settings")
      .upsert({ key: "admin_email", value: adminEmail, is_public: false });
  } catch {
    // Silent: promotion retries on the next sign-in.
  }
}
