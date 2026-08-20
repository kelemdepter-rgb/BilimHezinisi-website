/**
 * The service worker and the app must agree on the names, exactly.
 *
 * public/sw.js is loaded by the browser as a plain script: it cannot import
 * from lib/, so the cache names, the offline URL and the header proxy.ts
 * stamps are written down twice. A drift would not throw anywhere — the app
 * would simply measure and clear caches the worker is not using, and report
 * "0 B stored" over a full one.
 *
 * The worker's source is read as text rather than executed, because
 * evaluating it would need a ServiceWorkerGlobalScope that Node does not have.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  CACHEABLE_HEADER,
  OFFLINE_URL,
  SITE_CACHE_PREFIX,
  SW_CACHES,
  SW_VERSION,
} from "@/lib/pwa/constants";

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

const source = read("../../public/sw.js");

/** `const NAME = "value";` or `` const NAME = `value`; `` from the worker. */
function literal(name: string): string | null {
  const match = new RegExp(`const ${name} = ["\`]([^"\`]*)["\`];`).exec(source);
  return match ? match[1] : null;
}

describe("service worker constants", () => {
  it("uses the same cache version as the app", () => {
    expect(literal("VERSION")).toBe(SW_VERSION);
  });

  it("names every cache the app knows how to measure and clear", () => {
    // The worker builds its names from a template, so what is asserted here
    // is the stem — the version is checked separately above.
    const stems = ["shell", "docs", "text", "covers", "static"];
    for (const stem of stems) {
      expect(source, `sw.js must declare the ${stem} cache`).toContain(
        `bh-sw-${stem}-\${VERSION}`,
      );
      expect(SW_CACHES as readonly string[]).toContain(`bh-sw-${stem}-${SW_VERSION}`);
    }
    expect(SW_CACHES).toHaveLength(stems.length);
  });

  it("only sweeps its own caches, leaving the spellcheck dictionary alone", () => {
    expect(literal("SWEEP_PREFIX")).toBe("bh-sw-");
    // Everything the site stores shares this prefix, which is what the
    // account page's "reclaim space" button clears.
    for (const name of SW_CACHES) expect(name.startsWith(SITE_CACHE_PREFIX)).toBe(true);
    expect("bh-spelldict-v2".startsWith(SITE_CACHE_PREFIX)).toBe(true);
    expect("bh-spelldict-v2".startsWith("bh-sw-")).toBe(false);
  });

  it("agrees with the app on the offline page and the cacheability header", () => {
    expect(literal("OFFLINE_URL")).toBe(OFFLINE_URL);
    expect(literal("CACHEABLE_HEADER")).toBe(CACHEABLE_HEADER);
    // And the header actually gets set, on every page response.
    expect(read("../../proxy.ts")).toContain("response.headers.set(CACHEABLE_HEADER,");
  });
});

describe("what the worker refuses to store", () => {
  const privateList = /const PRIVATE_PREFIXES = \[([^\]]*)\]/.exec(source)?.[1] ?? "";

  it.each(["/admin", "/api/", "/auth/", "/my/", "/notes", "/login", "/register"])(
    "never touches %s",
    (prefix) => {
      expect(privateList).toContain(`"${prefix}"`);
    },
  );

  it("keeps no table but the ones whose rows are the same for everybody", () => {
    const tables = /const PUBLIC_TABLES = \[([^\]]*)\]/.exec(source)?.[1] ?? "";
    for (const table of ["book_pages", "books", "categories", "quran_suras", "quran_ayas"]) {
      expect(tables).toContain(`"${table}"`);
    }
    // The per-user tables are the whole reason this list is an allowlist.
    for (const table of [
      "bookmarks",
      "book_notes",
      "reading_progress",
      "recent_reads",
      "note_documents",
      "profiles",
      "ai_usage",
    ]) {
      expect(tables, `${table} is per-user and must never be cached`).not.toContain(table);
    }
  });

  it("stores a Supabase read only when it carried nothing but the anon key", () => {
    expect(source).toContain("isAnonymousRead");
    expect(source).toContain('request.headers.get("authorization") === `Bearer ${apikey}`');
  });

  it("stores a document only when the server said no session rendered it", () => {
    expect(source).toContain(`response.headers.get(CACHEABLE_HEADER) !== "1"`);
  });
});
