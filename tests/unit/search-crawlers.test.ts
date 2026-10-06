import { describe, expect, it, vi } from "vitest";

/**
 * Polite crawlers stay off search RESULT pages — each one is a database
 * search, and there is no end to them — while the search page itself stays
 * indexable (PROMPT-40, Part B5). This helps only with crawlers that ask
 * first; a flood ignores both rules.
 */

vi.mock("@/lib/data", () => ({ getCategories: async () => [], getCategoryCounts: async () => ({}) }));

import robots from "@/app/robots";
import { generateMetadata } from "@/app/search/page";

const metadataFor = (params: Record<string, string>) =>
  generateMetadata({ params: Promise.resolve({}), searchParams: Promise.resolve(params) } as PageProps<"/search">);

describe("robots.txt", () => {
  const rules = robots().rules;
  const rule = Array.isArray(rules) ? rules[0] : rules;
  const disallow = ([] as string[]).concat(rule.disallow ?? []);

  it("asks crawlers not to fetch any search result page", () => {
    expect(disallow).toContain("/search?");
  });

  it("still lets them fetch /search itself", () => {
    expect(rule.allow).toBe("/");
    expect(disallow).not.toContain("/search");
    // How a crawler reads it: a rule matches by prefix, and "/search?" is
    // not a prefix of "/search".
    expect("/search".startsWith("/search?")).toBe(false);
    expect("/search?q=ناماز".startsWith("/search?")).toBe(true);
  });
});

describe("the search page's metadata", () => {
  it("is noindex, follow for a result page", async () => {
    expect((await metadataFor({ q: "ناماز" })).robots).toEqual({ index: false, follow: true });
    expect((await metadataFor({ q: "ناماز", cat: "7", p: "2" })).robots).toEqual({ index: false, follow: true });
  });

  it("is index, follow for the search page with no word", async () => {
    expect((await metadataFor({})).robots).toEqual({ index: true, follow: true });
    expect((await metadataFor({ q: "   " })).robots).toEqual({ index: true, follow: true });
  });

  it("keeps one canonical address for all of them", async () => {
    expect((await metadataFor({ q: "ناماز" })).alternates).toEqual({ canonical: "/search" });
  });
});
