# PROMPT 27 — ئىزدەشتىن يوشۇرۇن قالغان كىتابنى قايتۇرۇش

## قانداق ئىشلىتىسىز (يېڭى تۈر ئېچىپ)
1. Claude Code نى ئېچىپ **BilimHezinisi-website** قىسقۇچىنى تاللاڭ.
2. سىزىقتىن تۆۋەنكى تېكىستنى پۈتۈنلەي كۆچۈرۈپ چاپلاڭ.

> **مەسىلە:** كۇتۇپخانىدىكى بىر كىتاب — № 989، «قاراخانىيلار خانلىقى ۋە قارلۇقلار»،
> ئاپتور غەيرەتجان ئوسمان — ئىزدەشتە **پۈتۈنلەي كۆرۈنمەيدۇ**. «قاراخانىيلار» دەپ
> ئىزدىسىڭىز 3 كىتاب چىقىدۇ، ئەمما ماۋزۇسىدا دەل شۇ سۆز بار بولغان بۇ كىتاب چىقمايدۇ.
> ئاپتورىنىڭ ئىسمى بىلەن ئىزدىسىڭىز بىرمۇ نەتىجە يوق.
>
> **سەۋەبى:** بۇ كىتابنىڭ ماۋزۇسى، ئاپتورى ۋە پۈتۈن تېكستى ئادەتتىكى ئۇيغۇر ھەرپلىرى
> بىلەن ئەمەس، باشقا بىر خىل ھەرپ كودى بىلەن ساقلانغان (ئەسلى Word ھۆججىتىدىن كەلگەن).
> كۆزگە ئوخشاش كۆرۈنىدۇ، ئەمما كومپيۇتېر ئۈچۈن پۈتۈنلەي باشقا ھەرپ.
>
> **دىققەت:** بۇ بۇيرۇق **جانلىق كۇتۇپخانىدىكى سانلىق مەلۇماتنى ئۆزگەرتىدۇ.** شۇڭا ئۇ
> ئالدى بىلەن زاپاس ئالىدۇ، ئاندىن سىزگە «مۇشۇ قۇرلار ئۆزگىرىدۇ» دەپ كۆرسىتىدۇ، ۋە
> **سىز ماقۇل دېگەندىلا** يازىدۇ. ماقۇل دېمىسىڭىز ھېچنېمە ئۆزگەرمەيدۇ.

---

You are continuing an existing, live project. Read `CLAUDE.md` in this folder FIRST —
it is the project instruction and always wins — and use the **bilim-web** skill.

## What this task is

One book in the live library is stored in **Arabic Presentation Forms** instead of ordinary
Uyghur Arabic letters. It is therefore invisible to search, wrong in the authors index,
and unusable when copied. Repair that book's data, and make sure a future upload can never
introduce the same fault again.

## The evidence

Measured on 2026-09-02 against the live site and the public REST endpoint (read-only):

- **Book 989**, title `ﻗﺎﺭﺍﺧﺎﻧﯩﻴﻼﺭ ﺧﺎﻧﻠﯩﻘﻰ ﯞﻩ ﻗﺎﺭﻟﯘﻗﻼﺭ`, author `ﻏﻪﻳﺮﻩﺗﺠﺎﻥ ﺋﻮﺳﻤﺎن`.
  The first character of the title is **U+FED7** (ARABIC LETTER QAF FINAL FORM), not
  U+0642 (ARABIC LETTER QAF). Also present: U+FE8E, U+FEAD, U+FBE9, U+FEF4, and **U+FEFC**
  (the LAM-ALEF ligature, one codepoint standing for two letters).
- **80.2 %** of the characters on that book's third page (513 of 640) are in the ranges
  U+FB50–U+FDFF or U+FE70–U+FEFF.
- **All 42 books were scanned**; book 989 is the only one affected.
- Searching `قاراخانىيلار` → 3 results, book 989 **absent**.
  Searching `قارلۇقلار` → 4 results, book 989 **absent**.
  Searching `غەيرەتجان ئوسمان` → **zero results**.
- `/authors` lists `ﻏﻪﻳﺮﻩﺗﺠﺎﻥ ﺋﻮﺳﻤﺎن` as a separate, broken author entry.

**Root cause.** `ug_normalize()` (migration `0002`, and its client twin
`lib/reader/normalize.ts`) folds hamza, ya, alif maqsura, ta marbuta and diacritics — it
does not fold presentation forms to their base letters, and it was never asked to. The
`.docx` this book came from carried the glyph codepoints, and the extraction pipeline
stored them verbatim.

