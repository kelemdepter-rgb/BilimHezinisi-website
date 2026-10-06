import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Migration 0028 — the search slots (PROMPT-40) — run against a real
 * Postgres (PGlite), exactly as it will be pasted into the SQL Editor.
 *
 * What one session can prove, it proves here:
 *   - search_books, book_match_pages and search_quran answer row for row,
 *     rank for rank, what 0025's and 0015's bodies answered;
 *   - every attribute and grant the functions had, they still have;
 *   - a search holds its slot for exactly as long as its transaction;
 *   - a full pool answers with SQLSTATE PT429 and `bh:search_busy`.
 *
 * What needs several sessions at once — the N+1th search refused in under
 * 200 ms while N run, a slot coming back after a crash or a timeout — PGlite
 * cannot do (it is one session). scripts/flood/gate-check.mjs proves those
 * against Supabase's own Postgres image and PostgREST 14.5, the live versions.
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

const NAMESPACE = 20261005;

let db: PGlite;

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
      status text not null default 'published'
    );
    create table public.book_pages (
      book_id bigint not null references public.books (id),
      page_no int not null,
      content text not null,
      primary key (book_id, page_no)
    );
    create table public.quran_suras (number int primary key, name_ar text, name_ug text);
    create table public.quran_ayas (
      sura int references public.quran_suras (number),
      aya int,
      text_ar text,
      text_ar_simple text,
      text_ug text,
      primary key (sura, aya)
    );
    insert into public.categories values (1, null, 'ھەدىس'), (2, 1, 'سەھىھ'), (3, null, 'تارىخ');
    insert into public.books values
      (1, 'سەھىھ ھەدىسلەر', 'بۇخارى', null, 2, 'published'),
      (2, 'ناماز ھۆكۈملىرى', 'سىناق', null, 1, 'published'),
      (3, 'تارىخ كىتابى', 'مۇئەللىپ', null, 3, 'published'),
      (4, 'قارالما', 'سىناق', null, 1, 'draft');
  `);
  const words = ["ناماز", "نامازنى", "پەيغەمبەر", "ئىمان", "روزا", "زاكات", "قۇرئان", "ئىلىم", "كىتاب", "ۋە", "بىلەن"];
  let seed = 20261006;
  const random = () => (seed = (seed * 48271) % 2147483647) / 2147483647;
  for (const book of [1, 2, 3, 4]) {
    for (let page = 1; page <= 40; page += 1) {
      const text = Array.from({ length: 60 }, () => words[Math.floor(random() * words.length)]).join(" ");
      await db.query(`insert into public.book_pages values ($1, $2, $3)`, [book, page, text]);
    }
  }
  await db.exec(`
    insert into public.quran_suras values (1, 'الفاتحة', 'فاتىھە'), (2, 'البقرة', 'بەقەرە');
    insert into public.quran_ayas values
      (1, 1, 'بِسْمِ ٱللَّهِ', 'بسم الله الرحمن الرحيم', 'ناھايىتى شەپقەتلىك ۋە مېھرىبان اللە نىڭ ئىسمى بىلەن باشلايمەن'),
      (1, 2, 'ٱلْحَمْدُ لِلَّهِ', 'الحمد لله رب العالمين', 'ھەممە ھەمدۇسانا اللە قا خاستۇر'),
      (2, 1, 'الٓمٓ', 'الم', 'ئەلىف، لام، مىم'),
      (2, 2, 'ذَٰلِكَ ٱلْكِتَٰبُ', 'ذلك الكتاب لا ريب فيه', 'بۇ كىتاب قۇرئان، ئىمان ئېيتقانلارغا يېتەكچىدۇر');
  `);

  await db.exec(functionSql("0002_fix_ug_normalize.sql", "ug_normalize"));
  await db.exec(functionSql("0017_phrase_search.sql", "ug_tsquery"));
  await db.exec(readFileSync(join(MIGRATIONS, "0019_one_matcher.sql"), "utf8"));
  await db.exec(readFileSync(join(MIGRATIONS, "0020_faster_one_matcher.sql"), "utf8"));
  await db.exec(readFileSync(join(MIGRATIONS, "0023_search_category_tree.sql"), "utf8"));
  await db.exec(readFileSync(join(MIGRATIONS, "0025_search_uses_the_index.sql"), "utf8"));
  await db.exec(functionSql("0015_prefix_search.sql", "search_quran"));
  // The bodies the live database runs today, kept beside the new ones.
  await db.exec(functionSqlAs("0025_search_uses_the_index.sql", "search_books", "search_books_0025"));
  await db.exec(functionSqlAs("0025_search_uses_the_index.sql", "book_match_pages", "book_match_pages_0025"));
  await db.exec(functionSqlAs("0015_prefix_search.sql", "search_quran", "search_quran_0015"));
  // 0028 in full — twice, as a second paste into the SQL Editor would.
  const migration = readFileSync(join(MIGRATIONS, "0028_search_concurrency_gate.sql"), "utf8");
  await db.exec(migration);
  await db.exec(migration);
}, 120_000);

afterAll(async () => {
  await db?.close();
});

const QUERIES = ["ناماز", "نامازنى", "پەيغەمبەر", "ئىمان روزا", "قۇرئان", "الله", "اللە", "كىتاب", "يوقسۆز", "", "   "];

describe("0028 answers exactly what the live functions answer", () => {
  it("search_books: every query, every scope, every limit and offset", async () => {
    let compared = 0;
    for (const q of QUERIES) {
      for (const scope of [null, 1, 2, 3, 9999]) {
        for (const [lim, off] of [
          [20, 0],
          [1, 0],
          [5, 3],
          [null, null],
        ]) {
          const shipped = await db.query(`select * from public.search_books($1, $2, $3, $4)`, [q, scope, lim, off]);
          const earlier = await db.query(`select * from public.search_books_0025($1, $2, $3, $4)`, [q, scope, lim, off]);
          expect(shipped.rows, `«${q}» scope ${scope} ${lim}/${off}`).toEqual(earlier.rows);
          compared += 1;
        }
      }
    }
    expect(compared).toBe(QUERIES.length * 5 * 4);
    // 440 calls of two functions each, in WebAssembly.
  }, 120_000);

  it("book_match_pages: every query, every book (a draft and a missing one included)", async () => {
    for (const q of QUERIES) {
      for (const book of [1, 2, 3, 4, 42]) {
        for (const lim of [500, 3, null]) {
          const shipped = await db.query(`select * from public.book_match_pages($1, $2, $3)`, [book, q, lim]);
          const earlier = await db.query(`select * from public.book_match_pages_0025($1, $2, $3)`, [book, q, lim]);
          expect(shipped.rows, `«${q}» book ${book} ${lim}`).toEqual(earlier.rows);
        }
      }
    }
  }, 60_000);

  it("search_quran: every query, every limit and offset", async () => {
    for (const q of QUERIES) {
      for (const [lim, off] of [
        [50, 0],
        [1, 1],
        [null, null],
      ]) {
        const shipped = await db.query(`select * from public.search_quran($1, $2, $3)`, [q, lim, off]);
        const earlier = await db.query(`select * from public.search_quran_0015($1, $2, $3)`, [q, lim, off]);
        expect(shipped.rows, `«${q}» ${lim}/${off}`).toEqual(earlier.rows);
      }
    }
  });

  it("actually found something, so the comparison compared rows", async () => {
    const books = await db.query(`select count(*)::int as n from public.search_books('ناماز', null, 20, 0)`);
    const quran = await db.query(`select count(*)::int as n from public.search_quran('ئىمان', 50, 0)`);
    expect(Number((books.rows[0] as { n: number }).n)).toBeGreaterThan(0);
    expect(Number((quran.rows[0] as { n: number }).n)).toBeGreaterThan(0);
  });
});

describe("what the functions are", () => {
  async function attributes(signature: string) {
    const { rows } = await db.query<{ secdef: boolean; volatility: string; config: string[] | null; language: string }>(
      `select p.prosecdef as secdef, p.provolatile as volatility, p.proconfig as config, l.lanname as language
         from pg_proc p join pg_language l on l.oid = p.prolang
        where p.oid = $1::regprocedure`,
      [signature],
    );
    return rows[0];
  }

  it("search_books and book_match_pages keep security definer, the empty search_path and custom plans", async () => {
    for (const signature of ["public.search_books(text,bigint,int,int)", "public.book_match_pages(bigint,text,int)"]) {
      const fn = await attributes(signature);
      expect(fn, signature).toMatchObject({ secdef: true, volatility: "s", language: "plpgsql" });
      expect(fn.config).toEqual(expect.arrayContaining(['search_path=""', "plan_cache_mode=force_custom_plan"]));
    }
  });

  it("search_quran stays security invoker and stable, now planned with the real word", async () => {
    const fn = await attributes("public.search_quran(text,int,int)");
    expect(fn).toMatchObject({ secdef: false, volatility: "s", language: "plpgsql" });
    expect(fn.config).toEqual(["plan_cache_mode=force_custom_plan"]);
  });

  it("keeps every grant: anon and signed-in readers may run all three", async () => {
    for (const signature of [
      "public.search_books(text,bigint,int,int)",
      "public.book_match_pages(bigint,text,int)",
      "public.search_quran(text,int,int)",
    ]) {
      for (const role of ["anon", "authenticated"]) {
        const { rows } = await db.query<{ ok: boolean }>(`select has_function_privilege($1, $2, 'execute') as ok`, [
          role,
          signature,
        ]);
        expect(rows[0].ok, `${role} on ${signature}`).toBe(true);
      }
    }
  });

  it("keeps the slot taker in a schema of its own — out of the public API's reach", async () => {
    const { rows } = await db.query<{ schema: string; volatility: string; config: string[] }>(
      `select n.nspname as schema, p.provolatile as volatility, p.proconfig as config
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where p.proname = 'take_search_slot'`,
    );
    expect(rows).toEqual([{ schema: "private", volatility: "v", config: ['search_path=""'] }]);
  });
});

describe("the slots, as one session sees them", () => {
  async function held(): Promise<number[]> {
    const { rows } = await db.query<{ objid: number }>(
      `select objid::int as objid from pg_locks where locktype = 'advisory' and classid = $1 and granted order by objid`,
      [NAMESPACE],
    );
    return rows.map((row) => row.objid);
  }

  it.each([
    ["a whole-library search", `select count(*) from public.search_books('ناماز', null, 20, 0)`, 101],
    ["a one-category search", `select count(*) from public.search_books('ناماز', 1, 20, 0)`, 201],
    ["the reader's navigator", `select count(*) from public.book_match_pages(1, 'ناماز', 500)`, 301],
    ["a Qur'an search", `select count(*) from public.search_quran('ئىمان', 50, 0)`, 401],
  ])("%s holds its pool's first slot until its transaction ends", async (_label, sql, slot) => {
    await db.exec("begin");
    try {
      await db.query(sql);
      expect(await held()).toEqual([slot]);
    } finally {
      await db.exec("commit");
    }
    expect(await held()).toEqual([]);
  });

  it("gives the slot back when the transaction fails", async () => {
    await db.exec("begin");
    await db.query(`select count(*) from public.search_books('ناماز', null, 20, 0)`);
    await expect(db.query("select 1 / 0")).rejects.toThrow();
    await db.exec("rollback");
    expect(await held()).toEqual([]);
  });

  it("refuses with PT429 and bh:search_busy when no slot is free — and names no word", async () => {
    // A pool of no slots is a pool whose every slot is taken.
    const refusal = await db.query(`select private.take_search_slot(1, 0)`).then(
      () => null,
      (error: { code?: string; message?: string; detail?: string }) => error,
    );
    expect(refusal).toMatchObject({ code: "PT429", message: "bh:search_busy" });
    expect(refusal?.detail).toBe("every slot in search pool 1 is in use");
  });
});
