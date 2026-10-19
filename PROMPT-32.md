# PROMPT 32 — «بارلىق كىتابلار» دىن ئىزدىگەندە ھېچنېمە چىقماسلىق خاتالىقىنى تۈزىتىش

## قانداق ئىشلىتىسىز (يېڭى تۈر ئېچىپ)
1. Claude Code نى ئېچىپ **BilimHezinisi-website** قىسقۇچىنى تاللاڭ.
2. سىزىقتىن تۆۋەنكى تېكىستنى پۈتۈنلەي كۆچۈرۈپ چاپلاڭ.

> **بۇ نېمە ئىش:** ئىزدەش رامكىسىدا «بارلىق كىتابلار» تاللانغاندا (ھەر بەتتە ئەسلىدە شۇ
> تاللانغان بولىدۇ) ھەر قانداق سۆز «ئىزدەشتە خاتالىق كۆرۈلدى» دېگەن خەتنى چىقىرىدۇ.
> سەۋەبى ساندان (Supabase) دا: ئىزدىگەندە كىتابلارنىڭ «مۇندەرىجە كارتىسى» (ئىندېكس) نى
> ئىشلەتمەي، ھەممە كىتابنىڭ ھەممە بېتىنى (17,601 بەت) بىر-بىرلەپ ئوقۇپ چىقىۋاتىدۇ. بۇ 3
> سېكۇنتتىن ئاشىدۇ، Supabase بولسا ھېساباتسىز ئوقۇرمەننىڭ سوئالىنى 3 سېكۇنتتا توختىتىدۇ.
> كىچىك بىر تۈر تاللانسا، بەت ئاز بولغاچقا ۋاقتىدا تۈگەيدۇ — شۇڭا ئۇ ئىشلەۋاتىدۇ. چوڭ
> تۈرلەر («ھەدىسلەر»، «قۇرئان ۋە تەپسىر») دىمۇ ئاز ئۇچرايدىغان سۆزلەر خاتالىق بېرىدۇ.
> خاتىرە دەپتىرىدىكى «كۇتۇپخانىدىن نەقىل ئىزدەش» مۇ دەل مۇشۇ سەۋەبتىن ئىشلىمەيدۇ.
>
> **سىز قىلىدىغان ئىككى ئىش:** (1) Claude Code سىزگە بىر SQL بېرىدۇ — Supabase دىكى
> **SQL Editor** غا چاپلاپ **Run** نى بېسىپ، چىققان نەتىجىنى Claude Code غا قايتۇرۇپ
> چاپلايسىز. ئۇ پەقەت ئوقۇيدۇ، ھېچنېمىنى ئۆزگەرتمەيدۇ. (2) ئاندىن يېڭى `0025` migration نى
> SQL Editor دا ئىجرا قىلىسىز. Claude Code ھەر ئىككىسىنى قەدەممۇقەدەم ئېيتىپ بېرىدۇ.
> Migration ئىجرا بولۇۋاتقان بىر مىنۇت ئىچىدە كىتاب يوللىماڭ.

---

You are continuing an existing, live project. Read `CLAUDE.md` in this folder FIRST — it is
the project instruction and always wins — and use the **bilim-web** skill.

## What this task is

Searching the whole library is broken on the live site. With the search box's scope left at
«بارلىق كىتابلار» — the default on every page — every search answers «ئىزدەشتە خاتالىق
كۆرۈلدى». The same word searched inside a small category works.

The cause is in the database: `search_books` and `book_match_pages` are doing per-page work —
running `ug_normalize(content)` and `to_tsvector` on every page in scope — instead of using the
full-text index `book_pages_fts_idx`. A whole-library search is 17,601 pages, which cannot
finish inside Supabase's 3-second limit for anonymous visitors.

Your job, in order: prove which of the two possible causes it is (Part 0), fix it so that every
search path uses the index whatever the planner or the index's history (Part 1), make a failure
of this kind impossible to miss next time (Parts 2–3), and prove the fix with numbers from the
live database (Part 4).

## Project context — what already exists, do not rebuild it

Next.js 16 (App Router) + TypeScript + Tailwind on **Vercel Hobby** (`lhr1`), Supabase Free.
GitHub `kelemdepter-rgb/BilimHezinisi-website`. Live at `https://bilimhezinisi.com`. Phases
1–31 are deployed. The pieces this task touches:

