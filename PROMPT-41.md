# PROMPT 41 — «ئاللاھ» دېگەندەك ئەڭ كۆپ ئۇچرايدىغان سۆزلەرنى ئىزدىگىلى بولىدىغان قىلىش

**قانداق ئىشلىتىسىز:** بۇنى **`PROMPT-40.md` تاماملانغاندىن كېيىن** ئىشلىتىڭ. Claude Code نى
`BilimHezinisi-website` قىسقۇچىدا يېڭى تۈر قىلىپ ئېچىڭ. بۇ ھۆججەتنىڭ «---» سىزىقىدىن كېيىنكى پۈتۈن
ئىنگلىزچە قىسمىنى كۆچۈرۈپ چاپلاڭ. ئۇ سىزدىن پەقەت ئاخىرىدا تېلېفوندا سىناپ بېقىشنى سورايدۇ.

> **بۇ نېمە ئىش:** «ئاللاھ» نى «بارلىق كىتابلار» دىن ئىزدىسىڭىز، ھەر قېتىم 3 سېكۇنت كۈتكەندىن
> كېيىن «ئىزدەش بەك ئۇزۇن ۋاقىت ئالدى» دەپ چىقىدۇ — ساندان بىكار تۇرغاندىمۇ. 5-ئۆكتەبىر كەچ
> ئىككى قېتىم سىناپ ئىككىلىسىدە شۇنداق بولدى. «پەيغەمبەر» 1.2 سېكۇنت، «ناماز» 0.6 سېكۇنت ئالىدۇ.
> سىز ئىلگىرى (0014-ئۆزگەرتىش) «بىر سۆز 300 دىن ئارتۇق بەتتە بولسا، دەسلەپكى نەتىجىلەرنى كۆرسىتىپ،
> ‹بەك كۆپ بەتتە بار، يەنە بىر سۆز قوشۇڭ› دەپ ئەسكەرتىش» نى قىلدۇرغان ئىدىڭىز. ئۇ «پەيغەمبەر»،
> «ناماز»، «ئىلىم»، «كىتاب» دا ھازىرمۇ توغرا ئىشلەۋاتىدۇ. ئەمما «ئاللاھ» دا ساندان 300 نى
> سانىغۇچە 3 سېكۇنتلۇق ۋاقتى تۈگەپ كېتىدۇ — شۇڭا ئوقۇرمەن ئەسكەرتىشنىمۇ، نەتىجىنىمۇ كۆرەلمەي،
> پەقەت خاتالىق خەۋىرىنى كۆرىدۇ. «300» چېكى نەتىجە سانىنى چەكلەيدۇ، ئەمما ئىزدەش ئىشىنى
> چەكلىمەيدۇ. بۇ بۇيرۇق سىزنىڭ ئەسكەرتىشىڭىزنى ساقلاپ قالىدۇ، پەقەت «300» نىڭ ئىشنىمۇ
> چەكلىشىنى تەمىنلەيدۇ. دىنىي كۇتۇپخانىدا بۇ ئەڭ كۆپ ئىزدىلىدىغان سۆزلەرنىڭ بىرى، YouTube
> ۋىدىيوسىدىن كەلگەن يېڭى ئوقۇرمەنلەرمۇ دەل شۇنى يازىدۇ. ھەم ھەر بىر شۇنداق ئىزدەش سانداننى
> تولۇق 3 سېكۇنت ئىشلىتىدۇ — سايتتىكى ئەڭ قىممەت تەلەپ. بۇ بۇيرۇق ئۇنى تېز ۋە ئەرزان قىلىدۇ.
> ئىزدەشنىڭ نېمىنى تاپىدىغانلىقى ئۆزگەرمەيدۇ.

---

You are continuing an existing, live project. Read `CLAUDE.md` in this folder FIRST — it is
the project instruction and always wins — and use the **bilim-web** skill.

## Before you start

This task builds on `PROMPT-40.md` (search concurrency gate, `busy` failure kind, fetch timeouts,
error page). Run `git log --oneline -15` and check that PROMPT-40's work is merged and deployed. If
it is not, **stop and tell the owner in Uyghur** that PROMPT-40 must be finished first.

## What this task is

A whole-library search for the most common words in this library is either slow or impossible.
Measured on 2026-10-05 ~23:05 (Istanbul), on the live site, one request at a time with 1.5–2 s
pauses, idle database, using the time the results page itself reports (`data-testid="search-meta"`):

