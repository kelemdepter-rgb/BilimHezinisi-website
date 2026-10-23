import "server-only";
import { AdminNavLinks } from "@/components/admin/admin-nav-links";
import { adminNavLinksFor } from "@/lib/admin/nav";
import type { Role } from "@/lib/types";

/**
 * The admin navigation. A server component on purpose: it chooses the
 * entries for the verified role here (lib/admin/nav.ts), and only those
 * reach the browser — the admin-only «ئەزالار» and «دۆلەتلەر بويىچە كىرىش»
 * are absent from an uploader's page altogether, not merely hidden.
 */
export function AdminNav({ role }: { role: Role }) {
  return <AdminNavLinks links={adminNavLinksFor(role)} />;
}
