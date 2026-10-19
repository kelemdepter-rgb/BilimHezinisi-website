# PROMPT 47 — خاتىرە دەپتىرى، 6-باسقۇچ (9 دىن): خاتىرە تىزىملىكى ۋە ئەخلەت ساندۇقى

**قانداق ئىشلىتىسىز:** `PROMPT-46.md` تاماملىنىپ سايتقا چىققاندىن **كېيىن** ئىشلىتىڭ. Claude Code نى
`BilimHezinisi-website` قىسقۇچىدا **يېڭى تۈر** قىلىپ ئېچىڭ، «---» دىن كېيىنكى پۈتۈن ئىنگلىزچە قىسمىنى
چاپلاڭ. بۇ باسقۇچتىمۇ سىز **Supabase دا بىر قېتىم SQL ئىجرا قىلىسىز** — Claude Code قەدەممۇ-قەدەم
ئېيتىپ بېرىدۇ ۋە سىز «بولدى» دېمىگۈچە سايتقا يوللىمايدۇ. تۈگىگەندىن كېيىن `PROMPT-48.md` غا ئۆتۈڭ.

> **بۇ نېمە ئىش (F2 — سىز تەستىقلىغان يېڭى ئىقتىدار):** خاتىرە تىزىملىكىگە: (1) **ئىزدەش** — ماۋزۇ
> ۋە مەزمۇندىن؛ (2) ھەر خاتىرىنىڭ بىرىنچى قۇرىنى كۆرسىتىش؛ (3) **رەتلەش** (يېڭى ئۆزگەرتىلگەن /
> يېڭى قۇرۇلغان / ماۋزۇ)؛ (4) مۇھىم خاتىرىنى ئەڭ ئۈستىگە **مىقلاش**؛ (5) **ئەخلەت ساندۇقى** —
> ئۆچۈرۈلگەن خاتىرە 30 كۈنگىچە ساقلىنىدۇ، خالىسىڭىز قايتۇرالايسىز. يەنە: چېسلا توغرا (ئىستانبۇل
> ۋاقتى) كۆرۈنىدۇ؛ ھېچنېمە يېزىلمىغان بىكار «يېڭى خاتىرە» لەر ئۆزلۈكىدىن ئۆچىدۇ؛ كىتابتىكى
> خاتىرىلەر بېتىنىڭ ئىسمى «كىتابتىكى خاتىرىلىرىم» قىلىپ ئۆزگەرتىلىدۇ، «خاتىرە دەپتىرىم» بىلەن
> ئارىلىشىپ كەتمەيدۇ.
>
> **تۈگىگەندىن كېيىن سىناڭ:** بىر خاتىرىنى ئۆچۈرۈڭ → «ئەخلەت ساندۇقى» دىن قايتۇرۇڭ. ئىزدەش رامكىسىغا
> خاتىرىڭىزدىكى بىر سۆزنى يېزىڭ.

---

You are continuing an existing, live project. Read `CLAUDE.md` in this folder FIRST — it is the
project instruction and always wins — and use the **bilim-web** skill.

This is **stage 6 of 9** of the notebook plan (`PROMPT-42.md` … `PROMPT-50.md`, from
`AUDIT-2026-10-07.md`). **Do only this stage.** It adds feature **F2** (approved 2026-10-07) and
fixes N19 and N22.

## Before you start

1. `git status`, `git log --oneline -20`. Stage 5 (PROMPT-46: browser-local version history) must be
   merged and deployed. If not, **stop and tell the owner in Uyghur** that PROMPT-46 must be finished
   first. Uncommitted changes you did not make → stop and ask.
   Untracked planning files in the root (`PROMPT-*.md`, `AUDIT-*.md`, `HANDOFF-*.md` and the like)
   are the owner's and expected: leave them where they are and do not commit them.
2. Read the *Project context* files in full.

## What is wrong or missing

