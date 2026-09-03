import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The site must never invite a browser to fill private data into it.
 *
 * On 2026-09-02 the owner tapped the header search box on his own Android
 * phone and Chrome's keyboard bar offered him a key, a card and a location
 * pin; the card chip listed his real bank cards. The page cannot see any of
 * that — it is browser chrome — but the hazard is real: the search form is a
 * GET, so a mis-tap would put a card number into `?q=` and from there into
 * the address bar, the browser history, the Referer header on every outbound
 * link, the access log, and the reader's own stored search history.
 *
 * He measured six variants on that phone. The icons appeared with no
 * `autocomplete` attribute and did NOT appear with `autocomplete="off"` on
 * both the form and the input. This test holds that configuration in place,
 * and fails the build if anyone ever:
 *
 *   1. removes `autocomplete="off"` from the search input or a search form;
 *   2. adds a payment, address or telephone autocomplete token anywhere;
 *   3. names a field after a card, an address or a telephone number;
 *   4. takes the identity tokens OFF the sign-in and sign-up forms — because
 *      a reader who cannot autofill a password picks a weaker one, and that
 *      would be a worse outcome than the scare this test exists to prevent.
 */

const ROOT = process.cwd();
const SCANNED = ["app", "components", "lib"];

function sourceFiles(): string[] {
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) {
        walk(path);
      } else if (/\.tsx?$/.test(entry)) {
        found.push(path);
      }
    }
  };
  for (const dir of SCANNED) walk(join(ROOT, dir));
  return found;
}

const FILES = sourceFiles().map((path) => ({
  path: relative(ROOT, path).replaceAll("\\", "/"),
  source: readFileSync(path, "utf8"),
}));

function read(file: string): string {
  const found = FILES.find((candidate) => candidate.path === file);
  if (!found) throw new Error(`${file} is gone — this test needs updating with it`);
  return found.source;
}

/**
 * The opening tag containing `needle`, from `<input`/`<textarea`/`<form` to
 * the `>` that closes it. Good enough for this codebase's JSX, where an
 * attribute value never contains a bare `>`.
 */
function tagContaining(source: string, tag: string, needle: string): string {
  let from = 0;
  for (;;) {
    const start = source.indexOf(`<${tag}`, from);
    if (start < 0) throw new Error(`no <${tag}> carrying ${needle}`);
    const end = source.indexOf(">", start);
    const text = source.slice(start, end + 1);
    if (text.includes(needle)) return text;
    from = start + 1;
  }
}

/** Every `autocomplete` value written as a literal, with the file it is in. */
function autocompleteValues(): { file: string; value: string }[] {
  const found: { file: string; value: string }[] = [];
  for (const { path, source } of FILES) {
    for (const match of source.matchAll(/autoComplete=(?:"([^"]*)"|\{"([^"]*)"\})/g)) {
      found.push({ file: path, value: match[1] ?? match[2] ?? "" });
    }
    // The object-spread form used by components/search/uyghur-text-field.tsx.
    for (const match of source.matchAll(/autoComplete:\s*"([^"]*)"/g)) {
      found.push({ file: path, value: match[1] });
    }
  }
  return found;
}

describe("the search box is marked so browsers do not autofill it", () => {
  it("carries autoComplete=off, and the rest of the 2026-09-02 configuration", () => {
    const input = tagContaining(read("components/search/search-field.tsx"), "input", 'name="q"');

    // The load-bearing one. Variant B of the phone test.
    expect(input, "the search input must carry autoComplete=off").toContain(
      'autoComplete="off"',
    );
    // Cheap, and they cover the password managers Chrome's setting does not.
    for (const attribute of [
      "autoCorrect=\"off\"",
      "autoCapitalize=\"off\"",
      "spellCheck={false}",
      "data-1p-ignore",
      'data-lpignore="true"',
      "data-bwignore",
      'data-form-type="other"',
    ]) {
      expect(input, `the search input must carry ${attribute}`).toContain(attribute);
    }
  });

  it("still submits as name=q to /search, which is what the results page reads", () => {
    const input = tagContaining(read("components/search/search-field.tsx"), "input", 'name="q"');
    expect(input).toContain('type="search"');
  });

  it.each([
    ["components/app-shell.tsx", 'className="sbox mx-2 hidden md:flex"'],
    ["components/app-shell.tsx", 'className="sbox flex"'],
    ["app/search/page.tsx", 'action="/search"'],
    ["app/quran/(index)/page.tsx", 'action="/quran"'],
    ["app/admin/books/page.tsx", 'role="search"'],
  ])("the form in %s carrying %s is marked too", (file, needle) => {
    const form = tagContaining(read(file), "form", needle);
    expect(form).toContain('autoComplete="off"');
  });
});

describe("no field anywhere asks for money, an address or a telephone", () => {
  /** Payment tokens, and the address/telephone tokens from the HTML spec. */
  const FORBIDDEN = [
    /^cc-/,
    /^street-address$/,
    /^address-(line|level)\d$/,
    /^postal-code$/,
    /^country(-name)?$/,
    /^tel(-.+)?$/,
    /^impp$/,
  ];

  it("uses no payment, address or telephone autocomplete token", () => {
    const offenders = autocompleteValues().filter(({ value }) =>
      FORBIDDEN.some((pattern) => pattern.test(value)),
    );
    expect(
      offenders.map(({ file, value }) => `${file}: autocomplete="${value}"`),
      "this site has no card, address or telephone field and must never claim to",
    ).toEqual([]);
  });

  it("names no field after a card, an address or a telephone number", () => {
    // Short tokens are matched whole (`cc` is inside "account"); the longer,
    // unambiguous ones are matched as substrings.
    const WHOLE = new Set(["cc", "cvv", "cvc", "csc", "iban", "zip", "tel", "phone"]);
    const SUBSTRING = ["creditcard", "cardnumber", "postal", "postcode", "street-address", "billing"];

    const offenders: string[] = [];
    for (const { path, source } of FILES) {
      for (const match of source.matchAll(/\b(?:name|id)="([^"]+)"/g)) {
        const value = match[1];
        const tokens = value.toLowerCase().split(/[-_\s.]+/);
        const flat = value.toLowerCase();
        if (tokens.some((token) => WHOLE.has(token)) || SUBSTRING.some((bad) => flat.includes(bad))) {
          offenders.push(`${path}: ${match[0]}`);
        }
      }
    }
    expect(offenders, "a field named like this is what frightens a reader").toEqual([]);
  });
});

describe("autofill still works where it should", () => {
  /**
   * Deliberately the mirror image of the rest of this file. Someone tightening
   * the screws further could easily strip these too, and a reader who cannot
   * autofill a password chooses a weaker one — which is a real security loss,
   * not a cosmetic one. The owner's instruction was explicit: do not touch
   * the sign-in forms.
   */
  it.each([
    ["app/(auth)/login/page.tsx", ['autoComplete="email"', 'autoComplete="current-password"']],
    ["app/(auth)/register/page.tsx", ['autoComplete="name"', 'autoComplete="email"', 'autoComplete="new-password"']],
    ["app/(auth)/forgot-password/page.tsx", ['autoComplete="email"']],
    ["app/(auth)/reset-password/page.tsx", ['autoComplete="new-password"']],
    ["app/request/page.tsx", ['autoComplete="email"']],
  ])("%s keeps its identity tokens", (file, expected) => {
    const source = read(file);
    for (const token of expected) expect(source, `${file} must keep ${token}`).toContain(token);
  });
});
