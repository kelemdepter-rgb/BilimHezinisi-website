import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { UsagePanel } from "@/components/admin/usage-panel";
import {
  SEARCH_HEALTH_NAMES,
  parseSearchHealth,
  runSearchHealthCheck,
  summarizeSearchHealth,
  type SearchHealth,
  type SearchHealthClient,
} from "@/lib/search/health";
import type { UsageReport } from "@/lib/usage";

/**
 * The daily search self-check, with the database stood in for. The three
 * calls are the fixed ones /api/health makes as an anonymous visitor; what is
 * proved here is the plumbing around them — the record written, the abort,
 * the line /admin shows — never the speed of a real search, which
 * scripts/search-timing.mjs measures against the live library.
 */

type Call = { fn: string; args: Record<string, unknown> };

function fakeClient(
  answer: (call: Call, signal: AbortSignal) => Promise<{ code?: string | null } | null>,
  largest: number | null = 1308,
): { client: SearchHealthClient; calls: Call[] } {
  const calls: Call[] = [];
  return {
    calls,
    client: {
      largestPublishedBook: async () => largest,
      call: (fn, args, signal) => {
        const call = { fn, args };
        calls.push(call);
        return answer(call, signal);
      },
    },
  };
}

const healthy: SearchHealth = {
  common: { ok: true, ms: 412, code: null, at: "2026-09-12T06:00:01.000Z" },
  nowhere: { ok: true, ms: 95, code: null, at: "2026-09-12T06:00:02.000Z" },
  navigator: { ok: true, ms: 388, code: null, at: "2026-09-12T06:00:03.000Z" },
};

describe("runSearchHealthCheck", () => {
  it("makes exactly the three fixed calls, in order, as the route describes them", async () => {
    const { client, calls } = fakeClient(async () => null);
    const health = await runSearchHealthCheck(client);

    expect(calls.map((call) => call.fn)).toEqual(["search_books", "search_books", "book_match_pages"]);
    expect(calls[0].args).toEqual({ q: "ناماز", category_id: null, lim: 1, off: 0 });
    expect(calls[1].args).toMatchObject({ category_id: null, lim: 1, off: 0 });
    expect(calls[1].args.q).not.toBe("ناماز");
    // The navigator runs on the published book with the most pages.
    expect(calls[2].args).toEqual({ book_id: 1308, q: "ناماز", lim: 500 });

    for (const name of SEARCH_HEALTH_NAMES) {
      expect(health[name].ok).toBe(true);
      expect(health[name].code).toBeNull();
      expect(health[name].ms).toBeGreaterThanOrEqual(0);
      expect(new Date(health[name].at).toISOString()).toBe(health[name].at);
    }
  });

  it("records the Postgres code of a failure — 57014 is a statement timeout", async () => {
    const { client } = fakeClient(async (call) =>
      call.args.q === "ناماز" && call.fn === "search_books" ? { code: "57014" } : null,
    );
    const health = await runSearchHealthCheck(client);
    expect(health.common).toMatchObject({ ok: false, code: "57014" });
    expect(health.nowhere.ok).toBe(true);
    expect(health.navigator.ok).toBe(true);
  });

  it("abandons a call that hangs, counts it as failed, and still finishes", async () => {
    const { client } = fakeClient(
      (call, signal) =>
        new Promise((resolve) => {
          if (call.fn !== "book_match_pages") return resolve(null);
          // Never answers on its own: only the abort ends it.
          signal.addEventListener("abort", () => resolve({ code: "" }));
        }),
    );
    const started = Date.now();
    const health = await runSearchHealthCheck(client, { timeoutMs: 50 });
    expect(Date.now() - started).toBeLessThan(2000);
    expect(health.navigator).toMatchObject({ ok: false, code: "aborted" });
    expect(health.common.ok).toBe(true);
  });

  it("survives a call that throws, and a library with no published book", async () => {
    const { client } = fakeClient(async () => {
      throw new Error("network");
    }, null);
    const health = await runSearchHealthCheck(client);
    expect(health.common).toMatchObject({ ok: false, code: "error" });
    expect(health.navigator).toMatchObject({ ok: false, code: "no-book" });
  });
});

