/**
 * The promises the AI layer makes, checked against the source itself.
 *
 * "The owner pays nothing", "the key never reaches our server" and "nothing is
 * logged" are not properties any single function can be asked about — they are
 * properties of the whole tree. So this file reads the tree: it is the test
 * that fails the day somebody adds a route that takes a key, a console line
 * that prints a prompt, or a second host to the policy.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { buildContentSecurityPolicy, GEMINI_ORIGIN } from "@/lib/security/csp";
import {
  DEFAULT_MODEL,
  GEMINI_API_BASE,
  MODEL_INFO,
  PAID_ONLY_MODELS,
  SELECTABLE_MODELS,
  feeBadge,
  isPaidOnlyModel,
  isSelectableModel,
  modelOptionLabel,
} from "@/lib/ai/models";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

/** Every source file we ship, ignoring build output and dependencies. */
function sourceFiles(): string[] {
  const skip = new Set([
    "node_modules",
    ".next",
    ".next-e2e",
    ".git",
    "test-results",
    "migration-data",
    "backups",
    "_reference",
  ]);
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      if (skip.has(entry)) continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(ts|tsx|mjs|js)$/.test(entry)) out.push(full);
    }
  };
  walk(ROOT);
  return out;
}

const FILES = sourceFiles();
const read = (path: string) => readFileSync(path, "utf8");
const rel = (path: string) => relative(ROOT, path).replace(/\\/g, "/");

/** Code that actually ships — the tests below name forbidden things on purpose. */
const SHIPPED = FILES.filter((file) => !rel(file).startsWith("tests/"));

/** Prose about fetch() is not a call to it. */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

/* ── The owner never pays, and never holds anyone's secret ───────────────── */

describe("no server-side Gemini key", () => {
  it("has no GEMINI_API_KEY anywhere in the source", () => {
    const offenders = SHIPPED.filter((file) => read(file).includes("GEMINI_API_KEY")).map(rel);
    // CLAUDE.md and the skill name it on purpose, to forbid it, and so does the
    // test above — but nothing that ships may mention it at all.
    expect(offenders, "a server-side key would put a bill on the owner").toEqual([]);
  });

  it("keeps every key reader in the browser-only modules", () => {
    // readKeys/readKeySlots are the only ways to get at a key. Nothing under
    // app/ (route handlers, Server Actions, pages) may import them.
    const importers = SHIPPED.filter((file) => {
      const source = read(file);
      return /from "@\/lib\/ai\/storage"/.test(source) && /readKeys|readKeySlots/.test(source);
    }).map(rel);

    for (const file of importers) {
      expect(
        file.startsWith("lib/ai/") || file.startsWith("components/"),
        `${file} must not read a stored key — only browser code may`,
      ).toBe(true);
    }
    expect(importers.length).toBeGreaterThan(0);
  });

  it("has no server route that could receive a key", () => {
    const routes = SHIPPED.filter((file) => /^app\/.*route\.ts$/.test(rel(file)));
    for (const route of routes) {
      const source = read(route);
      expect(source, `${rel(route)} must not touch Gemini`).not.toContain("generativelanguage");
      expect(source, `${rel(route)} must not touch the AI storage`).not.toContain("lib/ai/");
    }
  });
});

/* ── Nothing is logged ───────────────────────────────────────────────────── */

