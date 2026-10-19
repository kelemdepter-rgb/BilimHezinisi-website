import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { OUTLINE_MAX_ENTRIES, outlineFromPages, type BookOutline } from "@/lib/reader/outline";
import { installAuthStubs, migrationSql, tableSql } from "../fixtures/pglite-auth";
import { linkedBookRows } from "../fixtures/linked-book";

/**
 * public.book_outline (PROMPT-51, migration 0032) on a real Postgres — PGlite,
 * with books and book_pages as 0001 makes them, their RLS policies as 0001
 * writes them, and 0032 exactly as the owner pastes it. Every answer is held
 * to lib/reader/outline.ts's twin, entry for entry: the reader uses the twin
 * offline and in the e2e stub, so the two may never disagree. Every text here
 * is invented.
 */

const STAFF = "aaaaaaaa-0000-4000-8000-000000000001";
const READER = "bbbbbbbb-0000-4000-8000-000000000002";

let db: PGlite;

function functionSql(file: string, name: string): string {
  const sql = migrationSql(file);
  const start = sql.indexOf(`create or replace function public.${name}`);
  if (start < 0) throw new Error(`public.${name} not found in ${file}`);
  const end = sql.indexOf("$fn$;", start);
  return sql.slice(start, end + "$fn$;".length);
}

function policySql(file: string, name: string): string {
  const sql = migrationSql(file);
  const start = sql.indexOf(`create policy "${name}"`);
  if (start < 0) throw new Error(`policy ${name} not found in ${file}`);
  return sql.slice(start, sql.indexOf(";", start) + 1);
}

/** One statement as a Supabase role, in its own transaction, as PostgREST runs it. */
async function as<T>(role: "anon" | "authenticated", userId: string | null, sql: string, params: unknown[] = []): Promise<T[]> {
  return db.transaction(async (tx) => {
    await tx.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify(userId ? { sub: userId, role } : { role }),
    ]);
    await tx.exec(`set local role ${role}`);
    return (await tx.query<T>(sql, params)).rows;
  });
}

async function outline(bookId: number, role: "anon" | "authenticated" = "anon", userId: string | null = null): Promise<BookOutline> {
  const [row] = await as<{ outline: BookOutline }>(role, userId, "select public.book_outline($1) as outline", [bookId]);
  return row.outline;
}

async function book(status: "draft" | "published", pages: string[]): Promise<number> {
  const { rows } = await db.query<{ id: number }>(
    "insert into public.books (title, status) values ('سىناق', $1) returning id",
    [status],
  );
  const id = Number(rows[0].id);
  for (const [index, content] of pages.entries()) {
    await db.query("insert into public.book_pages (book_id, page_no, content) values ($1, $2, $3)", [id, index + 1, content]);
  }
  return id;
}

/** The SQL's answer and the twin's, for the same pages. */
async function both(pages: string[]): Promise<{ sql: BookOutline; ts: BookOutline }> {
  const id = await book("published", pages);
  return {
    sql: await outline(id),
    ts: outlineFromPages(pages.map((content, index) => ({ page_no: index + 1, content }))),
  };
}

beforeAll(async () => {
  db = await new PGlite();
  await installAuthStubs(db);
  await db.exec(`
    create or replace function auth.uid() returns uuid language sql stable as $fn$
      select coalesce(
        nullif(current_setting('request.jwt.claim.sub', true), ''),
        (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
      )::uuid
    $fn$;
    grant usage on schema auth to anon, authenticated;
    grant execute on function auth.uid() to anon, authenticated;
    create role stranger;
  `);
  await db.exec(functionSql("0002_fix_ug_normalize.sql", "ug_normalize"));
  await db.exec(tableSql("0001_init.sql", "profiles"));
  await db.exec(tableSql("0001_init.sql", "categories"));
  await db.exec(tableSql("0001_init.sql", "books"));
  await db.exec(tableSql("0001_init.sql", "book_pages"));
  // 0014 dropped the stored vector; the outline never needed it.
  await db.exec("alter table public.book_pages drop column content_norm");
  await db.exec(functionSql("0001_init.sql", "is_uploader_or_admin"));
  await db.exec(`
    alter table public.books enable row level security;
    alter table public.book_pages enable row level security;
    ${policySql("0001_init.sql", "books_select_published_or_staff")}
    ${policySql("0001_init.sql", "book_pages_select_published_or_staff")}
    grant usage on schema public to stranger;
    grant select on public.books, public.book_pages to anon, authenticated;
  `);
  await db.exec(migrationSql("0032_book_outline.sql"));
  for (const [id, role] of [[STAFF, "uploader"], [READER, "reader"]] as const) {
    await db.query("insert into auth.users (id, email) values ($1, $2)", [id, `${id.slice(0, 8)}@example.com`]);
    await db.query("insert into public.profiles (id, role) values ($1, $2)", [id, role]);
  }
});

