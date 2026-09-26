import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { installAuthStubs, tableSql } from "../fixtures/pglite-auth";

/**
 * Deleting an account removes everything that was its own (PROMPT-39, part E).
 *
 * The daily sweep deletes accounts never confirmed through the admin API,
 * which deletes the auth.users row. Such an account never signed in, so it
 * should own nothing — but this proves that whatever it does own goes with
 * it: profiles cascade from auth.users, and every per-user table from
 * profiles. The tables are the real CREATE TABLE statements, cut out of the
 * migrations; a scratch PGlite database, never production.
 */

/** Every table that holds one person's rows, keyed on profiles(id). */
const PER_USER_TABLES = [
  "bookmarks",
  "book_notes",
  "reading_progress",
  "recent_reads",
  "note_documents",
  "ai_usage",
  "quran_bookmarks",
];

let db: PGlite;

beforeAll(async () => {
  db = await new PGlite();
  await installAuthStubs(db);
  for (const name of ["profiles", "categories", "books", "quran_suras"]) {
    await db.exec(tableSql("0001_init.sql", name));
  }
  for (const name of PER_USER_TABLES) {
    await db.exec(tableSql(name === "quran_bookmarks" ? "0007_quran_search_and_bookmarks.sql" : "0001_init.sql", name));
  }
});

afterAll(async () => {
  await db?.close();
});

describe("an account deleted by the sweep", () => {
  it("takes its profile and every per-user row with it, and leaves the library alone", async () => {
    const { rows } = await db.query<{ id: string }>(
      "insert into auth.users (email, created_at) values ('never-confirmed@gmail.com', now() - interval '8 days') returning id",
    );
    const userId = rows[0].id;
    await db.query("insert into public.profiles (id) values ($1)", [userId]);
    const { rows: books } = await db.query<{ id: number }>(
      "insert into public.books (title, uploaded_by) values ('A book', $1) returning id",
      [userId],
    );
    const bookId = books[0].id;
    await db.query(
      "insert into public.quran_suras (number, name_ar, name_ug, aya_count) values (1, 'الفاتحة', 'فاتىھە', 7)",
    );

    await db.query("insert into public.bookmarks (user_id, book_id) values ($1, $2)", [userId, bookId]);
    await db.query("insert into public.book_notes (user_id, book_id, text) values ($1, $2, 'x')", [userId, bookId]);
    await db.query("insert into public.reading_progress (user_id, book_id) values ($1, $2)", [userId, bookId]);
    await db.query("insert into public.recent_reads (user_id, book_id) values ($1, $2)", [userId, bookId]);
    await db.query("insert into public.note_documents (user_id) values ($1)", [userId]);
    await db.query("insert into public.ai_usage (user_id, model) values ($1, 'm')", [userId]);
    await db.query("insert into public.quran_bookmarks (user_id, sura, aya) values ($1, 1, 1)", [userId]);

    await db.query("delete from auth.users where id = $1", [userId]);

    const { rows: profiles } = await db.query("select 1 from public.profiles where id = $1", [userId]);
    expect(profiles).toHaveLength(0);
    for (const table of PER_USER_TABLES) {
      const { rows: left } = await db.query(`select 1 from public.${table} where user_id = $1`, [userId]);
      expect(left, `${table} must hold nothing of theirs`).toHaveLength(0);
    }
    // A book they uploaded stays in the library, unattributed.
    const { rows: kept } = await db.query<{ uploaded_by: string | null }>(
      "select uploaded_by from public.books where id = $1",
      [bookId],
    );
    expect(kept).toEqual([{ uploaded_by: null }]);
  });

  it("covers every per-user table the migrations define", () => {
    const dir = join(process.cwd(), "supabase", "migrations");
    const found = new Set<string>();
    for (const file of readdirSync(dir)) {
      const sql = readFileSync(join(dir, file), "utf8");
      for (const match of sql.matchAll(/create table public\.(\w+) \(([\s\S]*?)\n\);/g)) {
        if (/user_id uuid not null references public\.profiles/.test(match[2])) found.add(match[1]);
      }
    }
    expect([...found].sort()).toEqual([...PER_USER_TABLES].sort());
  });
});
