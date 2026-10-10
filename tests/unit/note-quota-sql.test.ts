import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { NOTE_QUOTA_MAX_BYTES, NOTE_QUOTA_MAX_NOTES } from "@/lib/notes/limits";
import { QUOTA_EXCEPTIONS, quotaCode } from "@/lib/notes/save-protocol";
import { installAuthStubs, migrationSql, tableSql } from "../fixtures/pglite-auth";

/**
 * The notebook's quota (PROMPT-44, migration 0030) on a real Postgres —
 * PGlite, the same engine compiled to WebAssembly, on a scratch database that
 * holds nothing but what each case puts in it; never the real project, and
 * never a real account filled up.
 *
 * note_documents is the CREATE TABLE from 0001 with its RLS policy, 0018's
 * generated column and 0030 exactly as the owner pastes it. A signed-in
 * writer is the `authenticated` role with a JWT `sub`, as PostgREST runs a
 * request; Supabase's own auth.uid() is reproduced below.
 *
 * What PGlite cannot show is two requests at once (it is one session):
 * that the guard takes its per-account lock is checked in pg_locks instead.
 */

const ME = "aaaaaaaa-0000-4000-8000-000000000001";
const OTHER = "bbbbbbbb-0000-4000-8000-000000000002";

let db: PGlite;

/** One statement as a signed-in writer, in its own transaction, as PostgREST does. */
async function asWriter<T>(userId: string, sql: string, params: unknown[] = []): Promise<T[]> {
  return db.transaction(async (tx) => {
    await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: userId, role: "authenticated" })]);
    await tx.exec("set local role authenticated");
    return (await tx.query<T>(sql, params)).rows;
  });
}

/** One statement as a Supabase role with no user — the service-role key. */
async function asRole<T>(role: string, sql: string, params: unknown[] = []): Promise<T[]> {
  return db.transaction(async (tx) => {
    await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ role })]);
    await tx.exec(`set local role ${role}`);
    return (await tx.query<T>(sql, params)).rows;
  });
}

/** The error a statement raised, or null when it went through. */
async function refusal(work: Promise<unknown>): Promise<string | null> {
  try {
    await work;
    return null;
  } catch (error) {
    return (error as { message?: string }).message ?? String(error);
  }
}

/** A note written by the owner's maintenance path: no user, so no quota. */
async function seedNote(userId: string, html = "", text = ""): Promise<number> {
  const { rows } = await db.query<{ id: number }>(
    "insert into public.note_documents (user_id, content_html, content_text) values ($1, $2, $3) returning id",
    [userId, html, text],
  );
  return rows[0].id;
}

async function seedNotes(userId: string, count: number): Promise<void> {
  await db.query(
    "insert into public.note_documents (user_id) select $1 from generate_series(1, $2)",
    [userId, count],
  );
}