- Search is one literal phrase, normalized (migrations 0017 / 0019 / 0020). Helpers
  `public.ug_normalize`, `public.ug_tsquery`, `public.ug_phrase_regex`, `public.ug_snippet`.
- `public.search_books(q, category_id, lim, off)` — current body is **0023**
  (`0023_search_category_tree.sql`, category resolved through its descendants).
- `public.book_match_pages(book_id, q, lim)` — current body is **0020**.
- `public.search_quran` — separate, its own index, healthy (a word found nowhere answers in
  83–127 ms). **Do not touch it.**
- The index: `book_pages_fts_idx` on `book_pages using gin (to_tsvector('simple',
  public.ug_normalize(content)))`, created by **0014** (which also dropped the old
  `content_norm` column).
- `lib/search/books.ts` → `runBookSearch()` — used by `app/search/page.tsx` and by
  `app/notes/source-actions.ts` → `searchLibraryForNoteAction()` (the notebook's library
  citation panel, always `categoryId: null`).
- `lib/reader/pages.ts` → `fetchBookMatchPages()`; `components/reader/reader.tsx` uses it for
  the ↑ ↓ navigator and its n/total counter.
- `components/search/category-scope.tsx` — the scope picker inside the search box (PROMPT-26).
  Its UI is correct; do not change it.
- `scripts/search-timing.mjs` — times search against the live library; writes
  `.search-timing-<label>.json`.
- `tests/unit/sql-parity.test.ts` — applies the real migration files in PGlite and holds SQL to
  the client matcher.
- `app/api/health/route.ts` — the daily keep-alive, called by the single Vercel cron in
  `vercel.json` (06:00 UTC); it writes `settings.last_health_ping`, which
  `components/admin/usage-panel.tsx` («ھەقسىز بوشلۇق ئەھۋالى») shows on `/admin`.
- `lib/server-log.ts` → `reportServerError()`.

## What was measured — 2026-09-11, live database, read-only