| Query (whole library) | Database time | Result |
|---|---|---|
| «تېخنىكا» | 0.17 s | 14 results |
| «مېۋە» | 0.48 s | 20 results |
| «ناماز» | 0.59 s | 20, `search-too-common` |
| «كىتاب» | 0.64 s | 20, `search-too-common` |
| «ئىلىم» | 0.72 s | 20, `search-too-common` |
| «پەيغەمبەر» | 1.23 s | 20, `search-too-common` |
| «ئاللاھ» | — | **`search-timeout`, twice in two tries** (3.36 s and 3.28 s wall) |

The library holds 59 books and 19,596 pages (91 MB of the 500 MB database). It will grow.

**This is a broken promise, not a missing feature.** The owner already designed for common words
in `0014_narrow_search_hint.sql`: rank at most **300** candidate pages (`limit 301` to detect
overflow), set `capped`, and show his notice on `/search` (`data-testid="search-too-common"`:
««…» بەك كۆپ بەتتە بار. تۆۋەندىكىسى دەسلەپكى نەتىجىلەر — تېخىمۇ ئېنىق تېپىش ئۈچۈن يەنە بىر سۆز
قوشۇڭ.»). 0014's own comment states the guarantee: *"300 rows ≈ 270 ms, and it stays 270 ms
however large the library grows — that bound is the point."* That was measured at 4,153 pages.
At 19,596 pages the notice still appears for «پەيغەمبەر», «ناماز», «ئىلىم» and «كىتاب», but
«پەيغەمبەر» already takes 1.23 s — 4.5× the promised bound — and «ئاللاھ» never reaches the cap
at all: the 3 s statement timeout fires first, so the reader gets neither results nor the notice.
The cap bounds how many rows are **ranked**, not how much work is done to **find** them. Make the
bound real again; keep the owner's design.

Why it matters: in a religious library «ئاللاھ» is among the first words a reader types; a YouTube
tutorial published on 2026-10-05 is bringing new readers. Each such search also spends the full
3 s anonymous statement timeout of shared database CPU — the most expensive request any anonymous
visitor can make, and the most effective one for a flood. The daily self-check
(`lib/search/health.ts`) only searches «ناماز», so it has never seen this.

## Project context

Next.js 16 + Supabase Free + Vercel Hobby, live at `https://bilimhezinisi.com`. Read before
writing anything:

- `supabase/migrations/0017_phrase_search.sql` — `ug_tsquery()`: the typed text, normalized, each
  word adjacent (`<->`) in order, **every word matched from its start** (`:*`), so «ناماز» also
  finds «نامازغا». This is product behaviour and must not change.
- `supabase/migrations/0025_search_uses_the_index.sql` — the current `search_books` (whole-library
  and category branches, the GIN expression index `book_pages_fts_idx` on
  `to_tsvector('simple', ug_normalize(content))`, `raw_candidates … limit 301`, the literal
  `position()` check, `ts_rank`, the `capped` flag) and `book_match_pages`.
- PROMPT-40's migration (the slot gate) — keep it in front of whatever you build.
- `lib/search/books.ts`, `app/search/page.tsx` (the `too-common` notice already exists),
  `lib/search/health.ts`, `components/admin/usage-panel.tsx`.
- `scripts/search-parity.mjs`, `scripts/search-timing.mjs`, `scripts/db-usage.mjs`,
  `scripts/backup.mjs` / `scripts/restore.mjs`, `scripts/migrate-from-desktop.mjs`, and
  `migration-data/library.db` (a copy of the desktop library): use these to build a **local copy
  with the real data volume** for measurement.

## Possible causes — find out which, do not assume

The `limit 301` bounds the rows returned, not necessarily the work done. Candidates, all to be
confirmed or ruled out with `EXPLAIN (ANALYZE, BUFFERS)` on the local copy, comparing «ئاللاھ»
with «ناماز» and «پەيغەمبەر»:

1. **The planner leaves the index for very common words.** `search_books` uses
   `plan_cache_mode = force_custom_plan`, so the planner sees the real word; for a word on most
   pages it may judge a scan cheaper than `book_pages_fts_idx`. 0025 documents what that path costs:
   ~0.85 ms **per page in scope** (`ug_normalize()` + `to_tsvector()` per row) — about 16–17 s
   at 19,596 pages. This is the regression class PROMPT-32/0025 fixed for other words.
