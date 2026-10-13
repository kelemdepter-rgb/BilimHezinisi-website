import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { NOTE_TRASH_DAYS } from "@/lib/notes/limits";
import { UNTITLED } from "@/lib/notes/save-protocol";
import { installAuthStubs, migrationSql, tableSql } from "../fixtures/pglite-auth";

/**
 * The notebook list's database half (PROMPT-47, migration 0031) on a real
 * Postgres — PGlite, on a scratch database holding only what each case puts
 * in it. note_documents is 0001's table with its trigger and RLS policy, then
 * 0018, 0030 and 0031 exactly as the owner pastes them; ug_normalize is
 * 0002's. A signed-in writer is the `authenticated` role with a JWT `sub`, as
 * PostgREST runs a request. Every text here is invented.
 */

const ME = "aaaaaaaa-0000-4000-8000-000000000001";
const OTHER = "bbbbbbbb-0000-4000-8000-000000000002";

let db: PGlite;

function functionSql(file: string, name: string): string {
  const sql = migrationSql(file);
  const start = sql.indexOf(`create or replace function public.${name}`);
  if (start < 0) throw new Error(`public.${name} not found in ${file}`);
  const end = sql.indexOf("$fn$;", start);
  return sql.slice(start, end + "$fn$;".length);
}

/** One statement as a signed-in writer, in its own transaction, as PostgREST does. */
async function asWriter<T>(userId: string, sql: string, params: unknown[] = []): Promise<T[]> {
  return db.transaction(async (tx) => {
    await tx.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ sub: userId, role: "authenticated" }),
    ]);
    await tx.exec("set local role authenticated");
    return (await tx.query<T>(sql, params)).rows;
  });
}

/** One statement as a Supabase role with no user (anon, the service-role key). */
async function asRole<T>(role: string, sql: string, params: unknown[] = []): Promise<T[]> {
  return db.transaction(async (tx) => {
    await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ role })]);
    await tx.exec(`set local role ${role}`);
    return (await tx.query<T>(sql, params)).rows;
  });
}

async function refusal(work: Promise<unknown>): Promise<string | null> {
  try {
    await work;
    return null;
  } catch (error) {
    return (error as { message?: string }).message ?? String(error);
  }
}

type NoteSeed = { title?: string; text?: string; html?: string; deletedDaysAgo?: number; pinned?: boolean };

/** A note written by the owner's maintenance path — the quota does not apply. */
async function seed(userId: string, note: NoteSeed = {}): Promise<number> {
  const { rows } = await db.query<{ id: number }>(
    `insert into public.note_documents (user_id, title, content_html, content_text, deleted_at, pinned_at)
     values ($1, coalesce($2, 'يېڭى خاتىرە'), $3, $4,
             case when $5::int is null then null else now() - make_interval(days => $5::int) end,
             case when $6 then now() else null end)
     returning id`,
    [userId, note.title ?? null, note.html ?? note.text ?? "", note.text ?? "", note.deletedDaysAgo ?? null, note.pinned ?? false],
  );
  return rows[0].id;
}

type Found = { id: number; title: string; preview: string; pinned_at: string | null };

async function search(userId: string, query: string, limit?: number): Promise<Found[]> {
  return limit === undefined
    ? asWriter<Found>(userId, "select * from public.search_my_notes($1)", [query])
    : asWriter<Found>(userId, "select * from public.search_my_notes($1, $2)", [query, limit]);
}

async function ids(found: Promise<Found[]>): Promise<number[]> {
  return (await found).map((row) => Number(row.id));
}

async function exists(id: number): Promise<boolean> {
  const { rows } = await db.query("select 1 from public.note_documents where id = $1", [id]);
  return rows.length === 1;
}