- **N19 (P3):** the list (`components/notes/note-list.tsx`) has no search, no preview, no sort, no
  pin. The date is `String(updated_at).slice(0, 10)` — a UTC date, so an edit between 00:00 and
  03:00 Istanbul time shows yesterday. Delete is permanent behind a native `window.confirm`.
  «يېڭى خاتىرە» creates a row on the server before anything is typed, so untouched empty notes pile
  up (and, since stage 3, count against the 200-note quota).
- **N22 (P3):** `/notes` («خاتىرە دەپتىرىم», the notebook) and `/my/notes` («خاتىرىلىرىم», notes
  written on book pages) have nearly the same name and the same `notebook-pen` icon.

## Project context

Read in full: `components/notes/note-list.tsx`, `app/notes/(index)/page.tsx`, `app/notes/[id]/*`,
`app/notes/actions.ts`, `lib/notes/data.ts`, `lib/notes/limits.ts`, `components/notes/note-editor.tsx`
and stage 2's save module (result codes), `app/my/notes/page.tsx`, `components/app-shell.tsx`,
`app/api/health/route.ts` and `lib/auth/attempts.ts` (`sweepAttempts`: the pattern for a bounded,
production-only daily sweep that logs a count only), `lib/rate-limit.ts`,
`supabase/migrations/0001_init.sql`, `0018_note_length.sql`, the quota migration from stage 3,
`0002_fix_ug_normalize.sql` (`ug_normalize`), `lib/my/account.ts` (export and deletion),
`tests/notes.spec.ts` (the `deleteNote` helper accepts a native dialog today),
`tests/unit/*-sql.test.ts` + `tests/fixtures/pglite-auth.ts`, `scripts/flood/stack.mjs` (a local
copy of the database, for measuring).

## Non-negotiable constraints (restated from `CLAUDE.md`; they win over anything here)

- **No budget, ever.** Supabase Free + Vercel Hobby; **no new cron** — the one daily slot is
  `/api/health`, and a sweep may be added to it.
- **Anonymous reading always works.** RTL Uyghur UI; code, comments and commits in English.
- **Mobile Rules are hard:** `100dvh`; safe areas; ≥ 44 px targets; nothing hover-only; no
  horizontal scroll at 360 px; every control visible and tappable after scrolling down and back
  up; `overscroll-contain`; logical properties only.
- **RLS on every table**; `note_documents` stays owner-only; new functions follow the security
  definer / `search_path = ''` / grants pattern of 0026–0028 where they need privileges, and are
  SECURITY INVOKER where RLS should apply. Every mutating Server Action re-reads the session and
  filters by `user_id`.
- **Never edit an applied migration** — next free number (expected
  `supabase/migrations/0031_note_list.sql`).
- **A note is private:** what a writer types in the notes search is never stored or logged; no
  content or titles in logs, `docs/` or commits; invented text in tests.
- **No native dialogs.** **Never load-test production**; the performance measurement runs on the
  local stack only.

## What to do

### A. Migration

1. `pinned_at timestamptz null`, `deleted_at timestamptz null` on `public.note_documents`.
2. `preview text generated always as (left(regexp_replace(content_text, '\s+', ' ', 'g'), 160)) stored`
   — the list then never downloads note bodies (same reasoning as `content_length` in 0018). If a
   function you need is not immutable, find an immutable equivalent and say which.
3. `public.search_my_notes(p_query text, p_limit int default 50)` — SECURITY INVOKER, so RLS
   applies; returns the list columns for the caller's notes that are **not** in the trash and whose
   `ug_normalize(title || E'\n' || content_text)` contains `ug_normalize(p_query)` (plain `strpos`,
   one literal phrase — same spirit as the library search, no operators); trimmed query length 2–100
   (otherwise no rows); at most 50 rows; pinned first, then newest edit.
4. `public.purge_note_trash(p_limit int)` — security definer, EXECUTE for `service_role` only;
   deletes at most `p_limit` notes whose `deleted_at` is older than 30 days; returns the count.
5. The stage-3 quota trigger keeps counting **every** row, trashed ones included — add a PGlite test
   proving it, and say so in the migration comment.

### B. Server Actions (all owner-checked; result codes as stage 2 defined)

