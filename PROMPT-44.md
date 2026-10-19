# PROMPT 44 — خاتىرە دەپتىرى، 3-باسقۇچ (9 دىن): بىر ھېسابات سانداننى تولدۇرالمىسۇن

---

You are continuing an existing, live project. Read `CLAUDE.md` in this folder FIRST — it is the
project instruction and always wins — and use the **bilim-web** skill.

This is **stage 3 of 9** of the notebook plan (`PROMPT-42.md` … `PROMPT-50.md`, from
`AUDIT-2026-10-07.md`). **Do only this stage.** Stage 6 will add a trash (soft delete) to the same
table; the quota you build here must count trashed notes too (it will, if it counts every row).

## Before you start

1. `git status`, `git log --oneline -20`. Stage 2 (PROMPT-43: write-ahead drafts, one save loop,
   result codes, conflict handling) must be merged and deployed. If not, **stop and tell the owner
   in Uyghur** that PROMPT-43 must be finished first. Uncommitted changes you did not make → stop
   and ask.
   Untracked planning files in the root (`PROMPT-*.md`, `AUDIT-*.md`, `HANDOFF-*.md` and the like)
   are the owner's and expected: leave them where they are and do not commit them.
2. Read the *Project context* files in full.

## What is wrong (N6, P1)

- `createNoteAction` and `saveNoteAction` (`app/notes/actions.ts`) have **no rate limit** (compare
  `app/notes/source-actions.ts`, which uses `NOTE_SOURCE_RULE` from `lib/rate-limit.ts`), and there
  is **no cap** on how many notes an account holds or how large they are.
- One note may hold 60,000 characters of text (`lib/notes/limits.ts`) plus up to ~1 MB of HTML (the
  Server Action body limit). The database used **91.0 MB of 500 MB** on 2026-10-05 (admin usage
  panel). Supabase documents: *"Free Plan projects enter read-only mode when your database size
  exceeds 500 MB."* So one account, scripted, can put the whole site into read-only mode with a few
  thousand requests. Rate limits alone do not prevent that (they are per-instance and in memory);
  the hard bound must live in Postgres.

## Decided by the owner (2026-10-07)

- **200 notes per account**, and **5 MB per account** (5,242,880 bytes, counted as UTF-8 bytes of
  title + HTML + plain text, trashed notes included once stage 6 exists).
- Writers already above a limit keep everything; they may always shrink or delete, never grow.

## Project context

Read in full: `app/notes/actions.ts` (as changed by stage 2), `components/notes/note-editor.tsx` and
the save module stage 2 extracted, `components/notes/note-list.tsx`, `app/notes/(index)/page.tsx`,
`lib/notes/data.ts`, `lib/notes/limits.ts`, `lib/rate-limit.ts` (+ `callerKey`),
`app/notes/source-actions.ts` (how a user-keyed rule is applied),
`supabase/migrations/0001_init.sql` (the table, its trigger and RLS policy),
`supabase/migrations/0018_note_length.sql` (a stored generated column, the pattern to follow),
`supabase/migrations/0026_auth_attempts.sql` and `0027_before_user_created_hook.sql` (security
definer, `search_path = ''`, grants, constant functions like `auth_signup_brake_limit()`),
`supabase/migrations/0028_search_concurrency_gate.sql` (it already uses advisory lock key
`20261005` — do not reuse it), `tests/unit/*-sql.test.ts` with `tests/fixtures/pglite-auth.ts` (SQL
tests on a scratch PGlite database), `tests/unit/sql-parity.test.ts`, `lib/my/account.ts` (account
export and deletion include `note_documents`).

## Non-negotiable constraints (restated from `CLAUDE.md`; they win over anything here)

- **No budget, ever.** Supabase Free + Vercel Hobby; no paid service or vendor; no new cron (the one
  daily slot belongs to `/api/health`).
- **Anonymous reading always works.** RTL Uyghur UI; code, comments and commits in English.
- **Mobile Rules are hard** (`100dvh`, safe areas, ≥ 44 px, no hover-only, no horizontal scroll at
  360 px, controls visible after scroll down/up, `overscroll-contain`, logical properties).
- **RLS on every table**; `note_documents` stays owner-only. Every mutating Server Action re-reads
  the session server-side and filters by `user_id`.
