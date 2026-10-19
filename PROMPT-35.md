# PROMPT 35 — كىتاب يوللاش جەريانىدا ئۈزۈلۈپ قالسا، يېرىم كىتاب ئېلان بولۇپ قالماسلىقى

## قانداق ئىشلىتىسىز (يېڭى تۈر ئېچىپ)
> **ئالدى بىلەن `PROMPT-33.md` تامام بولسۇن** — بۇ بۇيرۇقنىڭ سىناقلىرى سىناق
> ھېساباتى بىلەن كىرىدۇ.

1. Claude Code نى ئېچىپ **BilimHezinisi-website** قىسقۇچىنى تاللاڭ.
2. سىزىقتىن تۆۋەنكى تېكىستنى پۈتۈنلەي كۆچۈرۈپ چاپلاڭ.

> **بۇ نېمە ئىش:** بىر كىتابنى يەككە يوللىغاندا «ھالىتى» دا «ئېلان قىلىنغان» نى
> تاللىسىڭىز، سايت ئالدى بىلەن كىتابنى ئېلان قىلىنغان ھالەتتە قۇرىدۇ، ئاندىن بەتلەرنى
> يوللايدۇ. تور يېرىمىدا ئۈزۈلۈپ قالسا: (1) يېرىم بەتلىك كىتاب ئوقۇرمەنلەرگە كۆرۈنۈپ
> قالىدۇ؛ (2) «قايتا سىناش» نى باسسىڭىز ئىنگلىزچە خاتالىق چىقىپ، ئاخىرلاشتۇرالمايسىز؛
> (3) «بىكار قىلىش» يېرىم كىتابنى ئۆچۈرمەيدۇ. يەنە بىرى: كىتاب مۇۋەپپەقىيەتلىك
> ساقلانغاندىن كېيىنمۇ «بىكار قىلىش» كۇنۇپكىسى ئوچۇق تۇرىدۇ — بېسىپ سالسىڭىز، يېڭى
> ساقلانغان كىتاب ھېچ سوئالسىزلا ئۆچۈپ كېتىدۇ. «كۆپ كىتاب يوللاش» (batch) بۆلىكىدە بۇ
> خەتەر ئاللىبۇرۇن ھەل قىلىنغان؛ بۇ بۇيرۇق شۇ ئۇسۇلنى يەككە يوللاشقىمۇ ئىشلىتىدۇ.

---

You are continuing an existing, live project. Read `CLAUDE.md` in this folder FIRST — it is
the project instruction and always wins — and use the **bilim-web** skill.

## What this task is

The single-book upload wizard (`/admin/books/new`) can leave a half-uploaded book **published**,
cannot retry into the book it started, cannot cancel the half it left, and after a successful
save still offers a button that deletes the book without asking. The batch importer already
solved all of this; bring the wizard up to the same standard.

## Project context — what already exists, do not rebuild it

Next.js 16 + Supabase Free + Vercel Hobby, live at `https://bilimhezinisi.com`, phases 1–33
deployed.

- `components/admin/upload-wizard.tsx` — the six-step wizard; `save()`, `cancelAndRollback()`,
  `SaveStep` (with «ھازىر ساقلاش» and «قايتا سىناش»), the sticky action bar with
  «بىكار قىلىش» / «كەينىگە» / «كېيىنكى» / «تامام».
- `lib/books/save.ts` — `createBookRow`, `insertPages` (batches of `PAGE_BATCH_SIZE = 200`,
  upsert on `book_id,page_no`, throws with `failedAtIndex`), `uploadToBucket`, `setBookPaths`,
  **`countStoredPages`** and **`setBookStatus`** — the last two are what the batch importer uses:
  write as draft, verify the stored page count, only then publish. Their comment says why: "a
  dropped connection halfway through a 300-page book would publish a third of it".
- `app/admin/books/actions.ts` → `deleteBooksAction` — re-verifies staff server-side, removes
  the book's cover and original file from Storage, deletes the row (pages cascade) and
  revalidates the library caches.
- `lib/admin/messages.ts` → `MSG`, `failureMessage()` — Uyghur messages for admin failures.
- `supabase/migrations/0001_init.sql` — `books_file_hash_idx` is a **unique** index on
  `file_hash` where it is not empty; `lib/books/extract.ts` always sets `fileHash` to a SHA-256,
  so it is never empty.

## The findings — by reading the code, 2026-09-11

Not exercised against production: doing so would mean writing a half-book into the live
library.

1. **A half-book can be published.** `save()` calls `createBookRow` with `status: meta.status`
   **before** any page is written. If the admin chose «ئېلان قىلىنغان» and the connection drops
   during `insertPages`, readers get a book whose `page_count` promises pages that do not exist.
2. **Retry cannot finish.** «قايتا سىناش» is `onRetry={save}`, which calls `createBookRow`
   again. The second row carries the same `file_hash`, the unique index rejects it, and the
   admin sees `ساقلاش مەغلۇپ بولدى: duplicate key value violates unique constraint …` — raw
   Postgres, in English — with no way forward. `failedAtIndex` exists so a retry could resume;
   nothing reads it.