- `pinNoteAction(id, pinned)`, `trashNoteAction(id)` (sets `deleted_at = now()`),
  `restoreNoteAction(id)`, `deleteNoteForeverAction(id)` (only rows already in the trash),
  `emptyTrashAction()`, `searchMyNotesAction(query)` (rate-limited by the signed-in user, e.g.
  60 per minute, in `lib/rate-limit.ts`), and `discardIfEmptyAction(id)` (hard-deletes only if the
  server sees the default title «يېڭى خاتىرە», empty `content_text`, and the row was never saved
  after creation — `updated_at = created_at`, since the `set_updated_at` trigger only fires on
  update).
- The old permanent `deleteNoteAction` becomes "move to trash"; update every caller.
- `saveNoteAction` refuses a trashed note (`deleted_at is null` in its update filter) with a new code
  `in_trash` → the editor shows «بۇ خاتىرە ئەخلەت ساندۇقىدا.» with «قايتۇرۇش», keeps the local
  draft, and does not retry.
- Update the stage-3 quota messages to mention the trash:
  - `quota_count`: «خاتىرە دەپتىرىڭىز تولدى: ئەڭ كۆپ 200 خاتىرە ساقلىغىلى بولىدۇ (ئەخلەت ساندۇقىدىكىلەرمۇ ھېسابلىنىدۇ). كېرەكسىز خاتىرىلەرنى ئۆچۈرۈپ، ئەخلەت ساندۇقىنى بوشاتسىڭىز، يېڭىسىنى قوشالايسىز.»
  - `quota_bytes`: «خاتىرە دەپتىرىڭىزنىڭ ھەجمى تولدى (5 MB، ئەخلەت ساندۇقى بىلەن). ئەخلەت ساندۇقىنى بوشاتسىڭىز ياكى خاتىرىلەرنى قىسقارتسىڭىز، ساقلاش داۋاملىشىدۇ. يازغانلىرىڭىز بۇ ئۈسكۈنىدە ساقلاندى.»
  (Built from the TypeScript constants, as in stage 3.)

### C. The list (`/notes`)

- Search box (`type="search"`, `autoComplete="off"`, `data-testid="notes-search"`,
  placeholder «خاتىرىلىرىمدىن ئىزدەش»): 300 ms debounce, from 2 characters; results replace the list;
  a clear button; empty state «بۇ سۆز ھېچقايسى خاتىرىدە يوق.».
- Sort (remembered in `localStorage`): «ئەڭ يېڭى ئۆزگەرتىلگەن» (default), «ئەڭ يېڭى قۇرۇلغان»,
  «ماۋزۇ بويىچە». Title order uses `Intl.Collator("ug")` on the client (the database collation does
  not know Uyghur order); fall back to code-point order where the engine lacks `ug`. Pinned notes
  always come first, under «مىقلانغانلار».
