import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { authorKey } from "@/lib/library-types";

/**
 * The author index, run against a real Postgres.
 *
 * PGlite is the same engine compiled to WebAssembly, so the migration under
 * test is the file that will be pasted into the Supabase SQL Editor rather
 * than a copy of it that can drift. Three things have to hold:
 *
 *   - the same person written three ways is ONE author;
 *   - the index is in Uyghur alphabetical order, which is not code-point order;
 *   - the key JavaScript builds for a link matches the key the database groups
 *     on, or the link lands on an empty shelf.
 */
const MIGRATIONS = join(process.cwd(), "supabase", "migrations");

function functionSql(file: string, name: string): string {
  const sql = readFileSync(join(MIGRATIONS, file), "utf8");
  const start = sql.indexOf(`create or replace function public.${name}`);
  if (start < 0) throw new Error(`${name} not found in ${file}`);
  const end = sql.indexOf("$fn$;", start);
  return sql.slice(start, end + "$fn$;".length);
}

let db: PGlite;

beforeAll(async () => {
  db = await new PGlite();
  await db.exec(`create role anon; create role authenticated;`);
  await db.exec(`
    create table public.books (
      id bigserial primary key,
      title text not null default '',
      author text not null default '',
      status text not null default 'published',
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
  `);
  await db.exec(functionSql("0002_fix_ug_normalize.sql", "ug_normalize"));
  await db.exec(readFileSync(join(MIGRATIONS, "0021_authors_and_published_at.sql"), "utf8"));
});

afterAll(async () => {
  await db?.close();
});

async function reset(rows: Array<[string, string, string?]>) {
  await db.exec(`delete from public.books`);
  for (const [title, author, status] of rows) {
    await db.query(`insert into public.books (title, author, status) values ($1, $2, $3)`, [
      title,
      author,
      status ?? "published",
    ]);
  }
}

type AuthorRow = {
  author_key: string;
  author: string;
  book_count: number;
  total_authors: number;
};

const listAuthors = async (lim = 50, off = 0) =>
  (await db.query<AuthorRow>(`select * from public.list_authors($1, $2)`, [lim, off])).rows;

describe("grouping authors", () => {
  it("treats padding and repeated spaces as the same person", async () => {
    await reset([
      ["a", "ئابدۇللا قادىرى"],
      ["b", "  ئابدۇللا قادىرى  "],
      ["c", "ئابدۇللا   قادىرى"],
    ]);
    const rows = await listAuthors();
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].book_count)).toBe(3);
  });

  it("shows the spelling used on the most books, not the normalized key", async () => {
    await reset([
      ["a", "ئابدۇللا قادىرى"],
      ["b", "ئابدۇللا قادىرى"],
      ["c", "  ئابدۇللا قادىرى"],
    ]);
    const [row] = await listAuthors();
    // Trimmed for display, but otherwise exactly as an editor typed it.
    expect(row.author).toBe("ئابدۇللا قادىرى");
    expect(row.author_key).toBe("ئابدۇللا قادىرى");
  });

  it("leaves out books nobody is credited on, and counts them separately", async () => {
    await reset([
      ["a", "زوردۇن سابىر"],
      ["b", ""],
      ["c", "   "],
    ]);
    expect(await listAuthors()).toHaveLength(1);
    const stats = (
      await db.query<{ authors: number; unattributed: number }>(`select * from public.author_stats()`)
    ).rows[0];
    expect(Number(stats.authors)).toBe(1);
    expect(Number(stats.unattributed)).toBe(2);
  });

  it("never lists an author whose only books are drafts", async () => {
    await reset([
      ["a", "ئېلان قىلىنغان"],
      ["b", "يوشۇرۇن ئاپتور", "draft"],
    ]);
    const rows = await listAuthors();
    expect(rows.map((row) => row.author)).toEqual(["ئېلان قىلىنغان"]);
  });

  it("reports the total so the page can be paged", async () => {
    await reset([
      ["a", "ئابدۇللا"],
      ["b", "بۇغرا"],
      ["c", "زوردۇن"],
    ]);
    const firstPage = await listAuthors(2, 0);
    expect(firstPage).toHaveLength(2);
    expect(Number(firstPage[0].total_authors)).toBe(3);
    const secondPage = await listAuthors(2, 2);
    expect(secondPage).toHaveLength(1);
  });
});

