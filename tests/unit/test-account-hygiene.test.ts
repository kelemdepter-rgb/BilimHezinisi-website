import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * No test account may be reachable by anyone who has read the repository.
 *
 * Until 2026-09-12 the suite signed in to the live project with accounts
 * whose addresses AND passwords were written into tests/env.ts — in a public
 * repository, on a public inbox service whose mail anyone can read. For the
 * length of every run, and for good if a run was cut short before its
 * teardown, that was a working uploader sign-in for the whole world.
 *
 * The accounts are now made at run time, with a password drawn from
 * crypto.randomBytes and an address on example.com, and are swept by the
 * `bh-e2e-` prefix at the start and end of every run. This test keeps it so:
 * it fails the moment a public-inbox address, a password constant or a
 * password property with a literal value is written under tests/ again —
 * including in a comment, because a password in a comment is still a
 * password in the repository.
 *
 * The needles and patterns are assembled at runtime so this file does not
 * trip its own scan. playwright.config.ts is scanned as well: it is test
 * code too, and the one file a constant could be moved to without being
 * under tests/.
 */

const ROOT = process.cwd();
const SCANNED_DIR = "tests";
const SCANNED_FILES = ["playwright.config.ts"];

const PUBLIC_INBOX = ["@mail", "inator", ".com"].join("");

/** An identifier ending in "password" assigned a quoted string. */
const PASSWORD_ASSIGNED_A_LITERAL = new RegExp(
  String.raw`\b[\w$]*pass` + String.raw`word\s*=\s*["'` + "`]",
  "i",
);
/** A "password" property given a quoted string — an object handed straight to a sign-in. */
const PASSWORD_PROPERTY_LITERAL = new RegExp(
  String.raw`\bpass` + String.raw`word\s*:\s*["'` + "`]",
  "i",
);

function testSources(): string[] {
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) {
        // .auth is where the run-time credentials live, on purpose and untracked.
        if (entry !== ".auth" && entry !== "node_modules") walk(path);
      } else if (/\.(?:tsx?|mjs|cjs|js)$/.test(entry)) {
        found.push(path);
      }
    }
  };
  walk(join(ROOT, SCANNED_DIR));
  for (const file of SCANNED_FILES) found.push(join(ROOT, file));
  return found;
}

const FILES = testSources().map((path) => ({
  path: relative(ROOT, path).replaceAll("\\", "/"),
  source: readFileSync(path, "utf8"),
}));

/** `file:line` for every line of `source` that `matches`. */
function offendingLines(file: string, source: string, matches: (line: string) => boolean): string[] {
  return source
    .split(/\r?\n/)
    .map((line, index) => (matches(line) ? `${file}:${index + 1}` : null))
    .filter((hit): hit is string => hit !== null);
}

describe("test accounts leave nothing readable in the repository", () => {
  it("names no address on a public inbox service", () => {
    const offenders = FILES.flatMap(({ path, source }) =>
      offendingLines(path, source, (line) => line.includes(PUBLIC_INBOX)),
    );
    expect(offenders, "a public-inbox address is back in the tests").toEqual([]);
  });

  it("assigns no string literal to a password", () => {
    const offenders = FILES.flatMap(({ path, source }) =>
      offendingLines(path, source, (line) => PASSWORD_ASSIGNED_A_LITERAL.test(line)),
    );
    expect(offenders, "a password constant is back in the tests").toEqual([]);
  });

  it("passes no string literal as a password property", () => {
    const offenders = FILES.flatMap(({ path, source }) =>
      offendingLines(path, source, (line) => PASSWORD_PROPERTY_LITERAL.test(line)),
    );
    expect(offenders, "a literal password is being handed to a sign-in").toEqual([]);
  });

  it("would catch each shape it exists for", () => {
    // Proof that the patterns bite, so a green run means something.
    expect(PASSWORD_ASSIGNED_A_LITERAL.test(`export const STAFF_PASS${"WORD"} = "bh-e2e-8842";`)).toBe(true);
    expect(PASSWORD_ASSIGNED_A_LITERAL.test(`const pass${"word"} = 'x';`)).toBe(true);
    expect(PASSWORD_ASSIGNED_A_LITERAL.test("const newPass" + "word = `x`;")).toBe(true);
    expect(PASSWORD_PROPERTY_LITERAL.test(`  pass${"word"}: "bh-e2e-1001",`)).toBe(true);
    // And leave the honest shapes alone.
    expect(PASSWORD_ASSIGNED_A_LITERAL.test(`const pass${"word"} = freshPassword();`)).toBe(false);
    expect(PASSWORD_PROPERTY_LITERAL.test(`  pass${"word"}: oldPassword,`)).toBe(false);
    expect(PASSWORD_PROPERTY_LITERAL.test(`  pass${"word"}: string,`)).toBe(false);
    expect(PASSWORD_ASSIGNED_A_LITERAL.test(`page.locator('input[name="pass${"word"}"]')`)).toBe(false);
  });
});
