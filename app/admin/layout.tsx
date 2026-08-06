import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Icon } from "@/components/icons";
import { AdminNav } from "@/components/admin/admin-nav";
import { hasSupabaseEnv } from "@/lib/env";
import { getSessionInfo } from "@/lib/data";

export const metadata: Metadata = { title: "باشقۇرۇش" };

/**
 * Server-side role guard — every /admin request re-verifies the role from
 * the database (profiles.role), never from client claims.
 */
export default async function AdminLayout({ children }: LayoutProps<"/admin">) {
  if (!hasSupabaseEnv()) {
    return (
      <div className="mx-auto max-w-md px-4 py-14 text-center">
        <Icon name="info" className="ic-lg mx-auto text-am" />
        <h1 className="mt-3 text-lg font-bold">ساندان تېخى ئۇلانمىغان</h1>
        <p className="mt-2 text-[13.5px] leading-7 text-ink2">
          Supabase مۇھىت ئۆزگەرگۈچىلىرى تەڭشەلگەندىن كېيىن باشقۇرۇش سۇپىسى ئېچىلىدۇ.
        </p>
      </div>
    );
  }

  const session = await getSessionInfo();
  if (!session) redirect("/login");
  if (session.role !== "admin" && session.role !== "uploader") redirect("/");

  return (
    <div className="px-3 py-5 sm:px-6 sm:py-7 lg:px-8">
      <AdminNav role={session.role} />
      {children}
    </div>
  );
}