describe("parseSearchHealth", () => {
  it("reads back what the route wrote, and nothing malformed", () => {
    expect(parseSearchHealth(JSON.parse(JSON.stringify(healthy)))).toEqual(healthy);
    expect(parseSearchHealth(null)).toBeNull();
    expect(parseSearchHealth("2026-09-12T06:00:00.000Z")).toBeNull();
    expect(parseSearchHealth({ common: healthy.common })).toBeNull();
    expect(parseSearchHealth({ ...healthy, nowhere: { ok: "yes" } })).toBeNull();
  });
});

describe("summarizeSearchHealth", () => {
  it("is calm when all three answered inside 1,500 ms", () => {
    const summary = summarizeSearchHealth(healthy);
    expect(summary.level).toBe("ok");
    expect(summary.text).toContain("ھەممىسى نورمال");
    expect(summary.text).toContain("412 ms");
    expect(summary.text).toContain("2026-09-12 06:00 (UTC)");
    expect(summary.text).not.toContain("⚠");
  });

  it("warns, naming what failed and when, on a timeout", () => {
    const summary = summarizeSearchHealth({
      ...healthy,
      common: { ok: false, ms: 3210, code: "57014", at: "2026-09-12T06:00:04.000Z" },
    });
    expect(summary.level).toBe("warning");
    expect(summary.text).toContain("⚠");
    expect(summary.text).toContain("57014");
    expect(summary.text).toContain("3210 ms");
    expect(summary.text).toContain("2026-09-12 06:00 (UTC)");
  });

  it("warns when a call answered but took longer than a reader should wait", () => {
    const summary = summarizeSearchHealth({
      ...healthy,
      navigator: { ok: true, ms: 2747, code: null, at: healthy.navigator.at },
    });
    expect(summary.level).toBe("warning");
    expect(summary.text).toContain("بەك ئاستا");
    expect(summary.text).toContain("2747 ms");
  });

  it("says the check has not run yet before the first daily run", () => {
    expect(summarizeSearchHealth(null).level).toBe("unknown");
  });
});

describe("the admin panel", () => {
  const report: UsageReport = {
    available: true,
    dbBytes: 51.5 * 1024 * 1024,
    storageBytes: 12 * 1024 * 1024,
    books: 50,
    pages: 17601,
    bytesPerBook: 1024 * 1024,
    remainingBooks: 440,
    dbLevel: "normal",
    storageLevel: "normal",
    lastPing: "2026-09-12T06:00:00.000Z",
    searchHealth: healthy,
  };

  it("shows the calm line under the ping when the check passed", () => {
    const html = renderToStaticMarkup(createElement(UsagePanel, { report }));
    expect(html).toContain('data-testid="last-ping"');
    expect(html).toMatch(/data-testid="search-health"[^>]*data-level="ok"/);
    expect(html).toContain("ھەممىسى نورمال");
  });

  it("shows the marked warning when the check failed", () => {
    const html = renderToStaticMarkup(
      createElement(UsagePanel, {
        report: {
          ...report,
          searchHealth: {
            ...healthy,
            nowhere: { ok: false, ms: 3102, code: "57014", at: healthy.nowhere.at },
          },
        },
      }),
    );
    expect(html).toMatch(/data-testid="search-health"[^>]*data-level="warning"/);
    expect(html).toContain("57014");
  });

  it("says the check has not run yet when nothing is stored", () => {
    const html = renderToStaticMarkup(
      createElement(UsagePanel, { report: { ...report, searchHealth: null } }),
    );
    expect(html).toMatch(/data-testid="search-health"[^>]*data-level="unknown"/);
  });
});