beforeAll(async () => {
  db = await new PGlite();
  await installAuthStubs(db);
  await db.exec(`
    -- Supabase's auth.uid(), as it is defined in a real project.
    create or replace function auth.uid() returns uuid language sql stable as $fn$
      select coalesce(
        nullif(current_setting('request.jwt.claim.sub', true), ''),
        (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
      )::uuid
    $fn$;
    grant usage on schema auth to anon, authenticated, service_role;
    grant execute on function auth.uid() to anon, authenticated, service_role;
    alter role service_role with bypassrls;
  `);
  await db.exec(functionSql("0002_fix_ug_normalize.sql", "ug_normalize"));
  await db.exec(tableSql("0001_init.sql", "profiles"));
  await db.exec(tableSql("0001_init.sql", "note_documents"));
  await db.exec(`
    -- 0001's trigger and policy for the table, as they stood before 0031.
    create or replace function public.set_updated_at() returns trigger language plpgsql as $fn$
    begin new.updated_at = now(); return new; end $fn$;
    create trigger note_documents_set_updated_at before update on public.note_documents
      for each row execute function public.set_updated_at();
    alter table public.note_documents enable row level security;
    create policy "note_documents_owner" on public.note_documents
      for all using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
    grant select, insert, update, delete on public.note_documents to anon, authenticated, service_role;
  `);
  await db.exec(migrationSql("0018_note_length.sql"));
  await db.exec(migrationSql("0030_note_quota.sql"));
  await db.exec(migrationSql("0031_note_list.sql"));
  for (const id of [ME, OTHER]) {
    await db.query("insert into auth.users (id, email) values ($1, $2)", [id, `${id.slice(0, 8)}@example.com`]);
    await db.query("insert into public.profiles (id) values ($1)", [id]);
  }
});

afterAll(async () => {
  await db?.close();
});

beforeEach(async () => {
  await db.exec("delete from public.note_documents");
});

describe("the numbers and words both sides share", () => {
  it("keeps a note in the trash as many days in SQL as lib/notes/limits.ts says", async () => {
    const { rows } = await db.query<{ days: number }>("select public.note_trash_days() as days");
    expect(rows[0].days).toBe(NOTE_TRASH_DAYS);
    expect(NOTE_TRASH_DAYS).toBe(30);
  });

  it("knows a new note by the same default title the editor uses", async () => {
    const { rows } = await db.query<{ title: string }>(
      "insert into public.note_documents (user_id) values ($1) returning title",
      [ME],
    );
    expect(rows[0].title).toBe(UNTITLED);
    expect(functionSql("0031_note_list.sql", "discard_note_if_empty")).toContain(`d.title = '${UNTITLED}'`);
  });
});

describe("preview", () => {
  it("is the opening of the text, whitespace collapsed, at most 160 characters", async () => {
    const lines = `  \n\nبىرىنچى قۇر\n\n\tئىككىنچى   قۇر  ${"ئا".repeat(200)}`;
    const id = await seed(ME, { text: lines });
    const { rows } = await db.query<{ preview: string }>("select preview from public.note_documents where id = $1", [id]);
    expect(rows[0].preview.startsWith("بىرىنچى قۇر ئىككىنچى قۇر ئائا")).toBe(true);
    expect([...rows[0].preview]).toHaveLength(160);
  });

  it("is empty for an empty note and follows every save", async () => {
    const id = await seed(ME);
    await asWriter(ME, "update public.note_documents set content_text = 'يېڭى مەزمۇن' where id = $1", [id]);
    const { rows } = await db.query<{ preview: string }>("select preview from public.note_documents where id = $1", [id]);
    expect(rows[0].preview).toBe("يېڭى مەزمۇن");
    const empty = await seed(ME);
    const { rows: none } = await db.query<{ preview: string }>("select preview from public.note_documents where id = $1", [empty]);
    expect(none[0].preview).toBe("");
  });
});

describe("pinning and the trash are not edits", () => {
  it("leaves updated_at alone, while a save still moves it", async () => {
    const id = await seed(ME, { title: "سىناق", text: "مەزمۇن" });
    const stamp = async () =>
      (await db.query<{ at: string }>("select updated_at::text as at from public.note_documents where id = $1", [id])).rows[0].at;
    const before = await stamp();
    await asWriter(ME, "update public.note_documents set pinned_at = now() where id = $1", [id]);
    await asWriter(ME, "update public.note_documents set deleted_at = now() where id = $1", [id]);
    await asWriter(ME, "update public.note_documents set deleted_at = null, pinned_at = null where id = $1", [id]);
    expect(await stamp()).toBe(before);
    await asWriter(ME, "update public.note_documents set title = 'يېڭى ماۋزۇ', content_html = 'x', content_text = 'x' where id = $1", [id]);
    expect(await stamp()).not.toBe(before);
  });

  it("cannot pin or trash someone else's note", async () => {
    const theirs = await seed(OTHER, { text: "مەزمۇن" });
    const changed = await asWriter(ME, "update public.note_documents set deleted_at = now(), pinned_at = now() where id = $1 returning id", [theirs]);
    expect(changed).toHaveLength(0);
    const { rows } = await db.query<{ deleted_at: string | null; pinned_at: string | null }>(
      "select deleted_at, pinned_at from public.note_documents where id = $1",
      [theirs],
    );
    expect(rows[0]).toEqual({ deleted_at: null, pinned_at: null });
  });
});

