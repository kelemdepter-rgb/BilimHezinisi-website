import type { IconName } from "@/components/icons";
import type { Role } from "@/lib/types";

export type AdminNavLink = { href: string; label: string; icon: IconName };

type Entry = AdminNavLink & { adminOnly?: boolean };

/**
 * Every entry of the admin navigation. Read on the SERVER only
 * (components/admin/admin-nav.tsx): the browser receives just the entries its
 * role may see, so an uploader's page — markup, data and scripts alike —
 * never carries the admin-only ones, not even hidden (owner, 2026-10-23).
 * The pages themselves re-check the role on the server as well.
 */
const ENTRIES: Entry[] = [
  { href: "/admin", label: "باشلىنىش", icon: "chart" },
  { href: "/admin/books", label: "كىتابلار", icon: "book" },
  { href: "/admin/categories", label: "تۈرلەر", icon: "layers" },
  { href: "/admin/users", label: "ئەزالار", icon: "user", adminOnly: true },
  { href: "/admin/visits", label: "دۆلەتلەر بويىچە كىرىش", icon: "globe", adminOnly: true },
];

/** The entries `role` may see, without the server-only flag. */
export function adminNavLinksFor(role: Role): AdminNavLink[] {
  return ENTRIES.filter((entry) => !entry.adminOnly || role === "admin").map(({ href, label, icon }) => ({
    href,
    label,
    icon,
  }));
}
