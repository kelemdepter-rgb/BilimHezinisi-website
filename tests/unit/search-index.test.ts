import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * A search path that stops using the index must fail HERE, not on the live
 * site.
 *
 * On 2026-09-11 every whole-library search on bilimhezinisi.com answered
 * «ئىزدەشتە خاتالىق كۆرۈلدى»: search_books and book_match_pages were running
 * ug_normalize() and to_tsvector() on every page in scope — ~0.85 ms a page,
 * 17,601 pages — instead of reading book_pages_fts_idx, and hit the 3 s
 * statement timeout anonymous visitors get. Nothing caught it: the parity
 * corpus in sql-parity.test.ts is a handful of pages, where any plan is fast.
 *
 * So this file seeds a corpus large enough for the two plans to be told
 * apart by the clock, builds the index the way migration 0025 does, and asks
 * three things of every path — the whole library, a large category and the
 * reader's navigator on the biggest book:
 *
 *   1. a word that occurs nowhere answers inside BUDGET_MS. PGlite cannot
 *      fire statement_timeout (nothing interrupts a running statement in
 *      WebAssembly), so the budget is a wall-clock assertion instead;
 *   2. the call raised idx_scan on book_pages_fts_idx — the index was read,
 *      whatever the clock said;
 *   3. the corpus really is big enough that walking the pages of the biggest
 *      book alone could not meet the budget, so a faster machine cannot let a
 *      per-page plan slip through.
 *
 * Measured on the machine this was written on (Windows 11, Node 22, PGlite
 * 0.5.5 = PostgreSQL 18), 3,300 pages averaging 2,098 characters, the
 * nowhere-word, the first call cold:
 *
 *   with the index    whole library                 14, 3, 3 ms
 *                     category 1 and its children   4, 6, 5 ms
 *                     navigator, the biggest book   3, 2, 2 ms
 *   without it        whole library (3,300 pages)   2,586 ms
 *                     category 1 (2,760 pages)      2,408 ms
 *                     the biggest book (1,500)      1,229 ms
 *
 * 150 ms sits ten times above the slowest indexed call and eight times below
 * the cheapest scan. Wide on both sides on purpose: a slow CI runner must not
 * fail this, and a fast one must not pass a scan.
 */
const BUDGET_MS = 150;

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

const MIGRATION_0025 = readFileSync(join(MIGRATIONS, "0025_search_uses_the_index.sql"), "utf8");

/** The word no page carries. The index answers it in milliseconds, or not. */
const NOWHERE = "قققزززخخخ";

/**
 * The corpus: one big book of BIG_BOOK_PAGES pages under a child category,
 * eight ordinary books spread over the same tree, and two books under an
 * unrelated category — so "a large category" (1, with its descendants) holds
 * most of the library without holding all of it.
 *
 *   1 تارىخ            books 2, 3, 4
 *     2 ئىسلام تارىخى    book 1 (the big one), books 5, 6
 *       3 خەلىپىلەر      books 7, 8, 9
 *   4 ئەدەبىيات         books 10, 11
 */
const BIG_BOOK = 1;
const BIG_BOOK_PAGES = 1500;
const SMALL_BOOK_PAGES = 180;
const LARGE_CATEGORY = 1;
const BOOKS: { id: number; category: number; pages: number }[] = [
  { id: 1, category: 2, pages: BIG_BOOK_PAGES },
  { id: 2, category: 1, pages: SMALL_BOOK_PAGES },
  { id: 3, category: 1, pages: SMALL_BOOK_PAGES },
  { id: 4, category: 1, pages: SMALL_BOOK_PAGES },
  { id: 5, category: 2, pages: SMALL_BOOK_PAGES },
  { id: 6, category: 2, pages: SMALL_BOOK_PAGES },
  { id: 7, category: 3, pages: SMALL_BOOK_PAGES },
  { id: 8, category: 3, pages: SMALL_BOOK_PAGES },
  { id: 9, category: 3, pages: SMALL_BOOK_PAGES },
  { id: 10, category: 4, pages: SMALL_BOOK_PAGES },
  { id: 11, category: 4, pages: SMALL_BOOK_PAGES },
];
const TOTAL_PAGES = BOOKS.reduce((sum, book) => sum + book.pages, 0);

/**
 * Generated Uyghur-shaped text, deterministic across runs. Twenty thousand
 * distinct pseudo-words drawn with a steep bias towards the frequent ones,
 * three hundred to a page, so the index holds a realistic entry tree rather
 * than a dozen lexemes, plus a few real words at chosen frequencies.
 */
