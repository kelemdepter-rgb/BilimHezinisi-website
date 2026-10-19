# PROMPT 34 — «بۇ كىتابتىكى بارلىق ئورۇنلارنى كۆرۈش» كۇنۇپكىسىنىڭ ئورۇن تاپالماسلىقى

## قانداق ئىشلىتىسىز (يېڭى تۈر ئېچىپ)
> **ئالدى بىلەن `PROMPT-32.md` تامام بولسۇن** — بۇ بۇيرۇق ئۇنىڭ تېز ئىشلەيدىغان قىلغان
> ساندان فۇنكسىيەسىگە تايىنىدۇ.

1. Claude Code نى ئېچىپ **BilimHezinisi-website** قىسقۇچىنى تاللاڭ.
2. سىزىقتىن تۆۋەنكى تېكىستنى پۈتۈنلەي كۆچۈرۈپ چاپلاڭ.

> **بۇ نېمە ئىش:** ئىزدەش نەتىجىسىدە ھەر كىتابنىڭ ئاستىدا «بۇ كىتابتىكى بارلىق
> ئورۇنلارنى كۆرۈش» دېگەن كۇنۇپكا بار. نۇرغۇن كىتابلاردا سۆزلەر «ـ» (كەشىدە/سوزۇش
> بەلگىسى) بىلەن سوزۇپ يېزىلغان ياكى ھەرىكە (زەبەر، زىر...) قويۇلغان. ئىزدەش بۇلارنى
> تونۇيدۇ، لېكىن بۇ كۇنۇپكا تونۇمايدۇ. مەسىلەن بىر كىتابتا ئىزدەش 13 بەتنى تاپىدۇ، ئەمما
> دەل ئۇنىڭ ئاستىدىكى بۇ كۇنۇپكا «باشقا ئورۇن تېپىلمىدى» دەيدۇ. كۇتۇپخانىدىكى بەتلەرنىڭ
> تەڭ يېرىمىدا مۇشۇنداق يېزىق بار. يەنە بىر كىچىك خاتالىق: بىر كىتابتا 120 دىن ئارتۇق بەتتە
> ئۇچرىسا، كۆرسەتكەن سانى كەم چىقىدۇ، ئەمما «+» بەلگىسى چىقمايدۇ.

---

You are continuing an existing, live project. Read `CLAUDE.md` in this folder FIRST — it is
the project instruction and always wins — and use the **bilim-web** skill.

## What this task is

The search results page lists, under each book, a button «بۇ كىتابتىكى بارلىق ئورۇنلارنى
كۆرۈش» that expands every place the phrase occurs in that book. It misses occurrences the rest
of the site finds, and it can under-count without saying so. Make it answer exactly what the
reader's own ↑ ↓ navigator answers for the same book and the same phrase.

## Project context — what already exists, do not rebuild it

Next.js 16 + Supabase Free + Vercel Hobby, live at `https://bilimhezinisi.com`. Phases 1–32 are
deployed; PROMPT-32 made `book_match_pages` use the full-text index, so it is fast on every book.

- `lib/search/occurrences.ts` → `findOccurrences()` — THE matcher. Diacritic- and
  tatweel-insensitive, alif variants unified, whitespace collapsed, offsets mapped back to the
  original text. Every highlight on the site comes from it.
- `public.book_match_pages(book_id, q, lim)` — every page of one book that carries the phrase,
  in order, with the number of occurrences on each; held to `findOccurrences` page by page by
  `tests/unit/sql-parity.test.ts`. The reader's navigator and its n/total counter use it
  (`lib/reader/pages.ts` → `fetchBookMatchPages`).
- `app/search-actions.ts` → `listBookMatchesAction()` — the expander's server action.
- `components/search/book-results.tsx` → `BookGroupRow` — the button, the list (`EXPANDED_HITS`
  shown), the count line «بۇ كىتابتا N ئورۇندا بار» and «يەنە N ئورۇن بار».

## The findings — verified 2026-09-11

**1. The page filter is not normalization-aware.** `listBookMatchesAction` narrows pages with

```ts
.ilike("content", `%${escaped}%`)
```

— a raw substring test on the stored text — before `findOccurrences` ever runs. Every page
where the phrase is written with a tatweel (ـ), a diacritic, a different alif, or across a line
break is dropped before the matcher can see it.

Measured on the live library, read-only, with the anon key: in book 466 (119 pages, 29 of them
containing tatweel), for three words that occur there only in their stretched form,
`search_books` finds the book on **13, 11 and 3** pages, while the same `ilike` filter finds
**0, 0 and 0** — so the expander answers «باشقا ئورۇن تېپىلمىدى» directly under thirteen
results. Across the library, **8,615 of 17,601 pages contain a tatweel** (U+0640) and **9,414
contain a fatha** (U+064E) — counted with PostgREST `like` and `count=exact`. This is not an
edge case.