describe("Uyghur alphabetical order", () => {
  it("sorts by the Uyghur alphabet, not by code point", async () => {
    // ە (U+06D5) is the SECOND letter of the alphabet but sorts after ي
    // (U+064A), the last, if Postgres is left to compare code points.
    await reset([
      ["a", "يۈسۈپ"],
      ["b", "ئەخمەت"],
      ["c", "ئابدۇللا"],
      ["d", "زوردۇن"],
      ["e", "مۇھەممەد"],
    ]);
    const order = (await listAuthors()).map((row) => row.author);
    expect(order).toEqual(["ئابدۇللا", "ئەخمەت", "زوردۇن", "مۇھەممەد", "يۈسۈپ"]);
  });

  it("ignores the hamza carrier, which is not a letter of the alphabet", async () => {
    const key = async (value: string) =>
      (await db.query<{ k: string }>(`select public.ug_sort_key($1) as k`, [value])).rows[0].k;
    // ئا and ا sort to the same place: ئ only carries a word-initial vowel.
    expect(await key("ئا")).toBe(await key("ا"));
  });

  it("files Arabic-only letters under the Uyghur letter they are looked up as", async () => {
    const key = async (value: string) =>
      (await db.query<{ k: string }>(`select public.ug_sort_key($1) as k`, [value])).rows[0].k;
    expect(await key("ث")).toBe(await key("س"));
    expect(await key("ه")).toBe(await key("ھ"));
    expect(await key("ط")).toBe(await key("ت"));
  });
});

describe("the key JavaScript builds for a link", () => {
  const NAMES = [
    "ئابدۇللا قادىرى",
    "  ئابدۇللا   قادىرى ",
    "مۇھەممەد ئىبنى سۇلايمان مەغرىبىي",
    "زوردۇن سابىر",
    "أحمد",
    "Muhammad AL-Bukhari",
    "يۈسۈپ خاس ھاجىپ",
    "",
    "   ",
  ];

  it("matches the key the database groups on, name for name", async () => {
    for (const name of NAMES) {
      const fromSql = (
        await db.query<{ k: string }>(
          `select btrim(regexp_replace(public.ug_normalize($1), '\\s+', ' ', 'g')) as k`,
          [name],
        )
      ).rows[0].k;
      expect(authorKey(name), `key for «${name}»`).toBe(fromSql);
    }
  });

  it("agrees with the generated column the author page looks up", async () => {
    await reset([["a", "  ئابدۇللا   قادىرى "]]);
    const stored = (
      await db.query<{ author_key: string }>(`select author_key from public.books limit 1`)
    ).rows[0].author_key;
    expect(authorKey("  ئابدۇللا   قادىرى ")).toBe(stored);
  });
});

describe("when a book became visible", () => {
  it("stamps published_at when a draft is published, and clears it again", async () => {
    await reset([["a", "ئاپتور", "draft"]]);
    const at = async () =>
      (await db.query<{ published_at: string | null }>(`select published_at from public.books limit 1`))
        .rows[0].published_at;
    expect(await at()).toBeNull();

    await db.exec(`update public.books set status = 'published'`);
    expect(await at()).not.toBeNull();

    // Back to draft: a book nobody can see has no publication date, and
    // publishing it again makes it genuinely new rather than reviving a date
    // set months ago.
    await db.exec(`update public.books set status = 'draft'`);
    expect(await at()).toBeNull();
  });

  it("stamps a book that is published the moment it is inserted", async () => {
    await reset([["a", "ئاپتور"]]);
    const row = (
      await db.query<{ published_at: string | null }>(`select published_at from public.books limit 1`)
    ).rows[0];
    expect(row.published_at).not.toBeNull();
  });
});