async function totals(userId: string): Promise<{ notes: number; bytes: number }> {
  const { rows } = await db.query<{ notes: number; bytes: number }>(
    "select count(*)::int as notes, coalesce(sum(content_bytes), 0)::int as bytes from public.note_documents where user_id = $1",
    [userId],
  );
  return rows[0];
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
    -- As in every Supabase project: the service-role key is not bound by RLS.
    alter role service_role with bypassrls;
  `);
  await db.exec(tableSql("0001_init.sql", "profiles"));
  await db.exec(tableSql("0001_init.sql", "note_documents"));
  await db.exec(`
    -- 0001's trigger and policy for the table, as they stand in production.
    create or replace function public.set_updated_at() returns trigger language plpgsql as $fn$
    begin new.updated_at = now(); return new; end $fn$;
    create trigger note_documents_set_updated_at before update on public.note_documents
      for each row execute function public.set_updated_at();
    alter table public.note_documents enable row level security;
    create policy "note_documents_owner" on public.note_documents
      for all using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
    -- Supabase's default table privileges for its API roles.
    grant select, insert, update, delete on public.note_documents to anon, authenticated, service_role;
  `);
  await db.exec(migrationSql("0018_note_length.sql"));
  await db.exec(migrationSql("0030_note_quota.sql"));
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

describe("the limits", () => {
  it("are the same numbers in SQL and in lib/notes/limits.ts", async () => {
    const { rows } = await db.query<{ notes: number; bytes: number }>(
      "select public.note_quota_max_notes() as notes, public.note_quota_max_bytes() as bytes",
    );
    expect(rows[0]).toEqual({ notes: NOTE_QUOTA_MAX_NOTES, bytes: NOTE_QUOTA_MAX_BYTES });
    expect(rows[0]).toEqual({ notes: 200, bytes: 5_242_880 });
  });

  it("raise exactly the messages the Server Actions turn into result codes", () => {
    expect(Object.keys(QUOTA_EXCEPTIONS).sort()).toEqual(["note_quota_bytes", "note_quota_count"]);
    const sql = migrationSql("0030_note_quota.sql");
    for (const message of Object.keys(QUOTA_EXCEPTIONS)) {
      expect(sql).toContain(`raise exception '${message}'`);
    }
  });
});

describe("content_bytes", () => {
  it("is the UTF-8 bytes of the title, the HTML and the text together", async () => {
    // Uyghur letters are two bytes each in UTF-8; «ـ» too; the emoji four.
    const title = "خاتىرە ✍️";
    const html = "<p>بۇ مېنىڭ سىناق خاتىرەم 😀</p>";
    const text = "بۇ مېنىڭ سىناق خاتىرەم 😀";
    await asWriter(ME, "insert into public.note_documents (user_id, title, content_html, content_text) values ($1, $2, $3, $4)", [
      ME,
      title,
      html,
      text,
    ]);
    const { rows } = await db.query<{ content_bytes: number }>(
      "select content_bytes from public.note_documents where user_id = $1",
      [ME],
    );
    const expected = [title, html, text].reduce((sum, part) => sum + Buffer.byteLength(part, "utf8"), 0);
    expect(rows[0].content_bytes).toBe(expected);
  });

  it("cannot be written by anyone", async () => {
    const id = await seedNote(ME);
    expect(
      await refusal(asWriter(ME, "update public.note_documents set content_bytes = 0 where id = $1", [id])),
    ).toMatch(/content_bytes/);
  });
});

describe("200 notes per account", () => {
  it("lets the 200th note in and refuses the 201st with note_quota_count", async () => {
    await seedNotes(ME, NOTE_QUOTA_MAX_NOTES - 1);
    expect(
      await refusal(asWriter(ME, "insert into public.note_documents (user_id) values ($1)", [ME])),
    ).toBeNull();
    expect((await totals(ME)).notes).toBe(NOTE_QUOTA_MAX_NOTES);

    const message = await refusal(asWriter(ME, "insert into public.note_documents (user_id) values ($1)", [ME]));
    expect(message).toBe("note_quota_count");
    expect(quotaCode({ message })).toBe("quota_count");
    expect((await totals(ME)).notes).toBe(NOTE_QUOTA_MAX_NOTES);
  });

  it("still lets a full account edit, shrink and delete what it has", async () => {
    await seedNotes(ME, NOTE_QUOTA_MAX_NOTES + 5);
    const { rows } = await db.query<{ id: number }>("select id from public.note_documents where user_id = $1 limit 2", [ME]);
    expect(
      await refusal(
        asWriter(ME, "update public.note_documents set title = 'قىسقا', content_html = '<p>ب</p>', content_text = 'ب' where id = $1", [rows[0].id]),
      ),
    ).toBeNull();
    expect(await refusal(asWriter(ME, "delete from public.note_documents where id = $1", [rows[1].id]))).toBeNull();
    expect((await totals(ME)).notes).toBe(NOTE_QUOTA_MAX_NOTES + 4);
    // Still over: a new note is still refused until enough are gone.
    expect(await refusal(asWriter(ME, "insert into public.note_documents (user_id) values ($1)", [ME]))).toBe(
      "note_quota_count",
    );
  });

  it("never counts another account's notes", async () => {
    await seedNotes(OTHER, NOTE_QUOTA_MAX_NOTES + 10);
    await seedNote(OTHER, "a".repeat(NOTE_QUOTA_MAX_BYTES));
    expect(await refusal(asWriter(ME, "insert into public.note_documents (user_id) values ($1)", [ME]))).toBeNull();
    expect(
      await refusal(
        asWriter(ME, "update public.note_documents set content_html = $2, content_text = $2 where user_id = $1", [ME, "ب".repeat(10_000)]),
      ),
    ).toBeNull();
  });
});

describe("5 MB per account", () => {
  /** One byte short of the limit, in one note seeded without a user. */
  async function nearlyFull(userId: string, headroom: number): Promise<number> {
    const id = await seedNote(userId);
    const { content_bytes } = (
      await db.query<{ content_bytes: number }>("select content_bytes from public.note_documents where id = $1", [id])
    ).rows[0];
    await db.query("update public.note_documents set content_html = $2 where id = $1", [
      id,
      "a".repeat(NOTE_QUOTA_MAX_BYTES - content_bytes - headroom),
    ]);
    expect((await totals(userId)).bytes).toBe(NOTE_QUOTA_MAX_BYTES - headroom);
    return id;
  }

  it("refuses an update that would cross 5 MB with note_quota_bytes, and keeps the old text", async () => {
    await nearlyFull(ME, 100);
    const id = await seedNote(ME, "<p>کونا</p>", "کونا");
    const before = await totals(ME);

    // Exactly up to the limit is allowed …
    const room = NOTE_QUOTA_MAX_BYTES - before.bytes;
    expect(
      await refusal(asWriter(ME, "update public.note_documents set content_html = content_html || $2 where id = $1", [id, "x".repeat(room)])),
    ).toBeNull();
    expect((await totals(ME)).bytes).toBe(NOTE_QUOTA_MAX_BYTES);

    // … one byte past it is not, and the row is as it was.
    const message = await refusal(
      asWriter(ME, "update public.note_documents set content_text = content_text || 'x' where id = $1", [id]),
    );
    expect(message).toBe("note_quota_bytes");
    expect(quotaCode({ message })).toBe("quota_bytes");
    expect((await totals(ME)).bytes).toBe(NOTE_QUOTA_MAX_BYTES);
  });

  it("counts a title change like any other growth", async () => {
    const id = await nearlyFull(ME, 0);
    expect(
      await refusal(asWriter(ME, "update public.note_documents set title = title || 'ب' where id = $1", [id])),
    ).toBe("note_quota_bytes");
  });

  it("refuses a new note that does not fit, even an empty one", async () => {
    await nearlyFull(ME, 3);
    expect(await refusal(asWriter(ME, "insert into public.note_documents (user_id) values ($1)", [ME]))).toBe(
      "note_quota_bytes",
    );
    expect(
      await refusal(asWriter(ME, "insert into public.note_documents (user_id, title) values ($1, 'ab')", [ME])),
    ).toBeNull();
  });

  it("always lets an account that is already over shrink a note, or keep its size", async () => {
    await seedNote(ME, "a".repeat(NOTE_QUOTA_MAX_BYTES + 1_000_000));
    const id = await seedNote(ME, "<p>ئۇزۇن خاتىرە</p>", "ئۇزۇن خاتىرە");
    expect((await totals(ME)).bytes).toBeGreaterThan(NOTE_QUOTA_MAX_BYTES);

    // The same number of bytes, other letters: allowed.
    expect(
      await refusal(asWriter(ME, "update public.note_documents set content_html = '<p>ئۇزۇن خاتىرا</p>', content_text = 'ئۇزۇن خاتىرا' where id = $1", [id])),
    ).toBeNull();
    // Smaller: allowed.
    expect(
      await refusal(asWriter(ME, "update public.note_documents set content_html = '<p>قىسقا</p>', content_text = 'قىسقا' where id = $1", [id])),
    ).toBeNull();
    // Larger by one byte: refused.
    expect(
      await refusal(asWriter(ME, "update public.note_documents set content_text = content_text || 'x' where id = $1", [id])),
    ).toBe("note_quota_bytes");
    // And the big one itself may be cut down.
    expect(
      await refusal(asWriter(ME, "update public.note_documents set content_html = left(content_html, 10) where user_id = $1 and content_bytes > 1000000", [ME])),
    ).toBeNull();
    expect((await totals(ME)).bytes).toBeLessThan(NOTE_QUOTA_MAX_BYTES);
  });

  it("is checked under a per-account lock, so two requests take turns", async () => {
    await db.transaction(async (tx) => {
      await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: ME })]);
      await tx.exec("set local role authenticated");
      await tx.query("insert into public.note_documents (user_id) values ($1)", [ME]);
      await tx.exec("reset role");
      const { rows } = await tx.query<{ held: number }>(
        `select count(*)::int as held from pg_locks
          where locktype = 'advisory' and classid = 20261007 and objid = hashtext($1)::oid and objsubid = 2`,
        [ME],
      );
      expect(rows[0].held).toBe(1);
    });
  });
});

describe("who the quota applies to", () => {
  it("does not limit a write with no user — the owner's service-role scripts and the SQL Editor", async () => {
    await seedNotes(ME, NOTE_QUOTA_MAX_NOTES);
    // As service_role, which carries no `sub`.
    await asRole("service_role", "insert into public.note_documents (user_id, content_html) values ($1, $2)", [
      ME,
      "a".repeat(NOTE_QUOTA_MAX_BYTES),
    ]);
    // As the database owner.
    await db.query("insert into public.note_documents (user_id) values ($1)", [ME]);
    const after = await totals(ME);
    expect(after.notes).toBe(NOTE_QUOTA_MAX_NOTES + 2);
    expect(after.bytes).toBeGreaterThan(NOTE_QUOTA_MAX_BYTES);
  });

  it("answers a write into someone else's notebook with RLS, never with their quota", async () => {
    // Their notebook is full; the answer must not say so.
    await seedNotes(OTHER, NOTE_QUOTA_MAX_NOTES);
    expect(await refusal(asWriter(ME, "insert into public.note_documents (user_id) values ($1)", [OTHER]))).toMatch(
      /row-level security/,
    );
    expect((await totals(OTHER)).notes).toBe(NOTE_QUOTA_MAX_NOTES);
  });
});

describe("what a signed-in writer may do to the quota itself", () => {
  const attempts = [
    "create or replace function public.note_quota_max_notes() returns integer language sql immutable as $fn$ select 100000 $fn$",
    "create or replace function public.note_quota_max_bytes() returns integer language sql immutable as $fn$ select 2000000000 $fn$",
    "alter function public.note_quota_max_notes() owner to authenticated",
    "alter function public.note_quota_guard() security invoker",
    "drop function public.note_quota_max_bytes()",
    "drop trigger note_documents_quota on public.note_documents",
    "alter table public.note_documents disable trigger note_documents_quota",
    "alter table public.note_documents drop column content_bytes",
  ];

  for (const role of ["authenticated", "anon"]) {
    it(`${role} can neither change the limits nor switch the guard off`, async () => {
      for (const sql of attempts) {
        await expect(
          role === "authenticated" ? asWriter(ME, sql) : asRole(role, sql),
          `${role}: ${sql}`,
        ).rejects.toMatchObject({ code: "42501" });
      }
      const { rows } = await db.query<{ notes: number; bytes: number }>(
        "select public.note_quota_max_notes() as notes, public.note_quota_max_bytes() as bytes",
      );
      expect(rows[0]).toEqual({ notes: NOTE_QUOTA_MAX_NOTES, bytes: NOTE_QUOTA_MAX_BYTES });
    });

    it(`${role} cannot call the limit functions or the guard`, async () => {
      for (const sql of [
        "select public.note_quota_max_notes()",
        "select public.note_quota_max_bytes()",
        "select public.note_quota_guard()",
      ]) {
        await expect(
          role === "authenticated" ? asWriter(ME, sql) : asRole(role, sql),
          `${role}: ${sql}`,
        ).rejects.toMatchObject({ code: "42501" });
      }
    });
  }
});
