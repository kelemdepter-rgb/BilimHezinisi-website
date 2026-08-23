"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon, type IconName } from "@/components/icons";
import type { Role } from "@/lib/types";

const LINKS: { href: string; label: string; icon: IconName; adminOnly?: boolean }[] = [
  { href: "/admin", label: "باشلىنىش", icon: "chart" },
  { href: "/admin/books", label: "كىتابلار", icon: "book" },
  { href: "/admin/categories", label: "تۈرلەر", icon: "layers" },
  { href: "/admin/requests", label: "تەلەپلەر", icon: "mail", adminOnly: true },
  { href: "/admin/users", label: "ئەزالار", icon: "user", adminOnly: true },
];

export function AdminNav({ role }: { role: Role }) {
  const pathname = usePathname();
  const links = LINKS.filter((link) => !link.adminOnly || role === "admin");

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
