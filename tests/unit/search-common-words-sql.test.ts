import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Migration 0029 (PROMPT-41) against a real Postgres (PGlite), on a library
 * shaped like the one that broke:
 *
 *   - «ئاللاھ» common but GATHERED in the last books in key order, as it is
 *     live (3,613 of 19,596 pages, in a few books) — the shape that made the
 *     planner walk the books one by one and time out — and on only 8 pages of
 *     the biggest book, the shape that made the navigator walk that book;
 *   - two words on EVERY page, side by side on just one page that lies past
 *     the 1,000th page holding both — the bound on pages a phrase may open;
 *   - two words on every page of the biggest book, side by side on its 5th;
 *   - two words sharing only 900 pages, side by side on the 899th.
 *
 * What is proved: every query 0028 answered completely is answered row for
 * row, rank for rank, snippet for snippet the same; the common word and the
 * navigator read the index and answer inside a budget; a phrase opens at most
 * 1,000 pages and says `partial` when that left pages unopened — with a
 * flags-only row when nothing turned up; and everything 0028 put in front of
 * the work (the slot) and around it (security definer, search_path, grants)
 * is still there, with the new helpers out of the API's reach.
 *
 * Timing is wall clock: PGlite cannot fire statement_timeout (0025's tests).
 */

const MIGRATIONS = join(process.cwd(), "supabase", "migrations");

function functionSql(file: string, name: string): string {
  const sql = readFileSync(join(MIGRATIONS, file), "utf8");
  const start = sql.indexOf(`create or replace function public.${name}`);
  if (start < 0) throw new Error(`${name} not found in ${file}`);
  const end = sql.indexOf("$fn$;", start);
  return sql.slice(start, end + "$fn$;".length);
}

/** An earlier body under another name, for row-for-row comparison. */
function functionSqlAs(file: string, name: string, alias: string): string {
  return functionSql(file, name)
    .replace(`function public.${name}(`, `function public.${alias}(`)
    .replaceAll(`${name}.`, `${alias}.`);
}

const MIGRATION_0029 = readFileSync(join(MIGRATIONS, "0029_search_common_words.sql"), "utf8");

const HARD = "ئاللاھ";
const COMMON = "پەيغەمبەر";
/** On every page; side by side only on BIG_BOOK page LATE_PAGE. */
const LATE_PHRASE = ["مۇبارەك", "ئايەت"] as const;
const LATE_PAGE = 1400;
/** On every page of the biggest book; side by side on its EARLY_PAGE. */
const EARLY_PHRASE = ["ساۋاب", "ئەمەل"] as const;
const EARLY_PAGE = 5;
/** Together on SHARED pages of the biggest book only; side by side on the last but one. */
const SHARED_PHRASE = ["رەھمەت", "دۇئا"] as const;
const SHARED = 900;
const OPEN_BOUND = 1000;

const BIG_BOOK = 1;
const BIG_BOOK_PAGES = 1500;
/** Pages of the biggest book that carry the hard word: as few as live. */
const HARD_IN_BIG_BOOK = [100, 400, 700, 900, 1100, 1250, 1300, 1450];

/**
 *   1 تارىخ            books 2, 3, 4
 *     2 ئىسلام تارىخى    book 1 (the big one), books 5, 6
 *       3 خەلىپىلەر      books 7, 8, 9
 *   4 ئەدەبىيات         books 10, 11 — where the hard word gathers
 */
const BOOKS: { id: number; category: number; pages: number }[] = [
  { id: 1, category: 2, pages: BIG_BOOK_PAGES },
  ...[2, 3, 4].map((id) => ({ id, category: 1, pages: 160 })),
  ...[5, 6].map((id) => ({ id, category: 2, pages: 160 })),
  ...[7, 8, 9].map((id) => ({ id, category: 3, pages: 160 })),
  ...[10, 11].map((id) => ({ id, category: 4, pages: 260 })),
];

function corpus(): (book: number, page: number) => string {
  let seed = 20261005;
  const random = () => {
    seed = (seed * 48271) % 2147483647;
    return seed / 2147483647;
  };
  const letters = "بپتجچخدرزژسشغفقكگڭلمنھوۇۆۈۋېىي";
  const vocabulary = Array.from({ length: 20000 }, () => {
    const length = 3 + Math.floor(random() * 7);
    let word = "";
    for (let i = 0; i < length; i += 1) word += letters[Math.floor(random() * letters.length)];
    return word;
  });
  const pick = () =>
    vocabulary[Math.min(vocabulary.length - 1, Math.floor(random() ** 2.2 * vocabulary.length))];

  return (book, page) => {
    const words: string[] = [];
    for (let k = 0; k < 300; k += 1) words.push(pick());
    if (random() < 0.85) words[20] = COMMON;
    if (random() < 0.2) words[30] = "نامازنى";
    if (random() < 0.03) words[40] = "زاكات";
    if (book >= 10 ? random() < 0.95 : book === BIG_BOOK && HARD_IN_BIG_BOOK.includes(page)) words[60] = HARD;

    // Both words everywhere, far apart …
    words[100] = LATE_PHRASE[0];
    words[250] = LATE_PHRASE[1];
    // … and side by side once, late.
    if (book === BIG_BOOK && page === LATE_PAGE) words[101] = LATE_PHRASE[1];

    if (book === BIG_BOOK) {
      words[120] = EARLY_PHRASE[0];
      words[270] = EARLY_PHRASE[1];
      if (page === EARLY_PAGE) words[121] = EARLY_PHRASE[1];
      if (page <= SHARED) {
        words[140] = SHARED_PHRASE[0];
        words[290] = SHARED_PHRASE[1];
        if (page === SHARED - 1) words[141] = SHARED_PHRASE[1];
      }
    }
    return words.join(" ");
  };
}

let db: PGlite;

async function indexScans(): Promise<number> {
  await db.query(`select pg_stat_force_next_flush()`);
  await db.query(`select 1`);
  const result = await db.query<{ idx_scan: number }>(
    `select idx_scan from pg_stat_user_indexes where indexrelname = 'book_pages_fts_idx'`,
  );
  return Number(result.rows[0]?.idx_scan ?? 0);
}

async function timed<T>(sql: string, params: unknown[]): Promise<{ ms: number; rows: T[] }> {
  const started = performance.now();
  const result = await db.query<T>(sql, params);
  return { ms: performance.now() - started, rows: result.rows };
}

type Row = {
  book_id: number | null;
  page_no: number | null;
  rank: number | null;
  snippet: string | null;
  capped: boolean;
  partial?: boolean;
};

const search = (fn: "search_books" | "search_books_0028", q: string, category: number | null, lim = 300) =>
  db.query<Row>(`select * from public.${fn}($1, $2, $3, 0)`, [q, category, lim]).then((result) => result.rows);

beforeAll(async () => {
  db = await new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role;`);
  await db.exec(`
    create table public.categories (
      id bigint primary key,
      parent_id bigint references public.categories (id),
      name text not null
    );
    create table public.books (
      id bigint primary key,
      title text not null default '',
      author text not null default '',
      cover_path text,
      category_id bigint references public.categories (id),
      status text not null default 'published',
      page_count int not null default 0
    );
    create table public.book_pages (
      book_id bigint not null references public.books (id),
      page_no int not null,
      content text not null,
      primary key (book_id, page_no)
    );
    insert into public.categories values
      (1, null, 'تارىخ'), (2, 1, 'ئىسلام تارىخى'), (3, 2, 'خەلىپىلەر'), (4, null, 'ئەدەبىيات');
  `);

  // Books in key order, pages in page order: the heap's order is the order
  // the index hands pages over in, so "the first 1,000 pages holding both
  // words" are pages 1–1,000 of the biggest book.
  const page = corpus();
  for (const book of BOOKS) {
    await db.query(
      `insert into public.books (id, title, author, category_id, status, page_count)
       values ($1, $2, 'سىناق', $3, 'published', $4)`,
      [book.id, `${book.id}-كىتاب`, book.category, book.pages],
    );
    for (let start = 1; start <= book.pages; start += 250) {
      const values: string[] = [];
      const params: unknown[] = [];
      for (let pageNo = start; pageNo < Math.min(start + 250, book.pages + 1); pageNo += 1) {
        params.push(book.id, pageNo, page(book.id, pageNo));
        values.push(`($${params.length - 2}, $${params.length - 1}, $${params.length})`);
      }
      await db.query(`insert into public.book_pages values ${values.join(",")}`, params);
    }
  }
  // A draft that carries everything: never a result, never a page opened.
  await db.query(
    `insert into public.books (id, title, author, category_id, status, page_count) values (12, 'قارالما', 'سىناق', 2, 'draft', 1)`,
  );
  await db.query(`insert into public.book_pages values (12, 1, $1)`, [
    `${LATE_PHRASE.join(" ")} ${EARLY_PHRASE.join(" ")} ${SHARED_PHRASE.join(" ")} ${HARD} ${COMMON}`,
  ]);

  await db.exec(functionSql("0002_fix_ug_normalize.sql", "ug_normalize"));
  await db.exec(functionSql("0017_phrase_search.sql", "ug_tsquery"));
  await db.exec(readFileSync(join(MIGRATIONS, "0019_one_matcher.sql"), "utf8"));
  await db.exec(readFileSync(join(MIGRATIONS, "0020_faster_one_matcher.sql"), "utf8"));
  await db.exec(readFileSync(join(MIGRATIONS, "0023_search_category_tree.sql"), "utf8"));
  await db.exec(readFileSync(join(MIGRATIONS, "0025_search_uses_the_index.sql"), "utf8"));
  await db.exec(readFileSync(join(MIGRATIONS, "0028_search_concurrency_gate.sql"), "utf8"));
  // 0028's bodies under their own names: what every answer is held to.
  await db.exec(functionSqlAs("0028_search_concurrency_gate.sql", "search_books", "search_books_0028"));
  await db.exec(functionSqlAs("0028_search_concurrency_gate.sql", "book_match_pages", "book_match_pages_0028"));
  await db.exec(MIGRATION_0029);
  await db.exec(`analyze public.books; analyze public.categories; analyze public.book_pages;`);
}, 240_000);

afterAll(async () => {
  await db?.close();
});

describe("the corpus", () => {
  it("has the shapes this file is about", async () => {
    const count = async (q: string, query = "public.ug_tsquery") =>
      Number(
        (
          await db.query<{ n: number }>(
            `select count(*)::int as n from public.book_pages p join public.books b on b.id = p.book_id
             where b.status = 'published' and to_tsvector('simple', public.ug_normalize(p.content)) @@ ${query}($1)`,
            [q],
          )
        ).rows[0].n,
      );
    const allWords = "private.ug_tsquery_all_words";
    expect(await count(HARD)).toBeGreaterThan(300);
    expect(await count(COMMON)).toBeGreaterThan(300);
    // Both words on every published page, the phrase on one of them.
    expect(await count(LATE_PHRASE.join(" "), allWords)).toBe(3300);
    expect(await count(LATE_PHRASE.join(" "))).toBe(1);
    expect(await count(SHARED_PHRASE.join(" "), allWords)).toBe(SHARED);
  }, 120_000);
});

describe("what 0028 answered in full, 0029 answers the same", () => {
  const CASES: [string, number | null][] = [
    ["زاكات", null],
    ["زاكات", 1],
    [HARD, 2],
    [HARD, 3],
    [SHARED_PHRASE.join(" "), null],
    [SHARED_PHRASE.join(" "), 2],
    ["سىناق", null],
    ["قققزززخخخ", null],
    ["قققزززخخخ", 4],
    [`${SHARED_PHRASE.join(" ")} قققزززخخخ`, null],
  ];

  for (const [q, category] of CASES) {
    it(`«${q}» in ${category === null ? "the whole library" : `category ${category}`}`, async () => {
      const before = await search("search_books_0028", q, category);
      const after = await search("search_books", q, category);
      expect(before.some((row) => row.capped), "0028 answered in full").toBe(false);
      expect(after.every((row) => row.partial === false)).toBe(true);
      // 0028 has no `partial` column; everything else must match.
      const withoutPartial = (rows: Row[]) =>
        rows.map((row) => Object.fromEntries(Object.entries(row).filter(([key]) => key !== "partial")));
      expect(withoutPartial(after)).toEqual(withoutPartial(before));
    }, 60_000);
  }

  it("every limit and offset, an empty query, punctuation and a category that does not exist", async () => {
    let compared = 0;
    for (const q of ["زاكات", SHARED_PHRASE.join(" "), "", "   ", "سىناق", `«${SHARED_PHRASE[0]}» ${SHARED_PHRASE[1]}`]) {
      for (const scope of [null, 2, 9999]) {
        for (const [lim, off] of [
          [20, 0],
          [1, 0],
          [5, 2],
          [null, null],
          [0, 0],
        ]) {
          const params = [q, scope, lim, off];
          const after = await db.query<Row>(`select * from public.search_books($1, $2, $3, $4)`, params);
          const before = await db.query<Row>(`select * from public.search_books_0028($1, $2, $3, $4)`, params);
          expect(after.rows.every((row) => row.partial === false)).toBe(true);
          const withoutPartial = (rows: Row[]) =>
            rows.map((row) => Object.fromEntries(Object.entries(row).filter(([key]) => key !== "partial")));
          expect(withoutPartial(after.rows), `«${q}» scope ${scope} lim ${lim} off ${off}`).toEqual(
            withoutPartial(before.rows),
          );
          compared += 1;
        }
      }
    }
    expect(compared).toBe(6 * 3 * 5);
  }, 180_000);

  it("a word on more than 300 pages is still capped, with as many rows", async () => {
    for (const q of [COMMON, HARD, "نامازنى"]) {
      const before = await search("search_books_0028", q, null, 20);
      const after = await search("search_books", q, null, 20);
      expect(after.every((row) => row.capped && !row.partial)).toBe(true);
      expect(before.every((row) => row.capped)).toBe(true);
      expect(after).toHaveLength(before.length);
    }
  }, 60_000);
});

describe("the common word and the navigator read the index", () => {
  /**
   * PGlite, this machine: «ئاللاھ» over the whole library ~200 ms with 0029;
   * the walk the planner chose live passes 3,000 pages before the gathered
   * books at ~0.8 ms a page. A budget between the two, wide on both sides.
   */
  const BUDGET_MS = 1200;

  it("cannot be walked inside the budget: the sensitivity check", async () => {
    await db.exec(`set enable_bitmapscan = off;`);
    try {
      const walk = await timed(
        `select p.book_id from public.book_pages p join public.books b on b.id = p.book_id
         where b.status = 'published' and to_tsvector('simple', public.ug_normalize(p.content)) @@ public.ug_tsquery($1)
         order by p.book_id, p.page_no limit 301`,
        [HARD],
      );
      expect(walk.ms, "walking the books in key order to the 301st page").toBeGreaterThan(BUDGET_MS * 1.5);
    } finally {
      await db.exec(`reset enable_bitmapscan;`);
    }
  }, 120_000);

  it(`«${HARD}» over the whole library: inside ${BUDGET_MS} ms, from the index`, async () => {
    for (let run = 0; run < 3; run += 1) {
      const before = await indexScans();
      const call = await timed<Row>(`select * from public.search_books($1, null, 21, 0)`, [HARD]);
      expect(await indexScans(), `run ${run + 1} read book_pages_fts_idx`).toBeGreaterThan(before);
      expect(call.ms, `run ${run + 1}`).toBeLessThan(BUDGET_MS);
      expect(call.rows).toHaveLength(21);
      expect(call.rows.every((row) => row.capped)).toBe(true);
    }
  }, 60_000);

  it(`the navigator: «${HARD}» on ${HARD_IN_BIG_BOOK.length} pages of the biggest book, quickly and as 0028 counted`, async () => {
    const before = await indexScans();
    const call = await timed<{ page_no: number; hits: number }>(
      `select * from public.book_match_pages($1, $2, 500)`,
      [BIG_BOOK, HARD],
    );
    expect(await indexScans()).toBeGreaterThan(before);
    expect(call.ms).toBeLessThan(300);
    expect(call.rows.map((row) => row.page_no)).toEqual(HARD_IN_BIG_BOOK);
    const old = await db.query(`select * from public.book_match_pages_0028($1, $2, 500)`, [BIG_BOOK, HARD]);
    expect(call.rows).toEqual(old.rows);
  }, 60_000);

  it("the navigator answers every other shape as 0028 did", async () => {
    for (const [q, lim] of [
      [COMMON, 500],
      [COMMON, 20],
      ["زاكات", 500],
      [LATE_PHRASE.join(" "), 500],
      [EARLY_PHRASE.join(" "), 500],
      [SHARED_PHRASE.join(" "), 500],
      ["قققزززخخخ", 500],
    ] as [string, number][]) {
      const now = await db.query(`select * from public.book_match_pages($1, $2, $3)`, [BIG_BOOK, q, lim]);
      const old = await db.query(`select * from public.book_match_pages_0028($1, $2, $3)`, [BIG_BOOK, q, lim]);
      expect(now.rows, `«${q}» lim ${lim}`).toEqual(old.rows);
    }
    // A draft is nobody's to count.
    const draft = await db.query(`select * from public.book_match_pages(12, $1, 500)`, [HARD]);
    expect(draft.rows).toEqual([]);
  }, 120_000);
});

describe(`a phrase opens at most ${OPEN_BOUND} pages`, () => {
  it("past the bound: nothing found there, so one flags-only row says partial", async () => {
    const rows = await search("search_books", LATE_PHRASE.join(" "), null, 21);
    expect(rows).toEqual([
      { book_id: null, title: null, author: null, cover_path: null, page_no: null, snippet: null, rank: null, capped: false, partial: true },
    ]);
    // 0028 opened every one of the 3,300 pages and found it.
    const old = await search("search_books_0028", LATE_PHRASE.join(" "), null, 21);
    expect(old.map((row) => [row.book_id, row.page_no])).toEqual([[BIG_BOOK, LATE_PAGE]]);
  }, 60_000);

  it("inside the bound: found, and still partial, because pages were left unopened", async () => {
    const rows = await search("search_books", EARLY_PHRASE.join(" "), null, 21);
    expect(rows.map((row) => [row.book_id, row.page_no, row.capped, row.partial])).toEqual([
      [BIG_BOOK, EARLY_PAGE, false, true],
    ]);
  }, 60_000);

  it("a category holding fewer pages with the words searches them all", async () => {
    // Category 1 and its children hold the big book; category 4 does not, and
    // its 520 pages are all opened.
    const rows = await search("search_books", LATE_PHRASE.join(" "), 4, 21);
    expect(rows).toEqual([]);
  }, 60_000);

  it("is the cheaper for it: bounded work, where 0028 opened every page", async () => {
    const q = LATE_PHRASE.join(" ");
    await search("search_books", q, null, 21);
    const bounded = await timed(`select * from public.search_books($1, null, 21, 0)`, [q]);
    const opened = await timed(`select * from public.search_books_0028($1, null, 21, 0)`, [q]);
    // 1,000 pages against 3,300: well under the ratio, on any machine.
    expect(bounded.ms).toBeLessThan(opened.ms * 0.6);
  }, 120_000);

  it("never opens a draft's page", async () => {
    const rows = await search("search_books", SHARED_PHRASE.join(" "), 2, 300);
    expect(rows.some((row) => row.book_id === 12)).toBe(false);
  }, 60_000);
});

describe("what 0029 adds is out of the API's reach, and 0028's gate is still first", () => {
  it("the helpers run for the search functions alone", async () => {
    for (const signature of ["private.matching_pages(tsquery, bigint[], int)", "private.ug_tsquery_all_words(text)"]) {
      for (const role of ["anon", "authenticated"]) {
        const result = await db.query<{ ok: boolean }>(
          `select has_function_privilege($1, $2, 'execute') as ok`,
          [role, signature],
        );
        expect(result.rows[0].ok, `${role} on ${signature}`).toBe(false);
      }
    }
    const config = await db.query<{ proconfig: string[] }>(
      `select proconfig from pg_proc where proname = 'matching_pages'`,
    );
    expect(config.rows[0].proconfig).toEqual(
      expect.arrayContaining(["enable_seqscan=off", "enable_indexscan=off", "enable_nestloop=off", "search_path=\"\""]),
    );
  });

  it("search_books keeps every attribute and grant, and gains `partial`", async () => {
    const fn = await db.query<{ prosecdef: boolean; proconfig: string[]; result: string }>(
      `select prosecdef, proconfig, pg_get_function_result(oid) as result
       from pg_proc where proname = 'search_books' and pronamespace = 'public'::regnamespace`,
    );
    expect(fn.rows).toHaveLength(1);
    expect(fn.rows[0].prosecdef).toBe(true);
    expect(fn.rows[0].proconfig).toEqual(
      expect.arrayContaining(["search_path=\"\"", "plan_cache_mode=force_custom_plan"]),
    );
    expect(fn.rows[0].result).toContain("capped boolean, partial boolean");
    for (const role of ["anon", "authenticated"]) {
      const grant = await db.query<{ ok: boolean }>(
        `select has_function_privilege($1, 'public.search_books(text, bigint, int, int)', 'execute') as ok`,
        [role],
      );
      expect(grant.rows[0].ok).toBe(true);
    }
  });

  it("takes its slot before any work, in both scopes and in the navigator", () => {
    const books = MIGRATION_0029.slice(MIGRATION_0029.indexOf("create function public.search_books("));
    const whole = books.indexOf("perform private.take_search_slot(1, 2);");
    const scoped = books.indexOf("perform private.take_search_slot(2, 3);");
    const work = books.indexOf("from private.matching_pages(");
    expect(whole).toBeGreaterThan(0);
    expect(scoped).toBeGreaterThan(whole);
    expect(work).toBeGreaterThan(scoped);
    const navigator = functionSql("0029_search_common_words.sql", "book_match_pages");
    expect(navigator.indexOf("perform private.take_search_slot(3, 2);")).toBeLessThan(
      navigator.indexOf("from private.matching_pages("),
    );
  });
});

describe("every word, anywhere: the superset the index answers", () => {
  it("is the phrase query itself for one word, and holds every page the phrase holds", async () => {
    const one = await db.query<{ same: boolean }>(
      `select private.ug_tsquery_all_words($1) = public.ug_tsquery($1) as same`,
      [HARD],
    );
    expect(one.rows[0].same).toBe(true);

    for (const q of [
      LATE_PHRASE.join(" "),
      EARLY_PHRASE.join(" "),
      `${SHARED_PHRASE.join("  ")}`,
      "ناماز-روزا قىلىش",
      "«ئاللاھ» تائالا!",
      "قۇرئان 2:255 ئايەت",
      "   ",
    ]) {
      const outside = await db.query<{ n: number }>(
        `select count(*)::int as n from public.book_pages p
         where to_tsvector('simple', public.ug_normalize(p.content)) @@ public.ug_tsquery($1)
           and not to_tsvector('simple', public.ug_normalize(p.content)) @@ private.ug_tsquery_all_words($1)`,
        [q],
      );
      expect(outside.rows[0].n, `«${q}»`).toBe(0);
    }
  }, 120_000);
});
