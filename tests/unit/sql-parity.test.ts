import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { countOccurrences, findOccurrences } from "@/lib/search/occurrences";

/**
 * The client matcher is authoritative for what a match IS. SQL still decides
 * which pages come back, how many hits each has, and where the excerpt is cut —
 * so the two have to agree, or «12/47» counts occurrences the reader cannot
 * see and a result arrives with nothing to highlight.
 *
 * This runs the REAL migration files against a real Postgres (PGlite, the same
 * engine compiled to WebAssembly — no Docker, no network, no Supabase project),
 * so the SQL under test is the SQL that will be pasted into the SQL Editor,
 * not a copy of it that can drift.
 */
const MIGRATIONS = join(process.cwd(), "supabase", "migrations");

/** Pull one `create ... function` statement out of a migration, by name. */
function functionSql(file: string, name: string): string {
  const sql = readFileSync(join(MIGRATIONS, file), "utf8");
  const start = sql.indexOf(`create or replace function public.${name}`);
  if (start < 0) throw new Error(`${name} not found in ${file}`);
  const end = sql.indexOf("$fn$;", start);
  if (end < 0) throw new Error(`unterminated body for ${name} in ${file}`);
  return sql.slice(start, end + "$fn$;".length);
}

const PHRASE = "نامازغا چا";

/** Real text from book 72 p203 — the page the bug was reported on. */
const PAGE_203 =
  "مۇسۇلمانلار مەدىنىگە كەلگەندە، ھەممەيلەن نامازنىڭ ۋاقتىدا يىغىلاتتى، لېكىن " +
  "نامازغا چاقىرىدىغان ئىش يوق ئىدى. بىر كۈنى، ساھابىلار نامازغا چاقىرىش توغرۇلۇق " +
  "سۆزلىشىپ، بەزىلەر: ”ناسارالارغا ئوخشاش داڭ چالايلى“ دېسە، يەنە بەزىلەر: " +
  "”يەھۇدىيلارنىڭ بۇرغىسىغا ئوخشاش بۇرغا چالايلى“ دېدى. ئۆمەر رەزىيەللاھۇ ئەنھۇ: " +
  "”بىر كىشىنى نامازغا چاقىرىدىغانغا تەيىنلەيلى“ دېدى. پەيغەمبەر سەللاللاھۇ " +
  "ئەلەيھى ۋەسەللەم: «ھەي بىلال ئورنىڭدىن تۇر، نامازغا چاقىر!» دېدى.";

/** Only the standalone words — the ones ts_headline used to light up. */
const PAGE_NO_PHRASE =
  "ناسارالارغا ئوخشاش داڭ چالايلى دېسە، بۇرغا چالايلى دېدى. بىلال، چاقىر!";

/** Vocalised Arabic, where a normalized offset drifts furthest from the real one. */
const PAGE_ARABIC =
  "بِسْمِ ٱللَّهِ ٱلرَّحْمَٰنِ ٱلرَّحِيمِ ٱلْحَمْدُ لِلَّهِ رَبِّ ٱلْعَٰلَمِينَ " +
  "ٱلرَّحْمَٰنِ ٱلرَّحِيمِ مَٰلِكِ يَوْمِ ٱلدِّينِ ٱلْحَمْدُ لِلَّهِ";

/** FTS matches the lexemes adjacently, but the literal phrase is not there. */
const PAGE_PUNCTUATED = "ئۇ كىشىنى نامازغا، چاقىرىش ئۈچۈن ئەۋەتتى.";

/** What each seeded page holds, so parity is asserted against the real text. */
const PAGES: Record<number, string> = {
  203: PAGE_203,
  204: PAGE_NO_PHRASE,
  205: PAGE_ARABIC,
  206: PAGE_PUNCTUATED,
};

let db: PGlite;