## Project context — what already exists

Next.js 16 (App Router) + TypeScript + Tailwind on **Vercel Hobby**, Supabase Free. Live at
`https://bilimhezinisi.com`. Phases 1–25 deployed. Relevant pieces:

- `lib/books/extract.ts` — browser-side extraction (`.docx` via mammoth → turndown → Markdown, `.md`, `.html`, `.txt`); `.doc` goes through `app/api/import/doc/route.ts`, and a web URL through `app/api/import/url/route.ts`.
- `lib/books/chunk.ts` — page chunking.
- `supabase/migrations/0013_precomputed_search_vector.sql` — `book_pages.content_norm` is a **`generated always as (to_tsvector('simple', public.ug_normalize(content))) stored`** column with a GIN index on it. It recomputes automatically on update, which matters below.
- `supabase/migrations/0021_authors_and_published_at.sql` — `books.author_key` is a generated column, twinned in JavaScript by `authorKey()` in `lib/library-types.ts`.
- `scripts/backup.mjs` and `scripts/restore.mjs` — the project's own backup tooling.
- `tests/unit/sql-parity.test.ts` — holds the SQL matcher to the client matcher.

---

# The work — three parts, in this order

## Part 1 — a repair script (NOT a migration)

Write **`scripts/normalize-presentation-forms.mjs`**, run with
`node --env-file=.env.local scripts/normalize-presentation-forms.mjs`.

It must behave like this:

1. **Dry run by default.** Writing requires an explicit `--apply` flag. No flag, no write.
2. **Detect, do not guess.** A row is a candidate only when it contains characters in
   **U+FE70–U+FEFF** (Arabic Presentation Forms-B) or **U+FB50–U+FBFF** (the Arabic
   Presentation Forms-A letter range). **Deliberately exclude U+FDF0–U+FDFD** — that block
   holds the religious ligatures (ﷺ, ﷻ, ﷽) which are legitimately used in these books and
   which NFKC would expand into whole phrases. If a page contains only those, leave it
   alone.
3. Require a **share threshold** so a stray glyph in an otherwise healthy page is not a
   reason to rewrite it. Pick a threshold, state it, and print the share for every
   candidate row so the owner can see the judgement.
4. **The transform is `String.prototype.normalize("NFKC")`.** It maps every presentation
   form back to its base letter and splits U+FEFC into lam + alef, which is exactly what
   is wanted. Apply it to `books.title`, `books.author` and `book_pages.content` for the
   affected rows only.
5. **Verify each transform before writing it.** For every row, assert that the output
   contains no characters left in the two trigger ranges, and that the character count
   changed only by the ligature expansions you can account for. Refuse to write a row that
   fails the assertion, and print it.
6. **Print a report first**: which books, how many pages each, the share of affected
   characters, and a before/after sample of about 100 characters from one page per book,
   so the owner can read it in Uyghur and see that the text is the same text.
7. **Take a backup before any write** — call the project's existing `scripts/backup.mjs`
   flow, or refuse to run with `--apply` unless a backup file newer than the run exists.
   Say in the output where the backup went.
8. **Resumable and batched.** Update `book_pages` in batches; a rewritten page triggers the
   generated `content_norm` and its GIN index entry, so do not send 17,440 rows at once and
   do not hold one enormous transaction. Book 989 is small — a few hundred pages — but the
   script must be safe if it is ever pointed at more.
9. Service role only, from `.env.local`. **Never print the key. Never print a whole page of
   book text into a log or a commit.**

Then **run it in dry-run mode**, show the owner the report, and **stop and ask him in
Uyghur for permission before running `--apply`.** Do not apply it on your own judgement.

After applying, verify from the public site, not from the script:
`/search?q=قاراخانىيلار` must now return book 989, and `/search?q=غەيرەتجان ئوسمان` must
return it too. Paste both results into the report.

## Part 2 — stop it happening again, at the door

In the extraction pipeline, normalise text to **NFC** as it is extracted, before chunking:

- `lib/books/extract.ts` for `.docx`, `.md`, `.html` and `.txt`;
- `app/api/import/doc/route.ts` for legacy `.doc`;
- `app/api/import/url/route.ts` for a web URL.

Use **NFC for the general pass** (it is the safe, lossless normal form and is what stored
text should be), and additionally fold the two presentation-form ranges named above — with
the same U+FDF0–U+FDFD exclusion — so a glyph-encoded source is repaired on the way in.
Put that fold in **one exported helper** with a name that says what it does, unit-test it
directly, and call it from all three entry points. Do not copy the logic three times.