- Each row: title; the preview (two lines, clamped); **local** date and time
  (`2026-10-07 15:40`, the reader's time zone); length; a pin toggle and a delete button, both
  ≥ 44 px. The sprite has no pin icon — add one through the icon pipeline stage 4 used.
- Delete moves to the trash at once — **no confirmation** (it is reversible) — and shows
  «ئەخلەت ساندۇقىغا يۆتكەلدى.» with «قايتۇرۇش» for 10 seconds.
- A link «ئەخلەت ساندۇقى (N)» when N > 0.
- The stage-3 usage line stays.

### D. The trash

- A trash view (for example `/notes/trash`; signed-in only, `robots` noindex like the rest):
  each row shows «N كۈندىن كېيىن مەڭگۈلۈك ئۆچىدۇ», «قايتۇرۇش», «مەڭگۈلۈك ئۆچۈرۈش» (inline
  two-step confirmation, no native dialog); «ئەخلەت ساندۇقىنى بوشىتىش» (inline two-step
  confirmation). Empty: «ئەخلەت ساندۇقى بوش.»
- Opening the trash also deletes the caller's own notes that expired there (bounded).
- `/api/health` calls `purge_note_trash(500)` on the production deployment only, after its existing
  sweeps, inside its time budget, logging only the count.
- Opening a trashed note's URL shows it read-only (`contentEditable` off) with
  «بۇ خاتىرە ئەخلەت ساندۇقىدا.» and «قايتۇرۇش».

### E. Empty notes clean themselves up

When the writer leaves a note that is still untouched (default title, no text, never saved), call
`discardIfEmptyAction` (on unmount and `pagehide`, best effort). The server decides; the client
never deletes anything with text in it.

### F. Two names, two things (N22)

Rename `/my/notes`'s title and heading to «كىتابتىكى خاتىرىلىرىم» and give it a different icon from
the notebook's `notebook-pen` (for example `book-open`). Leave «خاتىرە دەپتىرىم» as it is. Change
nothing else on that page.

### G. Measure the search

On the local stack (`node scripts/flood/stack.mjs up`, never production), create a test user with
**200 notes of 60,000 characters** each and time `search_my_notes` for a word present in every note,
one in none, and a two-word phrase. Requirement: **≤ 1 s** each. Record the numbers in
`docs/notes-search.md`. If it is slower, **stop and ask** (a fallback is searching title and preview
only).

### H. Rollout

As in stage 3: finish code and tests; **do not push**; give the owner simple Uyghur steps to run the
migration in the Supabase **SQL Editor** (**New query** → paste → **Run**) and wait for his answer;
then run the full Playwright suite and push.

## Tests

- `npm run typecheck`, `npm run lint`, `npm run build`, `npm run test:unit`, full Playwright suite
  green (Chromium 375×667, 390×844, 1280×800 and the Firefox/WebKit notebook projects).
- **PGlite SQL tests:** `preview` content; `search_my_notes` finds by title and body, ignores the
  trash and other users, honours 2–100 characters and the 50-row cap, matches regardless of
  `ug_normalize` differences (hamza, tashkil); `purge_note_trash` deletes only expired trash and only
  up to the limit, and is not executable by `authenticated`; the quota counts trashed notes.
- **Unit:** sort orders (Uyghur collation with fallback); local date formatting across midnight in
  `Europe/Istanbul`; result code `in_trash`.
- **Playwright** (update the `deleteNote` helpers: move to trash, then delete forever, so test
  accounts never accumulate notes):
  1. Search finds a note by a word in its body; the empty state appears for an absent word.
  2. Pin → the note moves under «مىقلانغانلار» and stays there after reload.
  3. Delete → notice with «قايتۇرۇش» → restore; delete again → the trash shows it → restore from the
     trash → back in the list with content intact; delete forever → gone.
  4. A trashed note's URL opens read-only with the banner.
  5. Create a note and leave without typing → it is not in the list.
  6. `/my/notes` shows «كىتابتىكى خاتىرىلىرىم».
  7. No horizontal overflow at 360/375 px; search, sort, pin, delete and the trash controls visible
     and tappable after scrolling down and back up.

## Acceptance criteria

1. Search, preview, sort, pin and trash work on every engine and viewport.
2. Nothing is permanently deleted without a two-step choice in the trash; expired trash is purged
   by the existing daily run, bounded, production only.
3. The list never downloads note bodies; search never stores what was typed.
4. Dates show local time; untouched empty notes disappear; the two "notes" pages are clearly
   different.
5. `search_my_notes` ≤ 1 s on the local stack at 200 × 60,000 characters (numbers in `docs/`).
6. The migration was applied by the owner before the push.
7. typecheck, lint, build, unit, PGlite and all Playwright projects green.

Commit per logical step (`feat(db): pin, trash and preview for notes`,
`feat(notes): search, sort and pin the notebook list`, `feat(notes): a trash with 30 days to
restore`, `fix(notes): local dates and no empty leftovers`, `fix(my): name book notes
differently`). Finish with a short report **in simple Uyghur**: what changed, the search timing, and
what to try on his phone.

If anything here conflicts with `CLAUDE.md`, or you would have to trade away the writer's text,
privacy, mobile quality or the free-tier limits to finish it, **stop and ask the owner in Uyghur** —
never make that trade silently.
