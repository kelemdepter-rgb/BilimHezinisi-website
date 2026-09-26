import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BLOCKED_PROVIDER_DOMAINS, BLOCKED_TLDS } from "@/lib/auth/blocked-email-domains";
import { DISPOSABLE_DOMAINS } from "@/lib/auth/disposable-domains";
import { AUTH_DOMAINS_SEED } from "../fixtures/pglite-auth";

/**
 * One source of truth for the domain lists (PROMPT-39, part A).
 *
 * The Server Actions read the TypeScript; the Before User Created hook reads
 * the database, which scripts/sync-auth-domains.mjs fills from the same
 * TypeScript and records in supabase/seed/auth_domains.sql. When a list
 * changes and the script is not re-run, this fails — so the site and the hook
 * can never quietly judge an address differently.
 */

const HOW_TO_FIX = "re-run: node --use-system-ca scripts/sync-auth-domains.mjs --apply";

function seedArrays(): string[][] {
  const sql = readFileSync(AUTH_DOMAINS_SEED, "utf8");
  return [...sql.matchAll(/array\[([\s\S]*?)\]::text\[\]/g)].map((match) =>
    [...match[1].matchAll(/'((?:[^']|'')*)'/g)].map((value) => value[1].replaceAll("''", "'")),
  );
}

const sorted = (values: Iterable<string>) => [...new Set(values)].sort();

describe("the hook's lists match the site's", () => {
  const [blocked, disposable] = seedArrays();

  it("holds exactly the Chinese-jurisdiction names the site blocks", () => {
    expect(blocked, HOW_TO_FIX).toEqual(sorted([...BLOCKED_TLDS, ...BLOCKED_PROVIDER_DOMAINS]));
  });

  it("holds exactly the disposable domains the site refuses", () => {
    expect(disposable.length, HOW_TO_FIX).toBe(DISPOSABLE_DOMAINS.length);
    expect(disposable, HOW_TO_FIX).toEqual(sorted(DISPOSABLE_DOMAINS));
  });
});