beforeAll(async () => {
  db = await new PGlite();

  // Supabase grants to these; PGlite has neither, so the grants in the
  // migration would fail without them.
  await db.exec(`create role anon; create role authenticated;`);

  await db.exec(`
    create table public.books (
      id bigserial primary key,
      title text not null default '',
      author text not null default '',
      cover_path text,
      category_id bigint,
      status text not null default 'published'
    );
    create table public.book_pages (
      book_id bigint not null references public.books(id),
      page_no int not null,
      content text not null,
      primary key (book_id, page_no)
    );
  `);

  // The functions the new migration builds on, taken from the migrations that
  // introduced them.
  await db.exec(functionSql("0002_fix_ug_normalize.sql", "ug_normalize"));
  await db.exec(functionSql("0017_phrase_search.sql", "ug_tsquery"));

  // And the migrations under test, in full and in order — including their
  // grants, their `security definer` functions and their empty search_path, so
  // an unqualified reference would fail here rather than in production. 0020
  // rewrites what 0019 defines, so applying both is also what proves the pair
  // still agrees with the client after the speed work.
  await db.exec(readFileSync(join(MIGRATIONS, "0019_one_matcher.sql"), "utf8"));
  await db.exec(readFileSync(join(MIGRATIONS, "0020_faster_one_matcher.sql"), "utf8"));

  await db.exec(`
    insert into public.books (id, title, author, status)
      values (1, 'سەھىھ ھەدىسلەر توپلىمى', 'سىناق', 'published');
    select setval(pg_get_serial_sequence('public.books', 'id'), 1);
  `);
  await db.query(
    `insert into public.book_pages (book_id, page_no, content) values (1,203,$1),(1,204,$2),(1,205,$3),(1,206,$4)`,
    [PAGE_203, PAGE_NO_PHRASE, PAGE_ARABIC, PAGE_PUNCTUATED],
  );
});

afterAll(async () => {
  await db?.close();
});

async function one<T>(sql: string, params: unknown[] = []): Promise<T> {
  const result = await db.query<Record<string, unknown>>(sql, params);
  return Object.values(result.rows[0])[0] as T;
}

describe("ug_phrase_regex", () => {
  it("matches the phrase in ORIGINAL coordinates, diacritics and all", async () => {
    const matched = await one<string>(
      `select substring($1 from '(?i)' || public.ug_phrase_regex($2))`,
      [PAGE_ARABIC, "الحمد"],
    );
    // The regex works on the real text, so it returns the vocalised spelling —
    // which is exactly what the client highlights.
    expect(matched).toBe("ٱلْحَمْدُ");
  });

  it("does not match a standalone word starting with the last fragment", async () => {
    const matched = await one<string | null>(
      `select substring($1 from '(?i)' || public.ug_phrase_regex($2))`,
      [PAGE_NO_PHRASE, PHRASE],
    );
    expect(matched).toBeNull();
  });

  it("is null for input with nothing to search for", async () => {
    expect(await one<string | null>(`select public.ug_phrase_regex('')`)).toBeNull();
    expect(await one<string | null>(`select public.ug_phrase_regex('   ')`)).toBeNull();
  });

  it("treats regex metacharacters in a query as literal text", async () => {
    const found = await one<string | null>(
      `select substring('ئىزاھات (1) بار' from '(?i)' || public.ug_phrase_regex($1))`,
      ["(1)"],
    );
    expect(found).toBe("(1)");
  });
});

describe("ug_snippet", () => {
  it("returns a plain excerpt the client can find the phrase in", async () => {
    const snippet = await one<string>(`select public.ug_snippet($1, $2, 70)`, [PAGE_203, PHRASE]);

    expect(snippet).not.toContain("<mark>");
    // The whole point: the shared matcher finds the phrase in what SQL returned.
    const found = findOccurrences(snippet, PHRASE);
    expect(found.length).toBeGreaterThan(0);
    expect(snippet.slice(found[0].start, found[0].end)).toBe(PHRASE);
  });

  it("cuts a window around the FIRST occurrence and marks both ends as cut", async () => {
    const snippet = await one<string>(`select public.ug_snippet($1, $2, 40)`, [PAGE_203, PHRASE]);
    expect(snippet.startsWith("…")).toBe(true);
    expect(snippet.endsWith("…")).toBe(true);
    expect(snippet.length).toBeLessThan(PAGE_203.length);
  });

  it("keeps the vocalised spelling intact on an Arabic page", async () => {
    const snippet = await one<string>(`select public.ug_snippet($1, $2, 30)`, [
      PAGE_ARABIC,
      "الحمد",
    ]);
    const [match] = findOccurrences(snippet, "الحمد");
    expect(snippet.slice(match.start, match.end)).toBe("ٱلْحَمْدُ");
  });
});