Method: the site's own public anon key, `POST /rest/v1/rpc/…` from a page on
bilimhezinisi.com — the same role, and the same 3-second statement timeout, that every visitor
gets. Nothing was written. Supabase's documented default role timeouts are `anon` 3 s,
`authenticated` 8 s, `service_role` 8 s (via `authenticator`), `postgres` 2 min
(https://supabase.com/docs/guides/database/postgres/timeouts).

Library at the time: 50 published books, 17,601 pages. Category 14 = 8 books / 7,545 pages,
15 = 16 / 7,642, 21 = 3 / 1,123, 402 = 2 / 551, 17 = 1 / 119, 447 = 3 / 15. Largest book:
id 1308, 2,966 pages.

| Call (anon) | Result |
|---|---|
| `search_books('ناماز', null)` | **57014 statement timeout** after 3.1–3.4 s |
| `search_books('زاكات', null)` | **57014** |
| `search_books(<word that occurs nowhere>, null)` | **57014** after 3.2 s |
| nowhere-word, category 447 (15 pages) | 104–160 ms |
| nowhere-word, category 17 (119 pages) | 194–220 ms |
| nowhere-word, category 402 (551 pages) | 531–555 ms |
| nowhere-word, category 21 (1,123 pages) | 995–1,084 ms |
| nowhere-word, category 15 (7,642 pages) | **57014** after 3.1 s |
| `'زاكات'`, category 14 | **57014** |
| `'ناماز'`, category 15 | 2,543 ms (21 rows) — under the wall only because a common word fills 301 candidates early |
| `book_match_pages(1308, nowhere-word)` | 2,655 ms |
| `book_match_pages(1308, 'ناماز')` | 2,747 ms — **250 ms from the anonymous timeout** |
| `book_match_pages(1309 [1,048 pages], nowhere)` | 1,033 ms |
| `book_match_pages(72 [623 pages], nowhere)` | 780 ms |
| page `/search?q=ناماز` | 3,256 ms, renders the error alert |
| page `/search?q=ناماز&cat=17` | 356 ms, 6 results |

**What the numbers say.** A word found nowhere should cost the same few milliseconds in any
scope: the index answers "nothing" at once — migration 0011's own comment calls this *the
tell*. Here it costs ~0.85 ms **per page in scope**, linearly, until the 3-second wall. That is
a scan that normalizes and tokenizes every page. `book_match_pages` shows the same shape inside
one book.

**It is a regression.** `.search-timing-after.json` (2026-09-02, service role, whole library)
recorded the nowhere-phrase at 104 ms and `ناماز` at 474 ms. Since then the only DDL in this
repo is 0023 and 0024, both applied by the owner by hand — so the date 0023 went live is not
known.

**Local reproduction (done during the audit).** PostgreSQL 16.13, a replica with the production
book / page / category counts, generated Uyghur-like text of the same page length, and the
migrations' own function bodies copied verbatim. With
`book_pages_fts_idx` present, 0020's and 0023's `search_books` and 0020's `book_match_pages`
all use `Bitmap Index Scan on book_pages_fts_idx`; a nowhere-word over the whole library
answers in 1–5 ms, and `random_page_cost = 1.1` does not change that. With the index
**dropped**, the same calls take 61 ms (119 pages), 233 ms (551), 461 ms (1,123), 1,244 ms (the
2,966-page book) and 7,066 ms (whole library) — the production shape exactly. So one of two
things is true in production:

- **(A) the index is missing, invalid or not ready**, and both functions fall back to per-page
  work because there is nothing else; or
- **(B) the index is fine, but production's planner chooses a per-page plan for these
  functions.** Both are `LANGUAGE sql`, so each statement is planned with its parameters
  unknown (a generic plan). The tsquery is unknown, so its selectivity is a default guess;
  `ug_normalize` is inlined into a few cheap-looking builtins, so the planner believes filtering
  a page costs almost nothing when it really costs ~0.9 ms. 0023 then added a recursive CTE and
  the catch-all join filter `(category_id is null or b.category_id = any (scope.ids))` — the
  textbook shape that makes a generic plan choose badly.

**Why nobody saw it.** `runBookSearch` keeps only `failed: Boolean(error)` and logs nothing;
`scripts/search-timing.mjs` uses the service-role key and only the whole-library path; the
parity corpus in `sql-parity.test.ts` is four pages, where any plan is fast; and the owner
applies migrations by hand after the tests have run, with nothing checking the live database
afterwards.

**Also broken by the same calls.** The notebook's library-citation search (always the whole
library). The reader's ↑ ↓ navigator after arriving from a search result: on the biggest book it
is already at 2.7 s of the 3 s allowed, and when it fails `reader.tsx` swallows the error
(`.catch(() => undefined)`), so the navigator simply never appears. And every failing search
holds a Postgres backend busy for 3 s (8 s when signed in) on a free-tier instance — a handful
of repeated searches is enough to slow the whole site.

---

# Part 0 — prove the cause before changing anything (read-only)

## 0.1 Reproduce it

Change `scripts/search-timing.mjs` as described in 3.3 **first**, then run it with the label
`before`, as anon. It must show the 57014 failures in the table above. Keep the JSON: it is the
"before" for Acceptance 1 and the parity baseline for Acceptance 2.

## 0.2 Ask the owner to run two read-only queries

Explain it to him in simple Uyghur, click by click: supabase.com → his project → left menu
**SQL Editor** → **New query** → paste → **Run** → copy the result — or take a screenshot of
it — and paste it back to you. Tell him plainly that these only read and change nothing. Supabase's SQL Editor shows the
result of the last statement, which is why the first one is a single statement.

First:

```sql
select 'postgres' as check_name, version() as result
union all
select 'index: ' || c.relname,
       format('valid=%s ready=%s size=%s def=%s', i.indisvalid, i.indisready,
              pg_size_pretty(pg_relation_size(c.oid)), pg_get_indexdef(c.oid))
from pg_index i join pg_class c on c.oid = i.indexrelid
where i.indrelid = 'public.book_pages'::regclass
union all
select 'ug_normalize',
       string_agg(format('%s volatile=%s config=%s', p.oid::regprocedure, p.provolatile,
                         coalesce(p.proconfig::text, '-')), '; ')
from pg_proc p where p.proname = 'ug_normalize'
union all
select 'search_books is 0023',
       (position('scope_tree' in pg_get_functiondef(
          'public.search_books(text,bigint,integer,integer)'::regprocedure)) > 0)::text
union all
select 'stats: ' || relname,
       format('live=%s last_analyze=%s last_autoanalyze=%s', n_live_tup, last_analyze, last_autoanalyze)
from pg_stat_user_tables where schemaname = 'public' and relname in ('book_pages', 'books')
union all
select 'setting: ' || name, setting
from pg_settings where name in ('random_page_cost', 'effective_cache_size', 'work_mem', 'plan_cache_mode');
```

