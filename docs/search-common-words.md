# The most common words (PROMPT-41)

On 2026-10-05 a whole-library search for «ئاللاھ» on `bilimhezinisi.com` ran
into the anonymous 3 s statement timeout twice in two tries, while «ناماز»
answered in 0.59 s and «پەيغەمبەر» in 1.23 s (measured live, one request at a
time, the results page's own `search-meta`). Migration
`0029_search_common_words.sql` fixes it. This page holds what was measured
before and after, so the next change can compare.

## The copy everything was measured on

No request went to production. The copy holds **exactly the live library**:

- `backups/bilim-backup-2026-09-16.ndjson.gz` — 59 books, 19,596 pages, 17
  categories and the Qur'an, the numbers PROMPT-41 gives for live;
- loaded with `COPY` into the flood stack's database
  (`node scripts/flood/stack.mjs up`: Supabase's Postgres 17.6.1.143 and
  PostgREST 14.5, every migration applied, the container held to 0.66 CPU);
- with live's planner settings (`random_page_cost 1.1`, `work_mem 2184kB`,
  `effective_cache_size 384MB`, from 0025's diagnostic) set by `ALTER SYSTEM`.

A search there takes about **half** its live time (`ناماز` 0.26–0.29 s here,
0.59 s live; `پەيغەمبەر` 0.48–0.59 s here, 1.23 s live).

To build it again:

```bash
node scripts/flood/stack.mjs up
node scripts/flood/gateway.mjs                         # another terminal
node scripts/flood/load-backup.mjs backups/bilim-backup-2026-09-16.ndjson.gz
node --env-file=.flood/local.env scripts/search-timing.mjs before
node --env-file=.flood/local.env scripts/search-parity.mjs before
# apply the next migration as postgres (docker exec … psql -U postgres < file),
# then the same two with `after`
```

`load-backup.mjs` COPYs the backup in (replica mode; `uploaded_by` cleared,
the copy has no accounts), sets live's planner settings and analyzes. It
writes only into the local container.

## How common the words are

Counted through `book_pages_fts_idx` (6 ms for «ئاللاھ»):

| Query | Pages, of 19,596 |
|---|---|
| ئاللاھ | 3,613 |
| پەيغەمبەر | 13,221 |
| ئىلىم | 1,001 |
| كىتاب | 2,596 |
| ناماز | 2,750 |
| مېۋە | 180 |
| تېخنىكا | 14 |
| ئاللاھ تائالا — pages with both words | 1,164 |
| پەيغەمبەر ئاللاھ — pages with both words | 2,396 (the phrase itself: 4) |
| ناماز ئوقۇش — pages with both words | 737 |
| ب (a single letter) | 19,566 |

## Why «ئاللاھ» timed out

Not a bitmap over every matching page, as PROMPT-41 guessed. On 2026-10-06
`EXPLAIN (ANALYZE, BUFFERS)` of the candidate statement read:

```
Limit (cost=0.29..375.03 rows=301) (actual time=219..5181 rows=301)
  -> Nested Loop (rows=7488 estimated)
       -> Seq Scan on books b                        (18 of 59 books visited)
       -> Index Scan using book_pages_pkey on book_pages p   (loops=18)
            Filter: to_tsvector('simple', <ug_normalize, inlined>) @@ '''ئاللاھ'':*'
            Rows Removed by Filter: 436 per book
Execution Time: 5181 ms
```

The planner walked the books in key order and normalized ~7,800 pages to
reach the 301st match. It thought that was cheap: it expected 7,488 matches
(there are 3,613, gathered in a few books), and `ug_normalize` is inlined into
builtins it costs at a fraction of a unit. Measured on 1,000 random pages:
`ug_normalize` **0.40 ms** a page, `to_tsvector` on the result **0.23 ms**, the
literal `position()` 0.007 ms.

On 2026-10-07, after a restart in which the copy's statistics and visibility
map were refreshed, the very same statement chose the index (cost 298 against
the walk's 375, 0.7 ms) — and «پەيغەمبەر» still chose the walk (cost 227).
**The data had not changed; the plan flipped.** Live, «ئاللاھ» was on the
walk's side. A margin that thin is the bug; 0029 removes the choice.

The reader's navigator did the same inside one book: «ئاللاھ» is on 8 of the
2,966 pages of «تەپسىر زەرىف» (book 1308), and `book_match_pages` took
**1,834 ms** to find them — the whole book, page by page (≈3.9 s live).

A phrase has a cost of its own: the index cannot check adjacency, so every page
holding all the words is opened. «پەيغەمبەر ئاللاھ» took 1,434 ms on any plan.

## What 0029 does

1. `private.matching_pages(tsquery, book_ids, limit)` returns the matching
   pages of the given books **from the GIN bitmap only**: `enable_seqscan`,
   `enable_indexscan` and `enable_nestloop` are off for its one statement, and
   the books are hash-joined, so no walk is left to choose. «ئاللاھ»'s first
   601 pages: 19 ms; all 19,566 pages of «ب»: 35 ms; all 1,219 «پەيغەمبەر»
   pages of book 1308: 95 ms (cold cache).
2. A phrase asks the index for pages holding **all** its words (`&`, exact,
   nothing to recheck — `private.ug_tsquery_all_words`), then opens at most
   **1,000** of them in index order: normalize once, literal check, a vector
   only when the literal is there, the word-start and adjacency rule on that
   vector, the rank from the same vector — stopping at the 301st match.
   (1,000, not 600: «ناماز ئوقۇش», an ordinary phrase with 254 matches in one
   category, shares more than 600 pages with its words there.)
3. When the 1,000 pages ran out first and more hold the words, the answer says
   `partial` (a new column), and when nothing turned up there, one row with no
   book carries the flags. /search then says only part of the library was
   searched and suggests a category or another word — never «nothing found»,
   never the timeout.

`book_match_pages` takes its pages from the same function; a single word's
pages are its answer as they stand, and a phrase's are checked on their own
vector in page order until `lim` carry it. It has no page bound: it answers
for one book, and its count must stay exact.

### Not built, and why

- **A lexeme-frequency table** (PROMPT-41 option a): the index already says how
  common a word is, exactly and in milliseconds; a table would need `ts_stat`
  over every page (~12 s of CPU per refresh) and triggers on every publish,
  edit and removal, for nothing the plan needs. So there are no refresh tests.
- **Precomputed first pages** (option c): not needed.
- **Costing `ug_normalize` honestly** (PL/pgSQL, `COST 10000`, tried in a
  rolled-back transaction): «ئاللاھ» 247 ms, but the navigator still walked
  («پەيغەمبەر» 979 ms) because `ORDER BY page_no LIMIT 500` made the ordered
  walk look cheaper, phrases stayed at 1.67 s, and every other query touching
  `ug_normalize` would have been re-planned.
- **`rum`**: offered by Supabase (its extension guide, read 2026-10-07). Built
  on the copy: **52 MB** against the GIN index's 31 MB, 19 s. It would let a
  phrase be checked in the index — no `partial` — but replacing the GIN index
  costs 21 MB of the permanent 500 MB, slows every upload's inserts and adds an
  extension. The owner's call; not needed for any acceptance criterion.

## Timings — `scripts/search-timing.mjs`, anonymous, median of five

| Call | Before (0028) | After (0029) | Answers |
|---|---|---|---|
| «ئاللاھ», whole library | 57014 on 10-06 (the walk); 252 ms on 10-07 | 266 ms | same |
| «ئاللاھ», ھەدىسلەر (8,150 pages) | 224 ms | 257 ms | same |
| «پەيغەمبەر», whole library | 480 ms | 271 ms | same |
| «پەيغەمبەر», three categories | 209 / 477 / 432 ms | 126 / 257 / 267 ms | same |
| «ئىلىم», whole / ھەدىسلەر | 270 / 184 ms | 270 / 191 ms | same |
| «كىتاب», whole / ھەدىسلەر | 259 / 276 ms | 273 / 267 ms | same |
| «ناماز», whole + three categories | 261 / 52 / 270 / 228 ms | 269 / 64 / 265 / 222 ms | same |
| «مېۋە», whole / ھەدىسلەر | 175 / 105 ms | 194 / 109 ms | same |
| «تېخنىكا», whole / ھەدىسلەر | 53 / 11 ms | 72 / 11 ms | same |
| «زاكات», whole + three categories | 267 / 43 / 197 / 200 ms | 275 / 24 / 199 / 207 ms | same |
| «ئاللاھ تائالا», whole / ھەدىسلەر | 423 / 430 ms | 264 / 245 ms | same |
| «پەيغەمبەر ئاللاھ», whole library | 1,434 ms | 322 ms | **partial** — 1 of 4 pages |
| «پەيغەمبەر ئاللاھ», ھەدىسلەر | 209 ms | 111 ms | same (none) |
| «نامازغا چاقىرىش ئۈچۈن», four scopes | 15–29 ms | 15–28 ms | same |
| a word found nowhere, four scopes | 11–12 ms | 12–16 ms | same |
| navigator «ئاللاھ», book 1308 | **1,834 ms** | **20 ms** | same 8 pages |
| navigator «پەيغەمبەر» | 952 ms | 234 ms | same 500 pages |
| navigator «ناماز» | 95 ms | 90 ms | same |
| navigator «ئاللاھ تائالا» | 14 ms | 19 ms | same |

39 calls after: 0 failed, 0 over budget. Live is about twice these.

## Parity — `scripts/search-parity.mjs`, anonymous, 300 rows deep

22 queries (PROMPT-41's list, ordinary words and phrases, normalization
variants, words drawn from the library) × the whole library and category 15,
each to the deepest page a reader can reach (300 rows): **41 of 44 identical**
— rows, order, ranks, snippets and flags. The three that differ are the ones
expected to:

| Query | Scope | Before → after | Why |
|---|---|---|---|
| «ئاللاھ تائالا» | whole library | capped → capped, different slice | more than 300 pages carry it; which 301 are ranked depends on how they are found (0014) |
| «ناماز ئوقۇش» | whole library | 297 rows, capped → 300 rows, capped | 0028 ranked whatever passed the literal check among its first 301 index rows (a few did not); 0029 carries on to the 301st real match |
| «پەيغەمبەر ئاللاھ» | whole library | 4 rows → 1 row, partial | the words share 2,396 pages; the first 1,000 opened hold one of the four. Before: 1.4 s here, ≈3 s live |

Every uncapped, unpartial query — including «ئىلىم» and «زاكات» in category 15
(191 and 221 pages), «ناماز ئوقۇش» there (254), «مېۋە», «تېخنىكا», «اية»,
«اسلام» and the derived words — is identical at full depth.

## Live, after 0029 (2026-10-07)

The owner applied 0029 in the SQL Editor on 2026-10-07; one anonymous RPC call
then returned the `partial` column. Single sequential searches through
`bilimhezinisi.com/search`, a pause between each, the time the page itself
reports (`search-meta`):

| Word, whole library | 2026-10-05 | After 0029 |
|---|---|---|
| ئاللاھ | timeout (3.36 s, 3.28 s) | **0.42 s** |
| پەيغەمبەر | 1.23 s | 0.71 s |
| ئىلىم | 0.72 s | 1.12 s, then 0.54, 0.66 s |
| كىتاب | 0.64 s | 0.82 s, then 0.53, 0.40 s |
| ناماز | 0.59 s | 0.62 s |

Every one with results and the «too common» notice; none with the timeout.

`node --use-system-ca --env-file=.env.local scripts/search-timing.mjs after
--runs 1` (anonymous, one call per cell, from Istanbul — each time includes
~80–240 ms of network): **0 failed, 0 over budget, of 39**. Navigator
«ئاللاھ» on book 1308: 110 ms. Compared with the local copy's `before`, no
cell answered differently except capped ones, whose slice follows the heap's
page order — different between the copy (loaded in key order) and live.

One shape to know about: a category or navigator search for a very common
word reads, once, the row of every page in the LIBRARY that holds it, to learn
which book it belongs to (the hash join in `private.matching_pages`). From
cache that is microseconds a page; cold, it is not: «پەيغەمبەر» (13,221 pages)
in the 159-page category «تەۋھىد ۋە ئەقىدە» took 1,298 ms on the first live
call, then 725 and 325 ms; the navigator «پەيغەمبەر» 795, then 441 and 440 ms.
Inside the budget. If the library grows several-fold and this shows on
/admin, the refinement is a BitmapAnd with `book_pages_pkey` for small book
sets — measured, because it reopens a walk for the planner to choose.

## The daily self-check

`/api/health` now searches «ئاللاھ» over the whole library as well as «ناماز»
(`lib/search/health.ts`, `hard`), and /admin's usage panel shows its time next
to the other's. A record written before this reads as before, without it.