**2. The truncation flag ignores the page cap.** The query takes at most `MAX_PAGES = 120`
pages, but `truncated` becomes true only when `MAX_MATCHES = 200` matches are collected. A book
with more than 120 matching pages and fewer than 200 matches in them is listed short, the count
line shows the short number, and no «+» appears. (Found by reading the code; `ناماز` alone is on
208 pages of book 1308 according to `book_match_pages`.)

---

# What to do

Rebuild `listBookMatchesAction` on top of `book_match_pages`, so the expander, the navigator and
the search results can never disagree again:

1. Call `book_match_pages(bookId, term, 500)` through the request-bound server client (the
   function already refuses unpublished books). It returns the matching pages in order with
   their hit counts, normalization-aware. `total` = the sum of `hits`; `capped` = the function
   returned its full 500 pages.
2. Walk that list in page order and take only as many pages as needed to reach `MAX_MATCHES`
   (200) occurrences. Fetch just those pages' `content` with
   `.eq("book_id", …).in("page_no", […])`, in batches of at most 100 page numbers.
3. Run `findOccurrences` on each page, in page order, and build the matches exactly as today —
   same `contextAround`, same 70-character context, same plain-text parts (never markup).
4. Return `total` and `capped` alongside `matches`, and set `truncated` when
   `total > matches.length` or `capped`.
5. In `BookGroupRow`, the count line shows the **total** — «بۇ كىتابتا {total}{capped ? "+" : ""}
   ئورۇندا بار» — so it equals the reader's counter for the same phrase. «يەنە N ئورۇن بار»
   stays as it is, counted from the total.
6. Keep the defensive checks (`term` trimmed and capped at 200 characters, `bookId` a positive
   integer) and `failed: true` on any error. Delete `MAX_PAGES` and the `ilike` path entirely —
   no dead code.

Put the arithmetic in (2) and (4) in a small pure function so it can be unit-tested without a
database.

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
- No new RPC and no migration — `book_match_pages` already exists and is exactly what is needed.
  What counts as a match is decided by `findOccurrences` and nothing else.
- Never log what a reader searched for.
- No `git add -A` / `git add .` / `git commit -a`. One commit:
  `fix(search): find every place in a book the way the reader does`. **Ask the owner before
  pushing.**

---

# Tests

- `npm run typecheck && npm run lint && npm run build` — green.
- **Unit:** the pure function — pages chosen stop at 200 occurrences; `truncated` when
  `total > listed`; `truncated` when capped at 500 pages; a book with 150 matching pages of one
  hit each lists 150 and is not truncated.
- **Playwright, at 375×667, 390×844 and 1280×800:** add to the seeded test book, on a page that
  carries none of the existing needles, one word written with tatweel inside it (say
  `SEED_STRETCHED`, defined in `tests/env.ts`) — and change no count that another spec relies
  on (`SEED_NEEDLE_COUNT`, `SEED_PAGE_COUNT`). Then: searching the word's plain spelling finds
  the seed book; the expander lists that occurrence with its page chip; the expander's count
  equals the `match-count` total the reader shows after opening that result; nothing overflows
  at 360 px and the button stays tappable after scrolling down and back up.
- Every existing unit and Playwright suite green. Known flaky: `keyboard.spec.ts:151`,
  `ai.spec.ts:148`, `ai.spec.ts:261`, `offline.spec.ts:181`, `reader-ai.spec.ts:534`.

---

# Acceptance criteria

1. On the live site, for words that occur in book 466 only in their stretched form, the
   expander lists the same pages `search_books` returns for that book — not «باشقا ئورۇن
   تېپىلمىدى». Find such words the way the audit did, read-only: fetch that book's pages,
   collect the tokens that contain «ـ», strip it, and keep the ones a raw `ilike` finds on zero
   pages. Use them in the report by page count only — do not paste book text into the report.
2. For any phrase and book, the expander's count equals the reader's n/total counter.
3. A book with more occurrences than are listed shows «+» and «يەنە N ئورۇن بار».
4. `ilike` no longer appears in `app/search-actions.ts`; `MAX_PAGES` is gone.
5. No new migration, RPC or dependency; typecheck, lint, build and all suites green.

---

# The report

Report in **simple Uyghur**: what the button missed and why (the stretched and vowelled
spellings), that it now counts exactly like the ↑ ↓ counter inside the book, and the before/after
count for one of the book-466 examples from Acceptance 1.

**If the expander and the reader's counter still cannot be made to agree without changing what
a match is, stop and ask the owner in Uyghur** rather than letting one of them quietly count
differently.