describe("book_match_pages counts what the client marks", () => {
  it("agrees page by page", async () => {
    const rows = await db.query<{ page_no: number; hits: number }>(
      `select page_no, hits from public.book_match_pages(1, $1, 500) order by page_no`,
      [PHRASE],
    );

    // Only page 203 carries the literal phrase, four times.
    expect(rows.rows).toEqual([{ page_no: 203, hits: 4 }]);

    for (const row of rows.rows) {
      expect(row.hits).toBe(countOccurrences(PAGES[row.page_no], PHRASE));
    }
  });

  it("drops a page the index liked but the phrase is not on", async () => {
    // «نامازغا، چاقىرىش» satisfies 'نامازغا' <-> 'چا':* but is not the phrase.
    expect(countOccurrences(PAGE_PUNCTUATED, PHRASE)).toBe(0);
    const rows = await db.query<{ page_no: number }>(
      `select page_no from public.book_match_pages(1, $1, 500)`,
      [PHRASE],
    );
    expect(rows.rows.map((row) => row.page_no)).not.toContain(206);
  });

  it("counts a repeated single word the same way the client does", async () => {
    // «چالايلى» sits twice on page 203 and twice on 204 — the very word that
    // used to be highlighted by mistake is now simply a word you can search for.
    const rows = await db.query<{ page_no: number; hits: number }>(
      `select page_no, hits from public.book_match_pages(1, $1, 500) order by page_no`,
      ["چالايلى"],
    );

    expect(rows.rows).toEqual([
      { page_no: 203, hits: 2 },
      { page_no: 204, hits: 2 },
    ]);
    for (const row of rows.rows) {
      expect(row.hits).toBe(countOccurrences(PAGES[row.page_no], "چالايلى"));
    }
  });
});

describe("search_books returns only rows the client can highlight", () => {
  it("finds the phrase page and nothing else", async () => {
    const rows = await db.query<{ page_no: number; snippet: string }>(
      `select page_no, snippet from public.search_books($1, null, 20, 0)`,
      [PHRASE],
    );

    expect(rows.rows.map((row) => row.page_no)).toEqual([203]);
    for (const row of rows.rows) {
      expect(findOccurrences(row.snippet, PHRASE).length).toBeGreaterThan(0);
    }
  });

  it("never returns a snippet whose only match is a standalone «چالايلى»", async () => {
    const rows = await db.query<{ snippet: string }>(
      `select snippet from public.search_books($1, null, 20, 0)`,
      [PHRASE],
    );
    for (const row of rows.rows) {
      for (const occurrence of findOccurrences(row.snippet, PHRASE)) {
        expect(row.snippet.slice(occurrence.start, occurrence.end)).toBe(PHRASE);
      }
    }
  });

  it("returns nothing for a phrase that occurs nowhere", async () => {
    const rows = await db.query(`select page_no from public.search_books($1, null, 20, 0)`, [
      "قىيامەت كۈنى پىلسىرات",
    ]);
    expect(rows.rows).toEqual([]);
  });

  it("still matches the start of a word, the way the desktop does", async () => {
    // «ناماز» must find «نامازغا» and «نامازنىڭ» — the prefix behaviour 0015
    // added, which the literal check must not undo.
    const rows = await db.query<{ page_no: number }>(
      `select page_no from public.search_books($1, null, 20, 0)`,
      ["ناماز"],
    );
    expect(rows.rows.map((row) => row.page_no)).toContain(203);
  });
});
