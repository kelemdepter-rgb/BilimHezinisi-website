"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "@/components/icons";
import type { AdminNavLink } from "@/lib/admin/nav";

/**
 * Draws the entries the server chose (components/admin/admin-nav.tsx) and
 * marks the current one. Holds no list of its own: whatever is not passed in
 * does not exist in this browser.
 */
export function AdminNavLinks({ links }: { links: AdminNavLink[] }) {
  const pathname = usePathname();

  return (
    <nav
      aria-label="باشقۇرۇش تىزىملىكى"
      className="safe-x -mx-3 mb-5 overflow-x-auto overscroll-x-contain px-3 sm:mx-0 sm:px-0"
    >
      <ul className="flex w-max min-w-full gap-2">
        {links.map((link) => {
          const active =
            link.href === "/admin" ? pathname === "/admin" : pathname.startsWith(link.href);
          return (
            <li key={link.href}>
              <Link href={link.href} className={active ? "hbtn on" : "hbtn"} aria-current={active ? "page" : undefined}>
                <Icon name={link.icon} />
                {link.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