describe("search_my_notes", () => {
  it("finds a note by its title and by its text", async () => {
    const byTitle = await seed(ME, { title: "سەپەر خاتىرىسى", text: "باشقا گەپ" });
    const byText = await seed(ME, { title: "ئادەتتىكى", text: "بۈگۈن سەپەرگە چىقتۇق" });
    await seed(ME, { title: "ئالاقىسى يوق", text: "ھېچنېمە" });
    expect((await ids(search(ME, "سەپەر"))).sort()).toEqual([byTitle, byText].sort());
  });

  it("searches one literal phrase, operators included", async () => {
    const both = await seed(ME, { text: "قىزىل گۈل ئېچىلدى" });
    await seed(ME, { text: "گۈل قىزىل ئەمەس" });
    expect(await ids(search(ME, "قىزىل گۈل"))).toEqual([both]);
    expect(await ids(search(ME, '"قىزىل" OR گۈل'))).toEqual([]);
    const literal = await seed(ME, { text: "باھاسى -5 OR 6" });
    expect(await ids(search(ME, "-5 OR 6"))).toEqual([literal]);
  });

  it("matches whatever the hamza forms and tashkil", async () => {
    const plain = await seed(ME, { text: "الله اكبر" });
    const marked = await seed(ME, { text: "قَالَ أَحْمَدُ" });
    expect(await ids(search(ME, "اللّٰه"))).toEqual([plain]);
    expect(await ids(search(ME, "قال احمد"))).toEqual([marked]);
    expect(await ids(search(ME, "إحمد"))).toEqual([marked]);
  });

  it("leaves the trash and other writers' notes out", async () => {
    const mine = await seed(ME, { text: "ئورتاق سۆز" });
    await seed(ME, { text: "ئورتاق سۆز", deletedDaysAgo: 1 });
    await seed(OTHER, { text: "ئورتاق سۆز" });
    expect(await ids(search(ME, "ئورتاق"))).toEqual([mine]);
    expect(await ids(search(OTHER, "ئورتاق"))).toHaveLength(1);
  });

  it("asks for 2 to 100 characters once trimmed, and something left after normalizing", async () => {
    await seed(ME, { text: `ئا ب ${"ك".repeat(120)}` });
    expect(await ids(search(ME, "ئ"))).toEqual([]);
    expect(await ids(search(ME, "   ئ  "))).toEqual([]);
    expect(await ids(search(ME, " ئا "))).toHaveLength(1);
    expect(await ids(search(ME, "ك".repeat(100)))).toHaveLength(1);
    expect(await ids(search(ME, "ك".repeat(101)))).toEqual([]);
    // Tashkil alone normalizes to nothing, which strpos would find everywhere.
    expect(await ids(search(ME, "َُِّ"))).toEqual([]);
    expect(await ids(search(ME, ""))).toEqual([]);
  });

  it("answers at most 50 rows, pinned first and then the newest edit", async () => {
    for (let index = 0; index < 60; index++) await seed(ME, { text: `ئورتاق ${index}` });
    expect(await search(ME, "ئورتاق")).toHaveLength(50);
    expect(await search(ME, "ئورتاق", 500)).toHaveLength(50);
    expect(await search(ME, "ئورتاق", 3)).toHaveLength(3);

    await db.exec("delete from public.note_documents");
    const old = await seed(ME, { text: "ئورتاق كونا" });
    const pinned = await seed(ME, { text: "ئورتاق مىقلانغان", pinned: true });
    const fresh = await seed(ME, { text: "ئورتاق يېڭى" });
    await asWriter(ME, "update public.note_documents set content_text = 'ئورتاق يېڭىلاندى' where id = $1", [fresh]);
    expect(await ids(search(ME, "ئورتاق"))).toEqual([pinned, fresh, old]);
  });

  it("finds exactly the notes whose ug_normalize holds ug_normalize(query), on generated texts", async () => {
    // The search reads the notes as they are and folds the QUERY into a
    // pattern instead (0031 says why). It must agree, note for note, with the
    // plain definition: strpos over ug_normalize of both. Texts and queries
    // are drawn from everything ug_normalize treats specially — alif forms,
    // tashkil, tatweel, whitespace of every kind, Latin case — and from the
    // characters a pattern could misread.
    let state = 47;
    const random = () => {
      state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
      return state / 2_147_483_648;
    };
    const pick = <T,>(items: readonly T[]): T => items[Math.floor(random() * items.length)];
    const LETTERS = ["ا", "ب", "ى", "ل", "ە", "ئ", "ۇ", "ك", "a", "b"];
    const ALIFS = ["ٱ", "آ", "أ", "إ"];
    const MARKS = ["ً", "ُ", "ِ", "ّ", "ْ", "ٰ", "ۖ", "࣓", "ـ"];
    const SPACES = [" ", "\t", "\n", "  ", " \n ", "　"];
    const ODD = [".", "*", "+", "?", "(", ")", "[", "]", "{", "}", "|", "^", "$", "\\", "-", "،", "'", "%", "_"];

    /** A base text of plain letters, single spaces and odd characters. */
    const base = (length: number) =>
      Array.from({ length }, () => (random() < 0.2 ? " " : random() < 0.1 ? pick(ODD) : pick(LETTERS))).join("");
    /** The same text as a writer might really have it: forms, marks, spacing and case varied. */
    const dress = (text: string) =>
      [...text]
        .map((character) => {
          let out = character;
          if (character === "ا" && random() < 0.4) out = pick(ALIFS);
          else if (character === " " && random() < 0.5) out = pick(SPACES);
          else if (/[ab]/.test(character) && random() < 0.4) out = character.toUpperCase();
          if (random() < 0.15) out += pick(MARKS);
          return out;
        })
        .join("");

    const bases = Array.from({ length: 40 }, () => base(30 + Math.floor(random() * 40)));
    for (const text of bases) await seed(ME, { title: dress(base(6)), text: dress(text) });

    const queries: string[] = [];
    for (let index = 0; index < 220; index++) {
      if (index % 4 === 3) {
        queries.push(dress(base(2 + Math.floor(random() * 6))));
      } else {
        const text = pick(bases);
        const start = Math.floor(random() * (text.length - 12));
        queries.push(dress(text.slice(start, start + 2 + Math.floor(random() * 10))));
      }
    }

    let found = 0;
    let missed = 0;
    for (const query of queries) {
      const expected = (
        await asWriter<{ id: number }>(
          ME,
          `select id from public.note_documents
            where deleted_at is null
              and char_length(regexp_replace($1, '^\\s+|\\s+$', '', 'g')) between 2 and 100
              and public.ug_normalize($1) <> ''
              and strpos(public.ug_normalize(title || E'\\n' || content_text), public.ug_normalize($1)) > 0`,
          [query],
        )
      ).map((row) => Number(row.id));
      const actual = await ids(search(ME, query));
      expect({ query, ids: actual.sort((a, b) => a - b) }).toEqual({ query, ids: expected.sort((a, b) => a - b) });
      if (expected.length > 0) found++;
      else missed++;
    }
    // Neither side of the comparison may be empty, or it proves nothing.
    expect(found).toBeGreaterThan(100);
    expect(missed).toBeGreaterThan(20);
  });

  it("returns the list's columns and never a note's body", async () => {
    await seed(ME, { title: "ماۋزۇ", text: "مەزمۇن" });
    const [row] = await search(ME, "مەزمۇن");
    expect(Object.keys(row).sort()).toEqual(
      ["content_bytes", "content_length", "created_at", "id", "pinned_at", "preview", "title", "updated_at"].sort(),
    );
  });

  it("is not for anonymous visitors", async () => {
    await seed(ME, { text: "مەخپىي" });
    expect(await refusal(asRole("anon", "select * from public.search_my_notes('مەخپىي')"))).toMatch(/permission denied/);
  });
});

