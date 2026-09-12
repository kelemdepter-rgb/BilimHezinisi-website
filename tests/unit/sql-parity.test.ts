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

/**
 * The same statement, defining the function under another name — so an
 * earlier body can be kept beside the shipped one and the two compared row
 * for row on one corpus. The body's own qualified parameter references
 * (`search_books.category_id`) follow the rename.
 */
function functionSqlAs(file: string, name: string, alias: string): string {
  return functionSql(file, name)
    .replace(`function public.${name}(`, `function public.${alias}(`)
    .replaceAll(`${name}.`, `${alias}.`);
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
    create table public.categories (
      id bigserial primary key,
      parent_id bigint references public.categories (id) on delete cascade,
      name text not null
    );
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
  // 0023 rewrites search_books once more — this time so a category means the
  // category and everything beneath it. It must change WHICH books are looked
  // at and nothing whatever about what matches inside them, which is exactly
  // what the assertions below still check, now against the shipped function.
  await db.exec(readFileSync(join(MIGRATIONS, "0023_search_category_tree.sql"), "utf8"));
  // 0025 rewrites both functions in PL/pgSQL so that every path is planned
  // with the real word and reads the index. Its bodies are 0023's and 0020's
  // line for line, and the last block below holds them to it: the earlier
  // bodies are kept here under other names and compared on the same corpus.
  await db.exec(functionSqlAs("0023_search_category_tree.sql", "search_books", "search_books_0023"));
  await db.exec(
    functionSqlAs("0020_faster_one_matcher.sql", "book_match_pages", "book_match_pages_0020"),
  );
  await db.exec(readFileSync(join(MIGRATIONS, "0025_search_uses_the_index.sql"), "utf8"));

  // Book 1 sits in a child category, so a search scoped to the parent has to
  // walk the tree to find it (0023) — and so both of 0025's statements, the
  // whole-library one and the scoped one, actually run here.
  await db.exec(`
    insert into public.categories (id, parent_id, name)
      values (1, null, 'ھەدىس'), (2, 1, 'سەھىھ ھەدىسلەر');
    select setval(pg_get_serial_sequence('public.categories', 'id'), 2);
    insert into public.books (id, title, author, category_id, status)
      values (1, 'سەھىھ ھەدىسلەر توپلىمى', 'سىناق', 2, 'published');
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

/**
 * 0025 moved both functions to PL/pgSQL, where the output columns and the
 * parameters are variables that share their names with columns in the
 * queries. An "ambiguous column" mistake there only shows when the statement
 * runs, so both of search_books' statements — the whole library and one
 * category — are called here, not just the one the tests above use.
 */
describe("search_books (0025) runs both of its statements", () => {
  it("answers the whole library and a category with the same page", async () => {
    for (const scope of [null, 1, 2]) {
      const rows = await db.query<{ page_no: number; snippet: string }>(
        `select page_no, snippet from public.search_books($1, $2, 20, 0)`,
        [PHRASE, scope],
      );
      expect(rows.rows.map((row) => row.page_no), `scope ${scope ?? "null"}`).toEqual([203]);
    }
  });

  it("finds a child's book when the parent category is searched, and not from elsewhere", async () => {
    // Book 1 is filed under category 2, whose parent is 1 (0023's walk).
    const found = async (scope: number) =>
      (
        await db.query<{ book_id: number }>(
          `select distinct book_id from public.search_books($1, $2, 20, 0)`,
          ["ناماز", scope],
        )
      ).rows.map((row) => Number(row.book_id));
    expect(await found(1)).toEqual([1]);
    expect(await found(2)).toEqual([1]);
    expect(await found(9999)).toEqual([]);
  });

  it("terminates on a category tree that has become a ring", async () => {
    await db.exec(`update public.categories set parent_id = 2 where id = 1`);
    try {
      const rows = await db.query<{ page_no: number }>(
        `select page_no from public.search_books($1, 1, 20, 0)`,
        [PHRASE],
      );
      expect(rows.rows.map((row) => row.page_no)).toEqual([203]);
    } finally {
      await db.exec(`update public.categories set parent_id = null where id = 1`);
    }
  });

  it("navigates one book on both sides of a draft", async () => {
    // book_match_pages qualifies book_id — parameter and column at once.
    const before = await db.query(`select page_no from public.book_match_pages(1, $1, 500)`, [PHRASE]);
    expect(before.rows.map((row) => (row as { page_no: number }).page_no)).toEqual([203]);
    await db.exec(`update public.books set status = 'draft' where id = 1`);
    try {
      const hidden = await db.query(`select page_no from public.book_match_pages(1, $1, 500)`, [PHRASE]);
      expect(hidden.rows).toEqual([]);
    } finally {
      await db.exec(`update public.books set status = 'published' where id = 1`);
    }
  });
});

/**
 * A word that occurs nowhere else, on exactly as many pages as the cap.
 * 301 candidates, not 300, is what makes `capped` true (0014): the extra row
 * tells "exactly 300 matches" from "more than we are willing to rank".
 */
const CAP_WORD = "چەكسىناق";

describe("the candidate cap", () => {
  beforeAll(async () => {
    await db.exec(`
      insert into public.books (id, title, author, category_id, status)
        values (2, 'چەك سىناق كىتابى', 'سىناق', 1, 'published');
      select setval(pg_get_serial_sequence('public.books', 'id'), 2);
      insert into public.book_pages (book_id, page_no, content)
        select 2, g, 'بۇ بەتتە ${CAP_WORD} دېگەن سۆز بار.' from generate_series(1, 300) as g;
    `);
  });

  const capped = async (scope: number | null) =>
    (
      await db.query<{ capped: boolean }>(
        `select capped from public.search_books($1, $2, 1, 0)`,
        [CAP_WORD, scope],
      )
    ).rows[0]?.capped;

  it("is not reached at 300 matching pages", async () => {
    expect(await capped(null)).toBe(false);
    expect(await capped(1)).toBe(false);
  });

  it("flips at the 301st, on the whole library and inside a category", async () => {
    await db.exec(
      `insert into public.book_pages (book_id, page_no, content) values (2, 301, 'يەنە بىر ${CAP_WORD}.')`,
    );
    expect(await capped(null)).toBe(true);
    expect(await capped(1)).toBe(true);
  });
});

/**
 * 0025 changed how the rows are found, and must not have changed the rows:
 * on this corpus — the phrase pages, the Arabic page, the punctuated page,
 * the capped book, a title hit through the author, an empty query, a scope
 * that does not exist — the PL/pgSQL bodies return exactly the rows, order,
 * ranks and snippets that 0023's search_books and 0020's book_match_pages
 * return, kept here under other names.
 */
describe("0025 answers exactly as 0023 and 0020 did", () => {
  const QUERIES = [PHRASE, "ناماز", "چالايلى", "الحمد", "قىيامەت كۈنى پىلسىرات", "", "   ", "سىناق", CAP_WORD];

  it("search_books: every query, every scope, every limit and offset", async () => {
    let compared = 0;
    for (const q of QUERIES) {
      for (const scope of [null, 1, 2, 9999]) {
        for (const [lim, off] of [
          [20, 0],
          [1, 0],
          [5, 2],
          [null, null],
          [0, 0],
        ]) {
          const shipped = await db.query(`select * from public.search_books($1, $2, $3, $4)`, [q, scope, lim, off]);
          const earlier = await db.query(`select * from public.search_books_0023($1, $2, $3, $4)`, [q, scope, lim, off]);
          expect(shipped.rows, `«${q}» scope ${scope ?? "null"} limit ${lim} offset ${off}`).toEqual(earlier.rows);
          compared += 1;
        }
      }
    }
    expect(compared).toBe(QUERIES.length * 4 * 5);
  });

  it("book_match_pages: every query, every book, every limit", async () => {
    for (const q of QUERIES) {
      for (const book of [1, 2, 42]) {
        for (const lim of [500, 2, null, 0]) {
          const shipped = await db.query(`select * from public.book_match_pages($1, $2, $3)`, [book, q, lim]);
          const earlier = await db.query(`select * from public.book_match_pages_0020($1, $2, $3)`, [book, q, lim]);
          expect(shipped.rows, `«${q}» book ${book} limit ${lim}`).toEqual(earlier.rows);
        }
      }
    }
  });
});
