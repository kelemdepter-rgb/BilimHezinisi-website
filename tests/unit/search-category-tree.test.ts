import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { categoryWithDescendants, rollUpCategoryCounts } from "@/lib/library-types";
import type { Category } from "@/lib/types";

/**
 * Browsing and searching must mean the same thing by "a category".
 *
 * listBooks resolves one through categoryWithDescendants, so opening a parent
 * shows the children's books. Until migration 0023, search_books filtered on
 * the exact category id, so searching the same parent could not find them —
 * the defect PROMPT-26 asked to close while the search box grew a scope
 * picker that would have made it visible.
 *
 * Everything here runs against a REAL Postgres (PGlite) and the real migration
 * files, over a fixture tree seeded here. Nothing touches the live project.
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
 * The fixture tree.
 *
 *   1 تارىخ                 ← a book of its own
 *     2 ئىسلام تارىخى        ← a book of its own
 *       3 خەلىپىلەر دەۋرى    ← a book of its own (two levels down)
 *   4 تىل ۋە ئەدەبىيات      ← a book of its own, and no relation to the above
 *   5 پەلسەپە               ← empty, so a count of zero has something to be
 */
const CATEGORIES: Category[] = [
  { id: 1, parent_id: null, name: "تارىخ", icon: "landmark", sort_order: 1 },
  { id: 2, parent_id: 1, name: "ئىسلام تارىخى", icon: "mosque", sort_order: 2 },
  { id: 3, parent_id: 2, name: "خەلىپىلەر دەۋرى", icon: "scroll", sort_order: 3 },
  { id: 4, parent_id: null, name: "تىل ۋە ئەدەبىيات", icon: "feather", sort_order: 4 },
  { id: 5, parent_id: null, name: "پەلسەپە", icon: "idea", sort_order: 5 },
];

/** The word every seeded page carries, so the tree is the only variable. */
const NEEDLE = "زاكات";
const PAGE = `مۇسۇلمانلارغا ${NEEDLE} بېرىش پەرز قىلىنغان، ۋە ئۇ مالنى پاكلايدۇ.`;

/** One published book per category, titled so the title never matches NEEDLE. */
const BOOKS: { id: number; category: number | null; title: string }[] = [
  { id: 1, category: 1, title: "بىرىنچى كىتاب" },
  { id: 2, category: 2, title: "ئىككىنچى كىتاب" },
  { id: 3, category: 3, title: "ئۈچىنچى كىتاب" },
  { id: 4, category: 4, title: "تۆتىنچى كىتاب" },
];

let db: PGlite;

beforeAll(async () => {
  db = await new PGlite();
  await db.exec(`create role anon; create role authenticated;`);

  await db.exec(`
    create table public.categories (
      id bigint primary key,
      parent_id bigint references public.categories (id) on delete cascade,
      name text not null
    );
    create table public.books (
      id bigserial primary key,
      title text not null default '',
      author text not null default '',
      cover_path text,
      category_id bigint references public.categories (id) on delete set null,
      status text not null default 'published'
    );
    create table public.book_pages (
      book_id bigint not null references public.books(id),
      page_no int not null,
      content text not null,
      primary key (book_id, page_no)
    );
  `);

  await db.exec(functionSql("0002_fix_ug_normalize.sql", "ug_normalize"));
  await db.exec(functionSql("0017_phrase_search.sql", "ug_tsquery"));
  await db.exec(readFileSync(join(MIGRATIONS, "0019_one_matcher.sql"), "utf8"));
  await db.exec(readFileSync(join(MIGRATIONS, "0020_faster_one_matcher.sql"), "utf8"));
  await db.exec(readFileSync(join(MIGRATIONS, "0023_search_category_tree.sql"), "utf8"));

  // Parents before children, so the self-reference is satisfiable.
  for (const category of CATEGORIES) {
    await db.query(`insert into public.categories (id, parent_id, name) values ($1, $2, $3)`, [
      category.id,
      category.parent_id,
      category.name,
    ]);
  }
  for (const book of BOOKS) {
    await db.query(
      `insert into public.books (id, title, category_id, status) values ($1, $2, $3, 'published')`,
      [book.id, book.title, book.category],
    );
    await db.query(`insert into public.book_pages (book_id, page_no, content) values ($1, 1, $2)`, [
      book.id,
      PAGE,
    ]);
  }
});

afterAll(async () => {
  await db?.close();
});

/** Which books search_books returns for a scope, in id order. */
async function found(categoryId: number | null): Promise<number[]> {
  const rows = await db.query<{ book_id: number }>(
    `select distinct book_id from public.search_books($1, $2, 50, 0) order by book_id`,
    [NEEDLE, categoryId],
  );
  return rows.rows.map((row) => Number(row.book_id));
}

describe("search_books resolves a category through its descendants", () => {
  it("finds a child's book when the parent is searched", async () => {
    // The defect in one line: book 2 lives in «ئىسلام تارىخى», and searching
    // its parent «تارىخ» used to miss it while browsing «تارىخ» showed it.
    expect(await found(1)).toEqual([1, 2, 3]);
  });

  it("reaches two levels down, exactly as categoryWithDescendants does", async () => {
    expect(categoryWithDescendants(CATEGORIES, 1)).toEqual([1, 2, 3]);
    expect(await found(2)).toEqual([2, 3]);
  });

  it("still narrows to a leaf, and does not leak into a sibling branch", async () => {
    expect(await found(3)).toEqual([3]);
    expect(await found(4)).toEqual([4]);
  });

  it("searches the whole library when no category is given", async () => {
    expect(await found(null)).toEqual([1, 2, 3, 4]);
  });

  it("returns nothing for an empty category, and for one that does not exist", async () => {
    expect(await found(5)).toEqual([]);
    expect(await found(9999)).toEqual([]);
  });

  it("still refuses a draft, whatever the scope", async () => {
    await db.exec(`update public.books set status = 'draft' where id = 3`);
    try {
      expect(await found(1)).toEqual([1, 2]);
      expect(await found(3)).toEqual([]);
    } finally {
      await db.exec(`update public.books set status = 'published' where id = 3`);
    }
  });

  it("terminates on a tree that has become a ring", async () => {
    // categories.parent_id is a self reference, so this is possible in
    // principle; the recursive walk carries a path and refuses to revisit.
    await db.exec(`update public.categories set parent_id = 3 where id = 1`);
    try {
      expect(await found(1)).toEqual([1, 2, 3]);
    } finally {
      await db.exec(`update public.categories set parent_id = null where id = 1`);
    }
  });
});

describe("the counts beside a category say what searching it returns", () => {
  it("rolls a parent's number up out of its descendants", () => {
    const direct = { 1: 1, 2: 1, 3: 1, 4: 1 };
    expect(rollUpCategoryCounts(CATEGORIES, direct)).toEqual({
      1: 3,
      2: 2,
      3: 1,
      4: 1,
      5: 0,
    });
  });

  it("agrees with what search_books actually finds, category by category", async () => {
    const direct = { 1: 1, 2: 1, 3: 1, 4: 1 };
    const counts = rollUpCategoryCounts(CATEGORIES, direct);
    for (const category of CATEGORIES) {
      expect(
        (await found(category.id)).length,
        `«${category.name}» shows ${counts[category.id]} books`,
      ).toBe(counts[category.id]);
    }
  });

  it("counts nothing for a category that holds nothing", () => {
    expect(rollUpCategoryCounts(CATEGORIES, {})).toEqual({ 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 });
  });
});