afterAll(async () => {
  await db?.close();
});

beforeEach(async () => {
  await db.exec("delete from public.book_pages; delete from public.books");
});

describe("what the outline holds", () => {
  it("lists headings, #-links and fences in document order, as the twin does", async () => {
    const { sql, ts } = await both([
      "# مۇندەرىجە\n\n[1\\. بىرىنچى باب](#QBH1) 2\n\n[https](https://example.com) [ئاددىي](/books/1)",
      "## بىرىنچى باب\n\nتېكىست [ئۇلىنىش](#_Toc12 \"ماۋزۇ\") ۋە يەنە.\n\n```js\n# ماۋزۇ ئەمەس\n[كود](#code)\n```\n\n~~~~\n## ئىچىدە\n~~~~",
    ]);
    expect(sql).toEqual({
      v: 1,
      capped: false,
      entries: [
        [1, "h", 1, "مۇندەرىجە"],
        [1, "l", "1\\. بىرىنچى باب", "QBH1"],
        [2, "h", 2, "بىرىنچى باب"],
        [2, "l", "ئۇلىنىش", "_Toc12"],
        [2, "f", "```", "js"],
        [2, "h", 1, "ماۋزۇ ئەمەس"],
        [2, "l", "كود", "code"],
        [2, "f", "```", ""],
        [2, "f", "~~~~", ""],
        [2, "h", 2, "ئىچىدە"],
        [2, "f", "~~~~", ""],
      ],
    });
    expect(ts).toEqual(sql);
  });

  it("keeps footnotes, endnotes and escaped brackets as written", async () => {
    const { sql, ts } = await both([
      "ئۇ كەلدى[\\[1\\]](#footnote-1). كېيىن[\\[2\\]](#endnote-1).\n\n[\\[ئەسكەرتىش\\] \\(مۇھىم\\)](#QBH\\(2\\))",
      "1. ئىزاھات. [↑](#footnote-ref-1)\n\n1. ئاخىرقى. [↑](#endnote-ref-1)",
    ]);
    expect(sql.entries).toEqual([
      [1, "l", "\\[1\\]", "footnote-1"],
      [1, "l", "\\[2\\]", "endnote-1"],
      [1, "l", "\\[ئەسكەرتىش\\] \\(مۇھىم\\)", "QBH\\(2\\)"],
      [2, "l", "↑", "footnote-ref-1"],
      [2, "l", "↑", "endnote-ref-1"],
    ]);
    expect(ts).toEqual(sql);
  });

  it("finds a heading on the same page after the last contents link", async () => {
    const { sql, ts } = await both([
      "[1\\. باش](#QBH1) 1\n\n[2\\. ئاخىر](#QBH2) 4\n# باش\n\nتېكىست.",
    ]);
    expect(sql.entries).toEqual([
      [1, "l", "1\\. باش", "QBH1"],
      [1, "l", "2\\. ئاخىر", "QBH2"],
      [1, "h", 1, "باش"],
    ]);
    expect(ts).toEqual(sql);
  });

  it("carries Uyghur with its marks exactly as stored", async () => {
    const { sql, ts } = await both(["# قُرْئانْ ۋە ئـــىمان\n\n[إِيمان](#a)"]);
    expect(sql.entries).toEqual([
      [1, "h", 1, "قُرْئانْ ۋە ئـــىمان"],
      [1, "l", "إِيمان", "a"],
    ]);
    expect(ts).toEqual(sql);
  });

  it("reads a label broken over a line as one link, and breaks nothing after it", async () => {
    const { sql, ts } = await both(["[بىرىنچى\nباب](#QBH1) 3\n\n# كېيىنكى\n\n[ئىككىنچى](#QBH2)"]);
    expect(sql.entries).toEqual([
      [1, "l", "بىرىنچى\nباب", "QBH1"],
      [1, "h", 1, "كېيىنكى"],
      [1, "l", "ئىككىنچى", "QBH2"],
    ]);
    expect(ts).toEqual(sql);
  });

  it("is not fooled by what only looks like a heading", async () => {
    const { sql, ts } = await both([
      "#يوق\n\n    # كود\n\n####### يەتتە\n\nتېكىست\u2028# يوق\n\n#\tبەتكۈچ\n\n   ### ئۈچ بوشلۇق ###",
    ]);
    expect(sql.entries).toEqual([
      [1, "h", 1, "بەتكۈچ"],
      [1, "h", 3, "ئۈچ بوشلۇق ###"],
    ]);
    expect(ts).toEqual(sql);
  });

  it("caps at 5,000 entries and says so", async () => {
    const page = Array.from({ length: 2600 }, (_, index) => `[${index}](#n${index})`).join(" ");
    const { sql, ts } = await both([page, page]);
    expect(sql.capped).toBe(true);
    expect(sql.entries).toHaveLength(OUTLINE_MAX_ENTRIES);
    expect(sql.entries[OUTLINE_MAX_ENTRIES - 1]).toEqual([2, "l", "2399", "n2399"]);
    expect(ts).toEqual(sql);
  });

  it("agrees with the twin on the whole fixture book, in well under 30 KB", async () => {
    const rows = linkedBookRows();
    const { sql, ts } = await both(rows.map((row) => row.content));
    expect(ts).toEqual(sql);
    expect(sql.entries.filter((entry) => entry[1] === "h").length).toBeGreaterThan(5);
    expect(Buffer.byteLength(JSON.stringify(sql))).toBeLessThan(30_000);
  });

  it("answers an empty outline for a book with no pages", async () => {
    expect(await outline(987_654)).toEqual({ v: 1, capped: false, entries: [] });
  });
});