- **Never edit an applied migration** — add the next free number (expected
  `supabase/migrations/0030_note_quota.sql`).
- **Never load-test production**, and never create more than a handful of notes against the real
  project in tests. Quota behaviour is tested in PGlite and with intercepted responses, never by
  filling a real account.
- A note is private: no content, title or e-mail in logs, reports, `docs/` or commits; the owner's
  check query below returns numbers only.
- No native dialogs. Do not weaken the CSP.

## What to do

### A. Migration (database is the hard bound)

In the new migration:

1. `content_bytes integer generated always as (octet_length(title) + octet_length(content_html) + octet_length(content_text)) stored`
   on `public.note_documents` (same pattern as `content_length` in 0018).
2. Constant functions `public.note_quota_max_notes()` → `200` and `public.note_quota_max_bytes()` →
   `5242880`, in the style of `auth_signup_brake_limit()`.
3. A trigger function (security definer, `set search_path = ''`, schema-qualified names) fired
   `before insert or update of title, content_html, content_text` on `public.note_documents`:
   - If `auth.uid()` is null (service role: the owner's own maintenance scripts such as
     `scripts/restore.mjs`), do nothing. Document this in the migration comment.
   - Serialize per user with `pg_advisory_xact_lock(20261007, hashtext(new.user_id::text))` so two
     parallel requests cannot both pass.
   - On insert: if the user already has `>= note_quota_max_notes()` rows → raise an exception whose
     message is exactly `note_quota_count`.
   - Size: compute the new row's size **from `new.title`, `new.content_html`, `new.content_text`**
     (a BEFORE trigger cannot read a generated column — PostgreSQL computes those after BEFORE
     triggers). On update, if the new size ≤ the old size → allow (shrinking is always allowed).
     Otherwise, if `sum(content_bytes)` of the user's **other** rows + the new size
     `> note_quota_max_bytes()` → raise `note_quota_bytes`.
4. Grants: the authenticated role must not be able to change the limits or call anything new that
   writes; follow 0026/0027.
5. A comment block at the top explaining the numbers, the owner's decision date, the shrink rule and
   the service-role exemption.

Mirror the two numbers in `lib/notes/limits.ts` (`NOTE_QUOTA_MAX_NOTES`, `NOTE_QUOTA_MAX_BYTES`) and
add a parity test that reads the migration file and fails if the SQL and TypeScript numbers differ
(follow `tests/unit/sql-parity.test.ts`).

### B. Server Actions

- Map the two exception messages to new result codes `quota_count` / `quota_bytes` (one place, as
  stage 2 prepared). Uyghur messages:
  - `quota_count`: «خاتىرە دەپتىرىڭىز تولدى: ئەڭ كۆپ 200 خاتىرە ساقلىغىلى بولىدۇ. كېرەكسىز خاتىرىلەرنى ئۆچۈرسىڭىز، يېڭىسىنى قوشالايسىز.»
  - `quota_bytes`: «خاتىرە دەپتىرىڭىزنىڭ ھەجمى تولدى (5 MB). كېرەكسىز خاتىرىلەرنى ئۆچۈرسىڭىز ياكى قىسقارتسىڭىز، ساقلاش داۋاملىشىدۇ. يازغانلىرىڭىز بۇ ئۈسكۈنىدە ساقلاندى.»
  Build both from the TypeScript constants, not hard-coded numbers.
- In the editor, `quota_bytes` is a `blocked` state (no automatic retry; the next edit tries
  again — deleting text is an edit). The local draft is kept. Stage 2's
  «ئىككى خاتىرە قىلىپ ساقلاش» and «يېڭى خاتىرە قىلىپ ساقلاش» must show `quota_count` the same way
  and keep the draft.