The title and author fields the admin types in the upload wizard and the book editor go
through the same helper before they are saved.

**A unit test is required**: the exact title of book 989 in, the correct Uyghur title out;
`ﷺ` in, `ﷺ` out unchanged.

## Part 3 — what NOT to do, and why

**Do not add presentation-form folding to `ug_normalize()`.** It is the obvious third fix
and it is the wrong one right now:

- `book_pages.content_norm` is `generated always … stored`. Changing `ug_normalize` forces
  Postgres to recompute it for all **17,440** rows and rebuild the GIN index — a full table
  rewrite on a free-tier project, during which the library is degraded.
- Parts 1 and 2 already cover every case that exists: the one bad book is repaired, and no
  new one can arrive.
- The only case left uncovered is a reader *typing* a presentation form into the search box,
  which does not happen with any Uyghur keyboard, including the site's own on-screen one.

If you disagree after reading `0013`, **say so in Uyghur with your measurement** — do not
just do it.

---

# Constraints that do not move

- **This changes live data.** Back up first, dry-run first, and **ask the owner before
  writing**. Never delete a book, never unpublish one, never touch a category, a user, a
  note or a bookmark.
- **No budget, ever.** Supabase Free, Vercel Hobby. No new service, no new dependency —
  `String.normalize` is in the language.
- **Anonymous reading always works** throughout; the repair must not take a book offline.
- RTL Uyghur UI; code, comments and commit messages in English.
- **No PDF, no OCR.** Accepted formats stay `.docx`, `.doc`, `.md`, `.html`, `.txt`, URL.
- **Search operators stay removed.**
- **Do not weaken the CSP. Do not touch RLS, the role checks, or `lib/ai/`.**
- **Do not touch `lib/legacy-host.ts`, `proxy.ts`, `lib/seo.ts`, `public/sw.js` or
  `lib/pwa/constants.ts`.**
- **Never edit an applied migration.** This task should need no migration at all; if you
  believe it does, a new file only, and say why first.
- Do not run `git add -A` / `git add .` / `git commit -a`. `git push` deploys to the live
  library — **ask the owner in Uyghur before pushing.**
- Do not fix anything else from `AUDIT-2026-09-02.md`. `PROMPT-26.md` owns the category
  picker; `PROMPT-28.md` owns the anonymous auth round trips.

---

# Tests

- `npm run typecheck && npm run lint && npm run build` — green.
- Every existing unit and Playwright suite green. Five are known flaky or pre-existing —
  `keyboard.spec.ts:151`, `ai.spec.ts:148`, `ai.spec.ts:261`, `offline.spec.ts:181`,
  `reader-ai.spec.ts:534`. Say so and move on if one fails.
- `tests/unit/sql-parity.test.ts` must still pass — you are not changing the matcher.
- **New unit tests** for the normalisation helper: presentation forms folded; U+FEFC split
  into lam + alef; U+FDFA (ﷺ) and the rest of U+FDF0–FDFD untouched; ordinary Uyghur text
  unchanged byte for byte; empty string and `null` handled.
- **New unit test** for the script's detector: a page that is 80 % presentation forms is a
  candidate; a page containing one ﷺ is not.
- **Playwright, at 375×667, 390×844 and 1280×800**, after the repair is applied: searching
  `قاراخانىيلار` returns book 989 among the results, and the book opens and reads correctly
  at all three viewports with no horizontal overflow at 360 px.

---

# Acceptance criteria

1. Searching `قاراخانىيلار`, `قارلۇقلار` and `غەيرەتجان ئوسمان` on the live site all
   return book 989.
2. `/authors` lists `غەيرەتجان ئوسمان` in ordinary Uyghur letters, as one author, and his
   book is under him.
3. The book's own text reads correctly and copies correctly out of the reader.
4. A `.docx` carrying presentation forms, uploaded today, is stored in ordinary letters —
   proved by a unit test, not by uploading to production.
5. `ﷺ` and the other religious ligatures are untouched everywhere.
6. A backup exists from before the write, and the owner approved the write.
7. `ug_normalize()` and `content_norm` are unchanged, or the reason for changing them is
   argued with a measurement.
8. Nothing from earlier phases regressed.

Commit as one logical change with an English conventional message. Report in **simple
Uyghur**: which rows changed, the before/after sample, the two search results proving the
book is findable, and the test results viewport by viewport.

**Before writing a single row to the live library, stop and ask the owner in Uyghur, and
show him the dry-run report.** These are his books; a repair he did not see is not a
repair he can trust.