function corpus(): (page: number) => string {
  let seed = 20260911;
  const random = () => {
    seed = (seed * 48271) % 2147483647;
    return seed / 2147483647;
  };
  const letters = "ئابپتجچخدرزژسشغفقكگڭلمنھوۇۆۈۋېىي";
  const vocabulary = Array.from({ length: 20000 }, () => {
    const length = 3 + Math.floor(random() * 7);
    let word = "";
    for (let i = 0; i < length; i += 1) word += letters[Math.floor(random() * letters.length)];
    return word;
  });
  const pick = () =>
    vocabulary[Math.min(vocabulary.length - 1, Math.floor(random() ** 2.2 * vocabulary.length))];

  return () => {
    const words: string[] = [];
    for (let k = 0; k < 300; k += 1) words.push(pick());
    if (random() < 0.85) words[Math.floor(random() * words.length)] = "پەيغەمبەر";
    if (random() < 0.2) words[Math.floor(random() * words.length)] = "نامازنى";
    if (random() < 0.03) words[Math.floor(random() * words.length)] = "زاكات";
    return words.join(" ");
  };
}

let db: PGlite;

/** idx_scan of the full-text index, after forcing the statistics flush. */
async function indexScans(): Promise<number> {
  await db.query(`select pg_stat_force_next_flush()`);
  await db.query(`select 1`);
  const result = await db.query<{ idx_scan: number }>(
    `select idx_scan from pg_stat_user_indexes where indexrelname = 'book_pages_fts_idx'`,
  );
  return Number(result.rows[0]?.idx_scan ?? 0);
}

/** Wall-clock milliseconds for one call, and its rows. */
async function timed(sql: string, params: unknown[]): Promise<{ ms: number; rows: unknown[] }> {
  const started = performance.now();
  const result = await db.query(sql, params);
  return { ms: performance.now() - started, rows: result.rows };
}

beforeAll(async () => {
  db = await new PGlite();
  await db.exec(`create role anon; create role authenticated;`);
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
        params.push(book.id, pageNo, page(pageNo));
        values.push(`($${params.length - 2}, $${params.length - 1}, $${params.length})`);
      }
      await db.query(`insert into public.book_pages values ${values.join(",")}`, params);
    }
  }

  await db.exec(functionSql("0002_fix_ug_normalize.sql", "ug_normalize"));
  await db.exec(functionSql("0017_phrase_search.sql", "ug_tsquery"));
  await db.exec(readFileSync(join(MIGRATIONS, "0019_one_matcher.sql"), "utf8"));
  await db.exec(readFileSync(join(MIGRATIONS, "0020_faster_one_matcher.sql"), "utf8"));
  await db.exec(readFileSync(join(MIGRATIONS, "0023_search_category_tree.sql"), "utf8"));
  // No index exists yet: 0025's guard is what builds it, exactly as it would
  // on a database where the index had gone missing.
  await db.exec(MIGRATION_0025);
  await db.exec(`analyze public.books; analyze public.categories;`);
}, 180_000);

afterAll(async () => {
  await db?.close();
});

describe("the corpus and the index", () => {
  it("holds enough pages for a per-page plan to be visible", async () => {
    const count = await db.query<{ n: number }>(`select count(*)::int as n from public.book_pages`);
    expect(Number(count.rows[0].n)).toBe(TOTAL_PAGES);
    expect(TOTAL_PAGES).toBeGreaterThanOrEqual(3000);
  });

  it("was built by 0025's guard on the expression the functions use", async () => {
    const index = await db.query<{ indexdef: string }>(
      `select indexdef from pg_indexes where schemaname = 'public' and indexname = 'book_pages_fts_idx'`,
    );
    expect(index.rows[0]?.indexdef).toBe(
      "CREATE INDEX book_pages_fts_idx ON public.book_pages USING gin (to_tsvector('simple'::regconfig, ug_normalize(content)))",
    );
  });

  it("cannot be walked page by page inside the budget, even for the biggest book alone", async () => {
    // The sensitivity check: with the index taken away from the planner, the
    // same predicate over one book's pages must cost several budgets. If it
    // ever does not, the corpus has become too small to tell the plans apart.
    await db.exec(`set enable_bitmapscan = off; set enable_indexscan = off;`);
    try {
      const scan = await timed(
        `select count(*) from public.book_pages p
         where p.book_id = $1
           and to_tsvector('simple', public.ug_normalize(p.content)) @@ public.ug_tsquery($2)`,
        [BIG_BOOK, NOWHERE],
      );
      expect(scan.ms, "a per-page scan of the biggest book").toBeGreaterThan(BUDGET_MS * 3);
    } finally {
      await db.exec(`reset enable_bitmapscan; reset enable_indexscan;`);
    }
  }, 60_000);
});

describe("a word that occurs nowhere is answered from the index", () => {
  const PATHS: { name: string; sql: string; params: unknown[] }[] = [
    {
      name: "the whole library",
      sql: `select * from public.search_books($1, null, 20, 0)`,
      params: [NOWHERE],
    },
    {
      name: `a large category (${LARGE_CATEGORY} and its descendants)`,
      sql: `select * from public.search_books($1, $2, 20, 0)`,
      params: [NOWHERE, LARGE_CATEGORY],
    },
    {
      name: `book_match_pages on the biggest book (${BIG_BOOK_PAGES} pages)`,
      sql: `select * from public.book_match_pages($1, $2, 500)`,
      params: [BIG_BOOK, NOWHERE],
    },
  ];

  for (const path of PATHS) {
    it(`${path.name}: inside ${BUDGET_MS} ms, and the index was read`, async () => {
      // Three calls, the first one cold: parsing and planning are part of
      // what a reader waits for.
      for (let run = 0; run < 3; run += 1) {
        const before = await indexScans();
        const call = await timed(path.sql, path.params);
        const after = await indexScans();
        expect(call.rows, "nothing carries the word").toEqual([]);
        expect(call.ms, `run ${run + 1}`).toBeLessThan(BUDGET_MS);
        expect(after, `run ${run + 1} read book_pages_fts_idx`).toBeGreaterThan(before);
      }
    }, 30_000);
  }
});

