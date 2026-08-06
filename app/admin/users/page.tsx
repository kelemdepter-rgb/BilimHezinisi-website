import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Icon } from "@/components/icons";
import { UserTable, type UserRow } from "@/components/admin/user-table";
import { getServerRole } from "@/lib/admin/guards";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Role } from "@/lib/types";

export const metadata: Metadata = { title: "ئەزالار" };

export default async function AdminUsersPage() {
  // Admin-only: uploaders may manage books but never other people's roles.
  const session = await getServerRole();
  if (!session) redirect("/login");
  if (session.role !== "admin") redirect("/admin");

  const supabase = await createSupabaseServerClient();
  const { data: profiles } = (await supabase
    ?.from("profiles")
    .select("id, role, display_name, created_at")
    .order("created_at", { ascending: true })) ?? { data: null };

  // Emails live in auth.users, which only the service role may read. The key
  // stays on the server — nothing here reaches the client but the address.
  const admin = createSupabaseAdminClient();
  const emails = new Map<string, string>();
  if (admin) {
    const { data } = await admin.auth.admin.listUsers({ perPage: 200 });
    for (const user of data?.users ?? []) {
      if (user.email) emails.set(user.id, user.email);
    }
  }

  const users: UserRow[] = (profiles ?? []).map((profile) => ({
    id: profile.id as string,
    email: emails.get(profile.id as string) ?? "—",
    displayName: (profile.display_name as string | null) ?? "",
    role: (profile.role as Role) ?? "reader",
    createdAt: String(profile.created_at ?? "").slice(0, 10),
  }));

  return (
    <>
      <h1 className="flex items-center gap-2.5 text-xl font-bold">
        <Icon name="user" className="ic-lg text-am" />
        ئەزالار ۋە سالاھىيەتلەر
      </h1>
      <p className="mt-1.5 text-[13.5px] text-ink3">
        جەمئىي {users.length} ئەزا. سالاھىيەتنى ئۆزگەرتسىڭىز دەرھال كۈچكە ئىگە بولىدۇ.
      </p>

      <div className="mt-5">
        <UserTable users={users} currentUserId={session.userId} />
      </div>
    </>
  );
}
