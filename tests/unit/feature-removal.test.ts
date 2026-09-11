import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Features the owner withdrew must stay withdrawn.
 *
 * The book-request inbox was removed on 2026-09-11 — the page, the admin
 * inbox, the helpers, the rate-limit rule and the table. A deletion is only
 * finished when nothing refers to what was deleted, and the cheap way to keep
 * it finished is to fail the moment a reference comes back: a helper restored
 * from an old branch, a test that still names the table, a link pasted from a
 * commit before the removal.
 *
 * The needles are assembled at runtime so this file does not trip its own
 * scan. The one place the table's name may still be written is the pair of
 * migrations that created it and dropped it, which are history, not code.
 */

const ROOT = process.cwd();
const SCANNED = ["app", "components", "lib", "scripts", "tests"];

const NEEDLES = [
  ["book", "requests"].join("_"),
  ["/admin", "requests"].join("/"),
  ["request", "link"].join("-"),
  ["admin", "requests", "link"].join("-"),
  ["كىتاب", "تەلەپ"].join(" "),
];

function sourceFiles(): string[] {
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) {
        if (entry !== "node_modules" && entry !== ".auth") walk(path);
      } else if (/\.(?:tsx?|mjs|cjs|js|sql)$/.test(entry)) {
        found.push(path);
      }
    }
  };
  for (const dir of SCANNED) walk(join(ROOT, dir));
  return found;
}

describe("the book-request feature stays removed", () => {
  it("is named nowhere under app/, components/, lib/, scripts/ or tests/", () => {
    const offenders: string[] = [];
    for (const path of sourceFiles()) {
      const source = readFileSync(path, "utf8");
      for (const needle of NEEDLES) {
        if (source.includes(needle)) {
          offenders.push(`${relative(ROOT, path).replaceAll("\\", "/")}: ${needle}`);
        }
      }
    }
    expect(offenders, "a reference to the removed feature has come back").toEqual([]);
  });
});