- Rate limits in `lib/rate-limit.ts`, keyed by the signed-in user exactly as `source-actions.ts`
  does: `NOTE_CREATE_RULE = { limit: 30, windowMs: 60 * 60_000 }` and
  `NOTE_SAVE_RULE = { limit: 600, windowMs: 10 * 60_000 }`. Reasoning for the comment: stage 2's
  client throttle (≥ 3 s between saves) keeps one busy tab under 200 saves per 10 minutes, so 600
  never touches a real writer with a few tabs open; the database quota is the real bound. Result
  code `rate` with «بەك تېز ساقلىنىۋاتىدۇ — بىر مىنۇتتىن كېيىن ئۆزى قايتا سىنايدۇ. يازغانلىرىڭىز بۇ ئۈسكۈنىدە ساقلاندى.»
  → the `retrying` state with a 60 s wait. Create over the limit → on the list:
  «بەك تېز يېڭى خاتىرە قۇرۇلۇۋاتىدۇ. بىر ئازدىن كېيىن قايتا سىناڭ.»

### C. Show the writer where they stand

On `/notes`, under the heading, one line (`data-testid="notes-usage"`):
`{count} / 200 خاتىرە · {used} MB / 5 MB` (used with one decimal, from `content_bytes` added to the
list query — no extra request). At ≥ 90 % of either limit use the existing warning style
(`bg-ab`); at 100 % the strong one (`bg-ab2`) plus «كېرەكسىز خاتىرىلەرنى ئۆچۈرسىڭىز، ئورۇن
بوشايدۇ.» When the count limit is reached, «يېڭى خاتىرە» explains instead of failing silently.

### D. Rollout — the order matters

The new list query reads `content_bytes`, which does not exist until the migration runs, and the
Playwright suite talks to the real project. So:

1. Write the migration and the code; run typecheck, lint, build and the unit/PGlite suites.
2. **Do not push yet.** Give the owner, in simple Uyghur, step by step: open supabase.com → his
   project → **SQL Editor** → **New query** → paste the whole migration file → **Run** → tell you
   what it printed (a screenshot is fine). Wait for his answer.
3. Then ask him to run this **read-only** check and send you the single result row (numbers only):
   ```sql
   select count(*) filter (where n > 200)      as accounts_over_count,
          count(*) filter (where b > 5242880)  as accounts_over_bytes,
          max(n) as most_notes, max(b) as most_bytes
   from (select user_id, count(*) n, sum(content_bytes) b
         from public.note_documents group by user_id) s;
   ```
   Report it to him in Uyghur (if anyone is already over, explain that they keep everything and can
   only shrink).
4. Run the full Playwright suite, then push.

## Tests

- `npm run typecheck`, `npm run lint`, `npm run build`, `npm run test:unit`, full Playwright suite
  green (Chromium 375×667, 390×844, 1280×800 and the Firefox/WebKit notebook projects).
- **PGlite SQL tests:** 200th insert passes, 201st raises `note_quota_count`; an update that would
  cross 5 MB raises `note_quota_bytes`; a shrinking update of an account already over the limit
  passes; another user's notes never count; with `auth.uid()` null nothing is limited;
  `content_bytes` equals the sum of the three byte lengths; the authenticated role cannot alter the
  limit functions.
- **Unit:** exception message → result code → Uyghur message; the rate rules; parity of the numbers.
- **Playwright:** `notes-usage` shows the right numbers for a test account with 1–2 notes; the
  quota and rate messages render correctly when the Server Action response is intercepted (do not
  create 200 real notes); no horizontal overflow at 360/375 px; usage line and messages visible
  after scrolling down and back up.

## Acceptance criteria

1. No account can hold more than 200 notes or grow beyond 5 MB, enforced by the database, even with
   parallel requests.
2. Nothing a writer typed is lost when a limit is hit; the message says what to do.
3. Writers already over a limit keep their notes and can shrink or delete.
4. Normal writing (one or two tabs, continuous typing) never sees the rate message.
5. `/notes` shows the usage line on every viewport.
6. The migration was applied by the owner before the push; the check query result is in your
   report (numbers only).
7. typecheck, lint, build, unit, PGlite and all Playwright projects green.

Commit per logical step (`feat(db): cap notes per account`, `feat(notes): rate-limit note writes`,
`feat(notes): show notebook usage`, `test(db): …`). Finish with a short report **in simple Uyghur**
for the owner: what changed, the check result, and what he should see on `/notes`.

If anything here conflicts with `CLAUDE.md`, or you would have to trade away the writer's text,
privacy, mobile quality or the free-tier limits to finish it, **stop and ask the owner in Uyghur** —
never make that trade silently.