(The audit ran this exact statement against the local replica; it returns eleven rows there.)

Then, as a separate run:

```sql
explain (analyze, buffers)
select p.book_id, p.page_no
from public.book_pages p
where to_tsvector('simple', public.ug_normalize(p.content)) @@ public.ug_tsquery('قققزززخخخ')
limit 301;
```

How to read the answer:

- No row names `book_pages_fts_idx`, or it says `valid=f` / `ready=f`, or its definition is not
  `USING gin (to_tsvector('simple'::regconfig, ug_normalize(content)))`, and the EXPLAIN shows a
  `Seq Scan` → **cause (A)**.
- The index is valid **and** the EXPLAIN shows `Bitmap Index Scan on book_pages_fts_idx` →
  **cause (B)**: the index works whenever the planner can see the word; the functions' generic
  plans do not use it.
- Also record the Postgres version, `search_books is 0023`, and whether `ug_normalize` has
  exactly one overload with `volatile=i`. If anything there is unexpected (two overloads, not
  immutable, a `config`), **stop and report it before writing the migration** — it would change
  the fix.

Whatever the answer, Part 1 applies: it fixes (A) and (B) both. The diagnosis decides what you
tell the owner and is the evidence for the commit message.

---

# Part 1 — the migration

New file `supabase/migrations/0025_search_uses_the_index.sql` (check the folder for the highest
number and continue from it; **never edit 0014, 0020, 0023 or any applied migration**).

## 1.1 Guarantee the index

A `do $$ … $$` block that recreates `public.book_pages_fts_idx` **only** when it is missing,
not valid, not ready, or defined on anything other than
`to_tsvector('simple', public.ug_normalize(content))` — and otherwise leaves it alone. Then
`analyze public.book_pages;`.

Say in the file what it costs: building it takes about 0.9 ms per page (the audit's local build
of 17,601 pages took 18 s), blocks **writes** to `book_pages` meanwhile but not reads. Plain
`create index` inside the block — `create index concurrently` is not allowed in a `do` block or
a transaction. If you believe `concurrently` is required, stop and ask.

## 1.2 `search_books` — planned with the real word, every time

- Same signature `(q text, category_id bigint default null, lim int default 20, off int
  default 0)` and the same `returns table (book_id bigint, title text, author text, cover_path
  text, page_no int, snippet text, rank real, capped boolean)`. `create or replace` only — the
  app and PostgREST must see no difference.
- `language plpgsql`, `stable`, `security definer`, `set search_path = ''`, **and
  `set plan_cache_mode = force_custom_plan`**. PL/pgSQL runs its statements through the plan
  cache, and `force_custom_plan` makes every call planned with the actual tsquery and scope —
  so the planner reads the index statistics for that exact word, and a whole-library search
  carries no category predicate at all. A `LANGUAGE sql` function ignores `plan_cache_mode` on
  Postgres ≤ 17, which is why the language has to change.
- Compute `public.ug_tsquery(q)` and `public.ug_normalize(q)` once, into variables.
- Resolve the category tree only when a category is given — 0023's recursive walk with its
  `path` cycle guard — into a `bigint[]`. Then run **one of two statements**: the whole-library
  statement with no category predicate, or the scoped statement with
  `b.category_id = any (v_ids)`. No `(x is null or …)` catch-all anywhere.