2. **A plan shape that evaluates the expression on far more than 301 rows** — for example
   `book_pages` on the build side of a hash join, or anything that must consume the whole match
   set before the `LIMIT`.
3. **Bitmap cost:** a prefix query (`'ئاللاھ':*`) merging many lexemes' posting lists, and a
   bitmap that turns lossy under `work_mem = 2184 kB` (recorded in 0025), forcing rechecks that
   recompute the expression per row.

On production, a plain `EXPLAIN` (**without** `ANALYZE`) executes nothing and costs nothing — it is
the safe way to see which plan the live database picks for «ئاللاھ» versus «ناماز». Ask the owner
to run it in the SQL Editor if you need it (give him the exact statement). Never run
`EXPLAIN ANALYZE` of the heavy query against production.

## Non-negotiable constraints (restated from `CLAUDE.md`; they win over anything here)

- **No budget, ever.** Supabase Free + Vercel Hobby. No paid compute, no new vendor, no external
  search service. Do **not** raise the anonymous statement timeout.
- **Keep the owner's common-word design:** the 300-candidate cap, the `capped` flag, and his
  notice text on `/search` exactly as written. Do not change 300 without measuring and asking
  him — lowering it does not fix this, raising it makes every common word slower.
- **What search finds does not change**: one literal phrase, words adjacent and in order, each
  word matched from its start, the same normalization (`ug_normalize`), operators permanently
  removed. Ranking of ordinary queries must stay the same (prove it with parity).
- **What a reader types is never logged or stored.** No table, cache or log keyed by real queries.
  Precomputed data may be built only from **book content**, never from what readers search.
- **Anonymous reading always works.** RTL Uyghur UI; code and commits in English.
- **Mobile Rules are hard** (≥44 px, `100dvh`, safe areas, no hidden controls after scroll, no
  horizontal scroll at 360 px, logical properties).
- **RLS on every table**; new tables RLS-on and readable only through the security-definer
  functions. **Never edit an applied migration** — a new numbered file.
- **Never load-test production.** Measure on the local copy. On production, only single
  sequential checks after deploy.
- Only extensions Supabase actually offers on the Free plan; check the vendor's current list before
  proposing one (for example `rum`), and say what you checked.

## What to do

1. **Measure first.** On the local copy, time `search_books` for: «ئاللاھ», «پەيغەمبەر»,
   «ئىلىم», «كىتاب», «ناماز», «مېۋە», «تېخنىكا», a two-word phrase that is common
   (e.g. «ئاللاھ تائالا»), a word that exists nowhere, and the same set inside one category.
   Record plans and timings in `docs/` so the next change can compare.
2. **The owner's chosen design: a list of common words, built from the books.** The owner
   (2026-10-06) asked for this: words that occur on more than 300 pages are known in advance, and
   searching one of them answers **at once** with his notice instead of making the database hunt.
   Build it this way:
   - **Generated, never hand-written.** A small table (e.g. `search_common_terms`: normalized
     lexeme, page count, refreshed_at; RLS on, read only through the security-definer search
     function) computed from book content — for example `ts_stat` over the same
     `to_tsvector('simple', ug_normalize(content))` expression the index uses, published pages
     only. Refresh it where books change (publish, edit, unpublish, delete — the existing
     revalidation points) and, as a backstop, in the daily `/api/health` run (it has a 45 s
     budget; measure the refresh). A new book about fruit must be able to put «مېۋە» on the list
     without anyone editing code. Nothing readers type ever goes into it.
   - **Size of the list — tell the owner.** A count on the desktop library copy
     (`migration-data/library.db`, 21 books, cut into ~2,500-character pages = 6,184 pages, light
     normalization) found **508 distinct words on more than 300 pages**, including everyday words
     («بىر», «ۋە», «بىلەن», «دېدى», «ئۈچۈن»), Arabic hadith words («الله», «عليه», «صلى»), and
     words readers do look for («پەيغەمبەر» 5,762, «رەسۇلۇللاھ» 1,842, «ئۆمەر» 1,705,
     «ناماز» 1,035, «تائالا» 984). On the live 19,596-page library expect well over a thousand.
     Report the real number to the owner in Uyghur with the top 50.
   - **The last word matches by prefix** (`:*` in `ug_tsquery`), so the check must be on the
     prefix: the summed page count of every lexeme that starts with the typed last word. A single
     letter or two («ئا», «ب») is the most expensive query there is — treat any last word whose
     prefix count is over the threshold as common, and add a minimum length for the last word
     (measure; probably 2–3 letters) with a gentle Uyghur hint.
   - **Phrases:** a query is "common" only if **every** word in it is common (a phrase with one
     rare word is cheap through the index — verify with EXPLAIN). Otherwise it searches normally,
     behind PROMPT-40's gate.
   - **What the reader sees for a common word — do not leave him with nothing.** Show the owner's
     notice ««…» بەك كۆپ بەتتە بار …» **plus** up to 20 results from a fixed-cost path: title and
     author matches, then the first pages found in a fixed index order with a hard row limit,
     unranked, stopping as soon as 20 are found. Today «ناماز» and «پەيغەمبەر» return 20 results
     with the notice; replacing that with an empty page would be a regression. If no fixed-cost path
     stays under ~200 ms on the local copy, show the notice alone and ask the owner before shipping.
   - The check itself must cost almost nothing (one indexed lookup per word) and run **before**
     PROMPT-40's slot gate is taken.
   - Threshold: keep **300** (the same number as the cap). The ranked path for non-common words
     stays exactly as 0025 has it.