3. **Cancel does not clean up.** On failure `save()` runs `setSavedBookId(null)`, but
   `cancelAndRollback()` deletes only when `savedBookId !== null` — so the partial row stays,
   despite the comment promising «بىكار قىلىش» removes it.
4. **Cancel after success deletes the book.** Once saved, `savedBookId` is set, «بىكار قىلىش»
   is still enabled (it is disabled only while `busy`), and pressing it runs
   `deletePartialBook(savedBookId)` — the freshly saved book and its pages are gone, with no
   question asked. `deletePartialBook` also leaves the cover and original file in Storage and
   does not revalidate the library.

---

# What to do

1. **Always create the row as a draft**, whatever the admin chose, and keep its id in state
   (a `partialBookId`) the moment it exists.
2. **Insert pages into that row.** On failure keep `partialBookId` and `failedAtIndex`;
   «قايتا سىناش» resumes `insertPages(partialBookId, pages, onProgress, failedAtIndex)` — the
   same row, never a second one. Cover and original-file uploads resume the same way (skip what
   is already done).
3. **Verify, then publish.** When pages, cover and original are in, check
   `countStoredPages(partialBookId) === pages.length`; only then call
   `setBookStatus(partialBookId, meta.status)` (a draft stays a draft), set the success state and
   revalidate as today. A count that does not match is a failure with a Uyghur message, and the
   book stays a draft.
4. **Cancel before success** removes the partial book **through `deleteBooksAction`** — so the
   role is re-checked on the server, Storage objects are removed and the caches are dropped —
   then leaves for `/admin/books` as today.
5. **After success there is no destructive button.** The sticky bar shows «تامام» (already
   there) and no «بىكار قىلىش». Removing a saved book is what `/admin/books` is for.
6. **Uyghur errors only.** Pass every failure through `failureMessage()` (or add a named `MSG`
   entry); a raw Postgres string must never reach the screen.
7. Delete whatever becomes dead: `deletePartialBook`, if nothing calls it any more.

Duplicate detection at the extraction step, the six steps, the status choice and its default
(«قارالما (كۆرۈنمەيدۇ)»), the batch importer and every other admin page stay exactly as they are.

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
- No migration. Do not remove or bypass `requireStaff()` anywhere; the wizard's browser writes
  remain governed by RLS.
- The sticky action bar keeps its safe-area padding, its ≥ 44 px targets, and never covers
  content.
- No `git add -A` / `git add .` / `git commit -a`. One commit:
  `fix(admin): never publish half a book from the upload wizard`. **Ask the owner before
  pushing.**

---

# Tests

- `npm run typecheck && npm run lint && npm run build` — green.
- **Playwright, signed in as the test uploader, at 375×667, 390×844 and 1280×800**, with a
  fixture book of more than 200 pages (so there are at least two page batches), named with the
  batch spec's prefix so the teardown sweeps it:
  - fail the **second** `book_pages` upsert once (`page.route` on the REST call, abort once),
    choosing «ئېلان قىلىنغان»: the book row exists as **draft**, it is **not** visible
    anonymously (not on the home shelf, not in search), and a Uyghur error is shown;
  - press «قايتا سىناش»: the save completes into the **same** book id, there is exactly one row
    with that `file_hash`, the stored page count equals the extracted count, and the status is
    now `published`;
  - fail again and press «بىكار قىلىش»: the row is gone, and so is its cover in Storage if one
    was uploaded;
  - after a successful save, no enabled «بىكار قىلىش» exists; «تامام» goes to `/admin/books`
    and the book is still there;
  - no horizontal overflow at 360 px; the sticky bar never covers the save step's buttons, after
    scrolling down and back up.
- Every existing unit and Playwright suite green, `batch-import.spec.ts` above all. Known
  flaky: `keyboard.spec.ts:151`, `ai.spec.ts:148`, `ai.spec.ts:261`, `offline.spec.ts:181`,
  `reader-ai.spec.ts:534`.

---

# Acceptance criteria

1. No path through the wizard can leave a `published` book whose stored pages are fewer than its
   `page_count`.
2. A failed save can be retried to completion into the same book, with no duplicate-key error.
3. «بىكار قىلىش» before success removes the partial book and its Storage objects; after success
   it is not offered.
4. Every error the wizard shows is in Uyghur.
5. Typecheck, lint, build and all suites green; no migration, no dependency.

---

# The report

Report in **simple Uyghur**: that a book is now always saved as unpublished first and only
published after every page is confirmed; that «قايتا سىناش» continues from where it stopped;
that «بىكار قىلىش» cleans up a failed upload and no longer exists after a successful one; and
which tests prove each.

**If making the wizard safe would change what the admin sees in a way not described here —
a new step, a new confirmation, a changed default — stop and ask the owner in Uyghur first.**