- Everything else identical to 0023: title hits (`32.0 + ts_rank(...)`) with their literal
  `position` check; the **301-row cap on the candidate scan** and `capped = count(*) > 300`;
  each candidate normalized **once** (`as materialized`, see 0020's comment on why); the
  literal `position(needle in norm) > 0` check; order `rank desc, book_id, page_no`;
  `limit greatest(coalesce(lim, 20), 0) offset greatest(coalesce(off, 0), 0)`; snippets from
  `public.ug_snippet(content, q, 70)` computed only for the rows returned.
- **Trap:** in PL/pgSQL the `returns table` names (`book_id`, `title`, `author`, `cover_path`,
  `page_no`, `snippet`, `rank`, `capped`) and the parameter `category_id` are variables and
  collide with column names inside the queries. Qualify every column and use
  `#variable_conflict use_column`. An "ambiguous column" error here would take search down
  harder than it is today, and it only shows at call time — the parity test must call both
  paths.
- **Do not** build SQL with `execute` / `format()` from the reader's text.

The audit prototyped this shape on the local replica: with `force_custom_plan` the planner saw
the literal word, estimated its rows from the index statistics (4,284 for `ناماز` and 496 for
`زاكات` — exactly the replica's actual counts, where the default guess for an unknown query is
88) and used the index on both the whole-library and the scoped path. Take that as
encouragement, not as proof for production — Part 4 is the proof.

## 1.3 `book_match_pages` — the same treatment

PL/pgSQL, same signature and output `(page_no int, hits int)`, `force_custom_plan`, the tsquery
and needle computed once, everything else identical to 0020 (the `lim` cap, normalizing each
candidate once, the counting expression, `order by page_no`). `book_id` is both the parameter
and a column — qualify it.

## 1.4 Grants and header

Keep `grant execute … to anon, authenticated` on both functions; nothing else changes
privileges. The file's header comment records the "before" numbers, the cause Part 0 found,
why PL/pgSQL with `force_custom_plan`, and why the index block is safe to run twice.

---

# Part 2 — a failure like this must be visible

## 2.1 `lib/search/books.ts`

On an RPC error, call `reportServerError` with the Postgres error **code** (e.g. `57014`), the
elapsed milliseconds and whether a category was set — **never the query text**. What readers
type is not inspected or logged anywhere on this site (PROMPT-29), and that holds here.
Return `failure: "timeout" | "error" | null` alongside `failed`, so a caller can tell a timeout.

## 2.2 `app/search/page.tsx`

On a timeout, show a message a reader can act on. Suggested wording — the owner may reword it:
«ئىزدەش بەك ئۇزۇن ۋاقىت ئالدى. بىر تۈرنى تاللاپ ياكى يەنە بىر سۆز قوشۇپ قايتا سىناڭ.»
Keep the existing message for other errors, and keep `role="alert"`.

## 2.3 A daily self-check, with no new cron

`/api/health` already runs once a day. After its ping, run as an **anonymous visitor** — a
plain client built from `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` with no
session, not the cookie-bound server client — three fixed calls:
`search_books('ناماز', null, 1, 0)`, `search_books(<a fixed nonsense word>, null, 1, 0)` and
`book_match_pages(<the published book with the most pages>, 'ناماز', 500)`. Abort any call
that takes longer than 10 s and count it as failed; the route must still answer the cron.

Record `{ ok, ms, code, at }` for each under the `settings` key `search_health`
(`is_public = false`), written with the admin client exactly as `last_health_ping` is. In
`components/admin/usage-panel.tsx`, under the ping line, show one line: a calm one when all
three are ok and under 1,500 ms, a clearly marked warning naming what failed and when
otherwise. Only these fixed words ever go through it.

---

# Part 3 — tests and measurement tools

## 3.1 `tests/unit/sql-parity.test.ts`

Apply 0025 as well (its extractor looks for `create or replace function public.<name>` up to
`$fn$;` — keep that shape or update the extractor), and keep **every** existing assertion.
Add: the whole-library and the scoped path both run (this is what catches a variable/column
ambiguity); a parent category finds its child's books; a `parent_id` cycle does not hang;
`capped` flips at 301 candidates; and on the same corpus the new body returns exactly the rows,
order, ranks and snippets of 0023's body (load both under different names in the test and
compare).

## 3.2 A test that fails if a search path stops using the index

