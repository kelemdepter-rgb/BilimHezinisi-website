import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { adminNavLinksFor } from "@/lib/admin/nav";

/**
 * The owner's rule (2026-10-23): «دۆلەتلەر بويىچە كىرىش» — and «ئەزالار» —
 * exist for the admin alone. Not hidden from an uploader: absent.
 */
describe("the admin navigation", () => {
  it("gives the admin every entry, the country tally included", () => {
    expect(adminNavLinksFor("admin").map((link) => link.href)).toEqual([
      "/admin",
      "/admin/books",
      "/admin/categories",
      "/admin/users",
      "/admin/visits",
    ]);
  });

  it.each(["uploader", "reader"] as const)("gives a %s neither the tally nor the members", (role) => {
    const links = adminNavLinksFor(role);
    expect(links.map((link) => link.href)).toEqual(["/admin", "/admin/books", "/admin/categories"]);
    expect(JSON.stringify(links)).not.toContain("دۆلەتلەر بويىچە كىرىش");
  });

  it("passes the browser no flag that would tell it an entry was held back", () => {
    for (const link of adminNavLinksFor("admin")) expect(Object.keys(link).sort()).toEqual(["href", "icon", "label"]);
  });

  it("keeps the list out of the browser's script: the client part has none of its own", () => {
    const client = readFileSync(join(process.cwd(), "components", "admin", "admin-nav-links.tsx"), "utf8");
    expect(client).toContain('"use client"');
    expect(client).not.toContain("/admin/visits");
    expect(client).not.toContain("/admin/users");
    // Only the type comes from lib/admin/nav, and a type import leaves no code behind.
    expect(client).toMatch(/import type \{ AdminNavLink \} from "@\/lib\/admin\/nav"/);
    expect(client.match(/from "@\/lib\/admin\/nav"/g)).toHaveLength(1);

    const server = readFileSync(join(process.cwd(), "components", "admin", "admin-nav.tsx"), "utf8");
    expect(server).not.toContain('"use client"');
    expect(server).toContain('import "server-only"');
  });
});