describe("no logging in the AI layer", () => {
  it("has not one console call under lib/ai", () => {
    const offenders = SHIPPED.filter(
      (file) => rel(file).startsWith("lib/ai/") && /console\.\w+\(/.test(read(file)),
    ).map(rel);
    expect(
      offenders,
      "a key, a prompt or an answer must never be written to a log",
    ).toEqual([]);
  });

  it("only ever fetches Google, and only with the key in a header", () => {
    const client = read(join(ROOT, "lib/ai/client.ts"));
    // Every request in the module goes through the one wrapper, which builds
    // its URL from GEMINI_API_BASE.
    expect(withoutComments(client).match(/\bfetch\(/g) ?? []).toHaveLength(1);
    expect(client).toContain("x-goog-api-key");
    // A key in the query string ends up in history, in a referrer and in a
    // devtools list. The desktop learned this; so does this.
    expect(client).not.toContain("?key=");
    expect(client).not.toMatch(/key=\$\{/);
  });

  it("gives the service worker nothing it would ever cache", () => {
    const worker = read(join(ROOT, "public/sw.js"));
    // AI requests are POSTs, and the worker declines every non-GET on the
    // first line of its fetch handler — so no answer can end up in a cache
    // that the next person to use this browser could read.
    expect(worker).toContain('if (request.method !== "GET") return;');
    expect(read(join(ROOT, "lib/ai/client.ts"))).toContain('cache: "no-store"');
  });

  it("scrubs anything key-shaped out of a message before it can be shown", async () => {
    const { scrubKey } = await import("@/lib/ai/errors");
    const echoed =
      "API key not valid: api_key:AIzaSyRealLookingKey00000001 for AQ.abcdefghijklmnop";
    const clean = scrubKey(echoed);
    expect(clean).not.toContain("AIzaSyRealLookingKey00000001");
    expect(clean).not.toContain("AQ.abcdefghijklmnop");
    expect(clean).toContain("••••");
  });
});

/* ── The policy gained exactly one host ──────────────────────────────────── */

describe("the content security policy", () => {
  const policy = buildContentSecurityPolicy("testnonce", false);

  it("allows the host the client actually calls", () => {
    expect(GEMINI_API_BASE.startsWith(GEMINI_ORIGIN)).toBe(true);
    const connect = policy.split(";").find((part) => part.trim().startsWith("connect-src"));
    expect(connect).toContain(GEMINI_ORIGIN);
  });

  it("mentions it once, in connect-src, and nowhere else", () => {
    expect(policy.split(GEMINI_ORIGIN).length - 1).toBe(1);
    expect(policy).toContain("font-src 'self'");
    expect(policy).toContain("object-src 'none'");
    expect(policy).toContain("frame-src 'none'");
    expect(policy).not.toContain("unsafe-inline'; script-src");
  });
});

/* ── Three models, each labelled ─────────────────────────────────────────── */

describe("the model catalogue", () => {
  it("offers exactly the three that were verified, in order", () => {
    expect(SELECTABLE_MODELS).toEqual([
      "gemini-3.7-flash",
      "gemini-3.5-flash-lite",
      "gemini-3.1-pro-preview",
    ]);
    expect(DEFAULT_MODEL).toBe("gemini-3.7-flash");
  });

  it("does not carry the retired IDs back in", () => {
    // Replaced deliberately; a stale ID here would fail as a 404 at the worst
    // possible moment, mid-question.
    expect(SELECTABLE_MODELS as readonly string[]).not.toContain("gemini-3.5-flash");
    expect(SELECTABLE_MODELS as readonly string[]).not.toContain("gemini-3.1-flash-lite");
  });

  it("marks the one model that needs a paid key, and only that one", () => {
    expect(PAID_ONLY_MODELS).toEqual(["gemini-3.1-pro-preview"]);
    expect(isPaidOnlyModel("gemini-3.1-pro-preview")).toBe(true);
    expect(isPaidOnlyModel("gemini-3.7-flash")).toBe(false);
  });

  it("puts the badge in the option label itself", () => {
    // A native select renders the selected option's own text, so a badge that
    // lives in the label is visible closed AND open. Nobody should learn a
    // model costs money by hitting an error.
    expect(modelOptionLabel("gemini-3.7-flash")).toBe("gemini-3.7-flash — ھەقسىز");
    expect(modelOptionLabel("gemini-3.1-pro-preview")).toBe("gemini-3.1-pro-preview — پۇللۇق");
    for (const model of SELECTABLE_MODELS) {
      expect(modelOptionLabel(model)).toContain(feeBadge(model));
      // And the description under the picker must agree with the badge.
      expect(MODEL_INFO[model]).toContain(feeBadge(model));
    }
  });

  it("carries no price figures, because prices change", () => {
    for (const description of Object.values(MODEL_INFO)) {
      expect(description).not.toMatch(/\$|\d+\.\d{2}/);
    }
  });

  it("rejects a model it does not offer", () => {
    expect(isSelectableModel("gemini-3.7-flash")).toBe(true);
    expect(isSelectableModel("gemini-9.9-imaginary")).toBe(false);
    expect(isSelectableModel(null)).toBe(false);
  });
});