A PGlite corpus of a few thousand generated pages with the index built, and a
`statement_timeout` that a per-page scan of that corpus cannot meet but an index lookup meets
easily — measure both in PGlite and choose the value with a wide margin, and write the two
measurements into the test. Assert that a nowhere-word answers in time on the whole-library
path, on a large category and in `book_match_pages`. Also assert that the index definition in
0025's guard block is the same expression the functions use, so the two cannot drift apart.

## 3.3 `scripts/search-timing.mjs`

Default to the **anon** key — what visitors get, with their 3 s timeout. `--service` keeps
today's behaviour. Matrix: `ناماز`, `پەيغەمبەر`, `زاكات`, `نامازغا چاقىرىش ئۈچۈن` and a
nowhere-word, each over the whole library and categories 17, 15 and 14; plus `book_match_pages`
on the published book with the most pages (look it up — do not hard-code 1308) for `ناماز` and
the nowhere-word. Median of 5. Print each failure with its error code, and exit non-zero if any
call fails or exceeds its budget in Acceptance 1. Also save the result rows
(`book_id, page_no, rank, capped, snippet`) so `after` can be compared with `before`.

## 3.4 Playwright — 375×667, 390×844 and 1280×800

- The header search (desktop) and the phone search panel, scope left at «بارلىق كىتابلار»,
  for `SEED_NEEDLE` → `search-result`s visible and **no** `role="alert"`.
- `/search?q=<nowhere-word>` → `search-empty`, not the alert.
- The category scope still narrows (`search-scope.spec.ts` stays green).
- The notebook's library-citation panel (`notes-sources.spec.ts`) finds the seed book for
  `SEED_NEEDLE`, signed in as the test reader.
- The reader opened from a search result on the seed book shows `match-count`.
- No horizontal overflow at 360 px, and every control still visible and tappable after scrolling
  down and back up (the existing helpers).

These run through the dev server against the owner's live Supabase, so they can only pass after
0025 is applied. Run them after the owner applies it.

## 3.5 The usual gates

`npm run typecheck && npm run lint && npm run build` — green, no disable comments. Every unit
and Playwright suite green. Known flaky or pre-existing: `keyboard.spec.ts:151`,
`ai.spec.ts:148`, `ai.spec.ts:261`, `offline.spec.ts:181`, `reader-ai.spec.ts:534` — if one of
those fails, say so and move on.

---

# Part 4 — prove it on the live database

1. Commit (see below). **Ask the owner in Uyghur before pushing** — a push deploys the live
   library.
2. The owner applies 0025 in the SQL Editor. Walk him through it click by click, and tell him
   not to upload a book for a minute while it runs. The migration and the code are independent:
   the migration alone fixes readers; the code adds the logging, the message and the
   self-check.
3. Ask him to run the Part 0.2 diagnostic again — the index must read `valid=t ready=t`.
4. `node --env-file=.env.local scripts/search-timing.mjs after` — anon, the full matrix.
5. Run the Playwright suites from 3.4.

---

# Part 5 — make `CLAUDE.md` say what is true (a separate `docs:` commit)

- **Data Model** still lists `book_pages (book_id, page_no, content, content_norm tsvector)`.
  That column was dropped in 0014; search uses the expression index `book_pages_fts_idx`. The
  stale line has already cost something: PROMPT-27's commit message repeated it as fact.
- **Search**: add the invariant — every search path must be able to use `book_pages_fts_idx`;
  `search_books` and `book_match_pages` are PL/pgSQL with `plan_cache_mode = force_custom_plan`
  for that reason (0025); after the owner applies any migration that touches search,
  `scripts/search-timing.mjs after` runs **as anon** and must pass.
- **Cost / Free-Tier Notes** says "upgrade to Pro ($25/mo) when the library grows". That
  contradicts "Free tier permanently — the owner has no budget". Replace it with the truth: no
  upgrade, ever; the usage panel on `/admin` shows the headroom.

Change nothing else in `CLAUDE.md`, and leave the Next.js agent-rules block exactly as it is.

---

# Constraints — restated, because they are not negotiable

- **No budget, ever.** Supabase Free (500 MB database / 1 GB storage / 5 GB egress / 50,000
  MAU / paused after a week idle) and Vercel Hobby (cron minimum once a day, and that one slot is
  `/api/health`; a single function region; non-commercial use). No paid service, no new vendor
  account, no new dependency — now or later.