describe("who sees what", () => {
  it("gives anonymous readers a published book and nothing of a draft", async () => {
    const published = await book("published", ["# ئوچۇق"]);
    const draft = await book("draft", ["# مەخپىي"]);
    expect((await outline(published)).entries).toEqual([[1, "h", 1, "ئوچۇق"]]);
    expect((await outline(draft)).entries).toEqual([]);
    expect((await outline(draft, "authenticated", READER)).entries).toEqual([]);
  });

  it("gives staff their drafts", async () => {
    const draft = await book("draft", ["# مەخپىي"]);
    expect((await outline(draft, "authenticated", STAFF)).entries).toEqual([[1, "h", 1, "مەخپىي"]]);
  });
});

describe("the function itself", () => {
  it("is read-only SQL, security invoker, with an empty search_path, returning one jsonb", async () => {
    const { rows } = await db.query<{
      language: string;
      volatility: string;
      definer: boolean;
      config: string[] | null;
      returns: string;
      set: boolean;
    }>(`
      select l.lanname as language, p.provolatile as volatility, p.prosecdef as definer,
             p.proconfig as config, p.prorettype::regtype::text as returns, p.proretset as set
        from pg_proc p join pg_language l on l.oid = p.prolang
       where p.oid = 'public.book_outline(bigint)'::regprocedure`);
    expect(rows[0]).toEqual({
      language: "sql",
      volatility: "s",
      definer: false,
      config: ['search_path=""'],
      returns: "jsonb",
      set: false,
    });
  });

  it("may be called by anon and authenticated, and by nobody else through public", async () => {
    const { rows } = await db.query<{ anon: boolean; authenticated: boolean; stranger: boolean }>(`
      select has_function_privilege('anon', 'public.book_outline(bigint)', 'execute') as anon,
             has_function_privilege('authenticated', 'public.book_outline(bigint)', 'execute') as authenticated,
             has_function_privilege('stranger', 'public.book_outline(bigint)', 'execute') as stranger`);
    expect(rows[0]).toEqual({ anon: true, authenticated: true, stranger: false });
  });
});