describe("purge_note_trash", () => {
  it("deletes only notes that have been in the trash longer than the limit, oldest first, up to p_limit", async () => {
    // Written newest-expired first, so a scan in table order would pick the
    // wrong two: only "oldest first" passes.
    const old = await seed(OTHER, { deletedDaysAgo: NOTE_TRASH_DAYS + 1 });
    const live = await seed(ME, { text: "تىرىك" });
    const recent = await seed(ME, { deletedDaysAgo: NOTE_TRASH_DAYS - 1 });
    const older = await seed(ME, { deletedDaysAgo: NOTE_TRASH_DAYS + 10 });
    const oldest = await seed(OTHER, { deletedDaysAgo: NOTE_TRASH_DAYS + 20 });

    const [first] = await asRole<{ n: number }>("service_role", "select public.purge_note_trash(2) as n");
    expect(first.n).toBe(2);
    expect(await exists(oldest)).toBe(false);
    expect(await exists(older)).toBe(false);
    expect(await exists(old)).toBe(true);

    const [second] = await asRole<{ n: number }>("service_role", "select public.purge_note_trash(500) as n");
    expect(second.n).toBe(1);
    expect(await exists(old)).toBe(false);
    expect(await exists(recent)).toBe(true);
    expect(await exists(live)).toBe(true);

    const [none] = await asRole<{ n: number }>("service_role", "select public.purge_note_trash(500) as n");
    expect(none.n).toBe(0);
  });

  it("is the service role's alone", async () => {
    await seed(ME, { deletedDaysAgo: NOTE_TRASH_DAYS + 5 });
    expect(await refusal(asWriter(ME, "select public.purge_note_trash(500)"))).toMatch(/permission denied/);
    expect(await refusal(asRole("anon", "select public.purge_note_trash(500)"))).toMatch(/permission denied/);
    expect(await refusal(asWriter(ME, "select public.note_trash_days()"))).toMatch(/permission denied/);
  });
});