- **Anonymous reading always works** — browsing, reading and search need no account.
- **RTL Uyghur UI.** Logical properties only (`ps-*`, `pe-*`, `ms-*`, `me-*`, `start-*`, `end-*`,
  `text-start`); never physical left/right. Code, comments and commit messages in English;
  Uyghur only in UI strings.
- **Mobile quality equals desktop quality.** The Mobile Rules in `CLAUDE.md` are hard
  requirements: `100dvh` never `100vh`, safe-area padding on fixed bars, ≥ 44 px targets, no
  hover-only affordances, no horizontal scroll at 360 px, no trapped scroll, every control
  visible and tappable after scrolling down and back up.
- **No PDF and no OCR on the web.** Accepted formats: `.docx`, `.doc`, `.md`, `.html`, `.txt`
  and a web URL.
- **Search operators stay removed.** Typed text is one literal phrase.
- **AI is bring-your-own-key and browser-only.** Do not touch `lib/ai/`.
- **The desktop repo is a read-only reference.** Never modify anything there.
- **RLS stays on every table**; `/admin` and every mutating Server Action re-verify the role
  server-side — do not touch `lib/admin/guards.ts` or any policy unless this task says so.
- **Never edit an applied migration** — always a new file in `supabase/migrations/`.
- **Do not weaken the CSP**; no third-party runtime script or CDN.
- What a search *matches* must not change — only how fast it is found. Do not touch
  `ug_normalize`, `ug_tsquery`, `ug_phrase_regex`, `ug_snippet` or `search_quran`; changing
  `ug_normalize` would rebuild the index and change every match.
- No search service and no new cron. Do not raise any role's statement timeout: it is a Supabase
  role setting, it would hide the problem, and every slow search would hold the free database
  for longer.
- Never log, store or inspect what a reader types into a search box.
- No `git add -A` / `git add .` / `git commit -a`; stage only your files. Two commits:
  `fix(search): let every search path use the full-text index` and
  `docs: record how search must use its index`. **Ask the owner in Uyghur before pushing.**

---

# Acceptance criteria

1. **Live, as anon, median of 5 from the owner's machine:** a nowhere-word ≤ 400 ms in every
   scope (whole library, 14, 15, 17); `ناماز`, `پەيغەمبەر`, `زاكات` and
   `نامازغا چاقىرىش ئۈچۈن` ≤ 1,500 ms in every scope; `book_match_pages` on the largest book
   ≤ 400 ms for the nowhere-word and ≤ 1,500 ms for `ناماز`. **Zero** 57014 anywhere.
2. **Same answers.** Wherever the old function answered (categories 17, 402, 21, and every
   call that did not time out), the rows after — `book_id, page_no, rank, capped` and the
   snippet — equal the rows before, in the same order.
3. `https://bilimhezinisi.com/search?q=ناماز` shows results with «بارلىق كىتابلار»; the header
   box and the phone panel work at all three viewports.
4. The notebook's library-citation panel finds books again.
5. A timeout shows the new message and writes one server log line with the error code and no
   query text.
6. `/admin` shows the search self-check line (after the next daily run — or prove the route and
   the panel with a test that mocks the three calls, and say which you did).
7. 0025 is new; 0014, 0020 and 0023 are byte-for-byte unchanged; both functions keep
   `security definer`, `set search_path = ''` and their grants; RLS and CSP untouched.
8. Typecheck, lint and build green; every suite green apart from the known flaky list.

---

# The report

Report in **simple Uyghur**:

- which cause Part 0 found — (A) the index was missing or broken, or (B) the database chose a
  slow way — in one plain sentence, with the diagnostic's key lines;
- a before/after table from `search-timing.mjs`;
- the owner's steps — the two SQL Editor runs and the migration — written click by click, with
  the one-minute "do not upload a book now" warning;
- one honest line on what is not changed: a very common word still costs a few hundred
  milliseconds, because the 301 matched pages are still normalized one by one — that is by
  design and far inside the limit.

**If the only way to make search fast turns out to be changing what it matches, raising a
timeout, paying for anything, or loosening the literal-phrase rule — stop and ask the owner in
Uyghur.** He would rather hear "this needs a decision" than find a faster search that answers
differently.