describe("a word that is there is still found through the index", () => {
  it("a rare word, in every scope, on the biggest book", async () => {
    for (const [sql, params] of [
      [`select * from public.search_books($1, null, 20, 0)`, ["زاكات"]],
      [`select * from public.search_books($1, $2, 20, 0)`, ["زاكات", LARGE_CATEGORY]],
      [`select * from public.book_match_pages($1, $2, 500)`, [BIG_BOOK, "زاكات"]],
    ] as [string, unknown[]][]) {
      const before = await indexScans();
      const call = await timed(sql, params);
      expect(call.rows.length).toBeGreaterThan(0);
      expect(await indexScans()).toBeGreaterThan(before);
    }
  }, 30_000);
});

describe("0025's guard", () => {
  it("leaves a valid index alone when the file is run again", async () => {
    const oid = async () =>
      (await db.query<{ oid: number }>(`select 'public.book_pages_fts_idx'::regclass::oid as oid`))
        .rows[0].oid;
    const before = await oid();
    await db.exec(MIGRATION_0025);
    expect(await oid()).toBe(before);
  }, 60_000);

  it("brings the index back when it is missing, and the paths use it again", async () => {
    await db.exec(`drop index public.book_pages_fts_idx`);
    const gone = await db.query(`select 1 from pg_indexes where indexname = 'book_pages_fts_idx'`);
    expect(gone.rows).toEqual([]);

    await db.exec(MIGRATION_0025);
    const back = await db.query(`select 1 from pg_indexes where indexname = 'book_pages_fts_idx'`);
    expect(back.rows).toHaveLength(1);

    const before = await indexScans();
    const call = await timed(`select * from public.search_books($1, null, 20, 0)`, [NOWHERE]);
    expect(call.ms).toBeLessThan(BUDGET_MS);
    expect(await indexScans()).toBeGreaterThan(before);
  }, 120_000);

  it("replaces an index built on any other expression", async () => {
    await db.exec(`
      drop index public.book_pages_fts_idx;
      create index book_pages_fts_idx on public.book_pages using gin (to_tsvector('simple', content));
    `);
    await db.exec(MIGRATION_0025);
    const index = await db.query<{ indexdef: string }>(
      `select indexdef from pg_indexes where indexname = 'book_pages_fts_idx'`,
    );
    expect(index.rows[0].indexdef).toContain("ug_normalize(content)");
  }, 120_000);
});

describe("the index expression and the functions cannot drift apart", () => {
  /** The expression the guard block builds the index on. */
  const guardExpression = (() => {
    const match = /create index book_pages_fts_idx on public\.book_pages\s+using gin \((.+)\);/.exec(
      MIGRATION_0025,
    );
    if (!match) throw new Error("0025 must create book_pages_fts_idx with a plain create index");
    return match[1];
  })();

  it("is the one 0014 introduced", () => {
    expect(guardExpression).toBe("to_tsvector('simple', public.ug_normalize(content))");
  });

  it("is what search_books and book_match_pages filter pages with", () => {
    const onPages = guardExpression.replace("(content)", "(p.content)");
    const searchBooks = functionSql("0025_search_uses_the_index.sql", "search_books");
    const bookMatchPages = functionSql("0025_search_uses_the_index.sql", "book_match_pages");
    // Twice in search_books — the whole-library statement and the scoped one.
    expect(searchBooks.split(onPages).length - 1).toBe(2);
    expect(bookMatchPages.split(onPages).length - 1).toBe(1);
  });

  it("is what the guard's own check accepts back from pg_get_indexdef", () => {
    // The regex in the guard must match the definition Postgres prints for
    // the index the guard itself creates; otherwise every run would rebuild.
    const pattern = /v_def !~ '(.+)'\n/.exec(MIGRATION_0025);
    expect(pattern).not.toBeNull();
    const regex = new RegExp(pattern![1].replaceAll("''", "'"));
    expect(regex.test(
      "CREATE INDEX book_pages_fts_idx ON public.book_pages USING gin (to_tsvector('simple'::regconfig, ug_normalize(content)))",
    )).toBe(true);
    expect(regex.test(
      "CREATE INDEX book_pages_fts_idx ON public.book_pages USING gin (to_tsvector('simple'::regconfig, public.ug_normalize(content)))",
    )).toBe(true);
    expect(regex.test(
      "CREATE INDEX book_pages_fts_idx ON public.book_pages USING gin (to_tsvector('simple'::regconfig, content))",
    )).toBe(false);
  });
});