describe("the quota still counts the trash", () => {
  it("refuses a new note while trashed ones fill the 200", async () => {
    await db.query(
      "insert into public.note_documents (user_id, deleted_at) select $1, now() from generate_series(1, 150)",
      [ME],
    );
    await db.query("insert into public.note_documents (user_id) select $1 from generate_series(1, 50)", [ME]);
    const message = await refusal(asWriter(ME, "insert into public.note_documents (user_id) values ($1)", [ME]));
    expect(message).toBe("note_quota_count");

    // Gone for good, there is room again.
    await db.exec("delete from public.note_documents where deleted_at is not null and id in (select id from public.note_documents where deleted_at is not null limit 1)");
    expect(await refusal(asWriter(ME, "insert into public.note_documents (user_id) values ($1)", [ME]))).toBeNull();
  });

  it("counts a trashed note's bytes", async () => {
    const big = "ئا".repeat(1_200_000); // 2.4 MB of text, the same again as HTML
    await seed(ME, { text: big, html: big, deletedDaysAgo: 1 });
    const message = await refusal(
      asWriter(ME, "insert into public.note_documents (user_id, content_html, content_text) values ($1, $2, $2)", [
        ME,
        "ب".repeat(200_000),
      ]),
    );
    expect(message).toBe("note_quota_bytes");
  });
});

describe("discard_note_if_empty", () => {
  async function discard(userId: string, id: number): Promise<boolean> {
    const [row] = await asWriter<{ gone: boolean }>(userId, "select public.discard_note_if_empty($1) as gone", [id]);
    return row.gone;
  }

  it("removes a note nobody wrote in", async () => {
    const id = await seed(ME);
    expect(await discard(ME, id)).toBe(true);
    expect(await exists(id)).toBe(false);
  });

  it("keeps anything that holds text, a title of its own, or a save", async () => {
    const withText = await seed(ME, { text: "بىر سۆز" });
    const renamed = await seed(ME, { title: "ئۆز ماۋزۇسى" });
    const saved = await seed(ME);
    await asWriter(ME, "update public.note_documents set content_text = 'x', content_html = 'x' where id = $1", [saved]);
    await asWriter(ME, "update public.note_documents set content_text = '', content_html = '' where id = $1", [saved]);
    const trashed = await seed(ME, { deletedDaysAgo: 1 });
    for (const id of [withText, renamed, saved, trashed]) {
      expect(await discard(ME, id)).toBe(false);
      expect(await exists(id)).toBe(true);
    }
  });

  it("never touches another writer's note, and is not for anonymous visitors", async () => {
    const theirs = await seed(OTHER);
    expect(await discard(ME, theirs)).toBe(false);
    expect(await exists(theirs)).toBe(true);
    expect(await refusal(asRole("anon", `select public.discard_note_if_empty(${theirs})`))).toMatch(/permission denied/);
  });
});