3. **Never a dead end.** If a query is still too expensive after all this, answer **at once** with
   the existing «too common» guidance (add a word or choose a category) plus whatever results the
   bounded path produced — never a 3 s wait followed by «بەك ئۇزۇن ۋاقىت ئالدى».
4. **The daily self-check must see the hard case.** Add «ئاللاھ» (or whatever your measurement shows
   to be the most common prefix) as a second fixed word in `lib/search/health.ts`, and show its time
   in the admin usage panel next to the existing one. Fixed words only; nothing readers type.
5. Check the reader's in-book navigator (`book_match_pages`) with «ئاللاھ» in the largest book. If
   it is also slow, bound it the same way; if not, say so with the number.

## Tests

- `npm run typecheck`, `npm run lint`, `npm run build`, the full unit suite and the full
  Playwright suite are green.
- **Parity:** `scripts/search-parity.mjs` (extend it if needed) shows identical results and order
  for the ordinary words above, before and after, on the local copy. Any difference for the very
  common words is listed and explained.
- **Timing:** `scripts/search-timing.mjs` on the local copy before and after, recorded in `docs/`.
- **SQL tests** for the frequency table refresh (publish, edit, unpublish, delete) and for the
  bounded path's stop condition.
- **Playwright at 375×667, 390×844 and 1280×800:** searching «ئاللاھ» across the whole library
  shows results (or the honest «too common» notice with results) with no timeout message, no
  horizontal overflow, and every control visible and tappable after scrolling down and back up.
  Mock the RPC where a real database is not available.

## Acceptance criteria

1. On production after deploy, single sequential whole-library searches for «ئاللاھ»,
   «پەيغەمبەر», «ئىلىم», «كىتاب» and «ناماز» each return results with a server-reported time
   of **≤ 1.5 s**, none shows the timeout message, and «ئاللاھ» shows the owner's
   «بەك كۆپ بەتتە بار» notice above its results. If 1.5 s cannot be reached on the Free
   plan, stop and tell the owner the best number you reached and why, before shipping.
2. Results and order for ordinary words are unchanged (parity report attached in `docs/`).
3. Search behaviour is unchanged: literal phrase, word-start matching, no operators.
4. No reader query is stored or logged anywhere; precomputed data comes only from book content.
5. The daily self-check reports the hard word's time, and the admin panel shows it.
6. typecheck, lint, build and all tests green; new tests pass at all three viewports.

Commit per logical step with English conventional messages (`perf(db): …`, `feat(search): …`,
`test(search): …`), push, and verify on `https://bilimhezinisi.com` with single ordinary requests.
Finish with a short report **in simple Uyghur** for the owner: what changed, the before/after
numbers, and what he should try on his phone.

If anything here conflicts with `CLAUDE.md`, or you would have to trade away search behaviour,
privacy, mobile quality or the free-tier limits to finish it, **stop and ask the owner in
Uyghur** — never make that trade silently.
