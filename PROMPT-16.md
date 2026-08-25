# PROMPT 16 — خاتىرە دەپتىرىنى دېتالدەك قىلىش (مەنبە قىستۇرۇش، ئايەت قىستۇرۇش) + توپلاپ كىتاب قوشۇش

## قانداق ئىشلىتىسىز (يېڭى تۈر ئېچىپ)
1. Claude Code نى ئېچىپ **BilimHezinisi-website** قىسقۇچىنى تاللاڭ، ھەمدە دېسكتوپ دېتال
   قىسقۇچىنىمۇ قوشۇپ تاللاڭ (`bilim hezinisi pc`) — پەقەت ئوقۇش ئۈچۈن پايدىلىنىش مەنبەسى.
2. سىزىقتىن تۆۋەنكى تېكىستنى پۈتۈنلەي كۆچۈرۈپ چاپلاڭ.

> **بۇ نېمە:** دېسكتوپ خاتىرە دەپتىرىنىڭ ئەڭ ئۆزگىچە ئىقتىدارى — خاتىرە يېزىۋېتىپ
> كۇتۇپخانىدىن ئىزدەپ **مەنبە قىستۇرۇش**، ۋە **قۇرئان ئايىتىنى قىستۇرۇش**. تور
> بېتىدە ئىزدەش ئىقتىدارىنىڭ ھەممىسى ئاللىبۇرۇن بار، شۇڭا بۇ ئۇنچە قىيىن ئەمەس.
> ئۇنىڭدىن باشقا: تېپىش/ئالماشتۇرۇش، خەت نۇسخىسى تاللاش، ھەم باشقۇرۇشتا بىر قېتىمدا
> كۆپ كىتاب قوشۇش.

---

You are continuing an existing, live project. Read `CLAUDE.md` in this folder FIRST —
it is the project instruction and always wins — and use the **bilim-web** skill.

## Project context (Phases 1–15 are done and deployed)
Live at `https://bilim-hezinisi-website.vercel.app` — a free public Uyghur digital
library. Next.js App Router + TypeScript + Tailwind on **Vercel Hobby**, data in
**Supabase Free**. GitHub `kelemdepter-rgb/BilimHezinisi-website`.

Already built — do not rebuild or redesign any of it: manuscript design tokens, RTL
shell, Supabase Auth with `admin`/`uploader`/`reader`, RLS on every table,
`ug_normalize()`, admin category tree + upload wizard + user roles, library home, book
detail, reader, global exact-phrase search (one shared matcher in `lib/search/`), Qur'an
module, SEO, rate limiting, the notebook at `/notes` (rich text, autosave with offline
recovery, DOCX export, Uyghur spellcheck using the CSS Custom Highlight API), the
licence/trust work from PROMPT 13, the PWA + download + share work from PROMPT 14, and
the discovery work from PROMPT 15.

**Do not reopen the spellchecker.** It is finished and its ranking, morphology and
dictionary work is the result of PROMPTs 10–12. Leave `lib/spellcheck/` alone except
where a change here genuinely requires touching it, and say so if it does.

## Non-negotiable constraints
- **No budget, ever.** Supabase Free (500 MB DB / 1 GB storage / 5 GB egress / 50,000
  MAU) + Vercel Hobby (function body limit 4.5 MB; cron minimum interval once per day
  and that slot is used). No paid service, no new vendor account.
- Anonymous browsing, reading and search must keep working with **no account**. The
  notebook itself is signed-in only, as it is today.
- RTL Uyghur UI; code, comments and commit messages in English.
- No PDF, no OCR, no new runtime third-party CDN or script. Search operators stay
  removed — typed text is one literal phrase.
- All Mobile Rules in `CLAUDE.md` apply. Do not weaken the CSP.
- Note HTML is sanitized on the server before storage and on render — anything inserted
  by the features below must survive that sanitizer. Extend the allow-list deliberately
  and narrowly if needed; never disable it.
- New migrations are NEW files in `supabase/migrations/`; never edit an applied one.

---

# PART A — Insert a source from the library into a note

Study the desktop implementation first: `src/notes.js` — «كىتاب ئامبىرىدىن ئىزدەش»,
«مەنبە قىستۇرۇش», «مەنبىلەر بۇ يەردە كۆرۈنىدۇ», and the supporting IPC handlers
`book-content-snippet` / `book-content-snippet-batch` in `main.js` (~lines 1145–1166)
and `getBookContentSnippets` in `database.js`. Match its behaviour; do not invent a
different flow.

## A1. Behaviour

- A side panel in the notebook (a drawer on a phone) with its own search box that
  searches the **published** library using the existing shared matcher — the same exact
  literal-phrase semantics as the rest of the site, with the same highlighting.
- Results show the book, the page and a snippet with the phrase highlighted.
- Two actions per result:
  - **«مەنبە قىستۇرۇش»** — inserts the passage into the note as a blockquote followed by
    a citation line (book title — author — page) and a link back to
    `/books/[id]/read?page=N`.
  - **«كىتابقا بېرىش»** — opens the reader at that occurrence in a new tab, without
    losing unsaved note content.
- Inserting must not steal the caret: the passage lands where the cursor was, and the
  editor keeps focus.
- Selecting text in the notebook and pressing the search action pre-fills the query with
  that selection, as the desktop does.

## A2. Cost and privacy discipline

- Reuse the existing search RPC. Do not add a new full-scan query, and do not re-add a
  trigram index on `book_pages` (it was removed to fit the free tier).
- Only `status = 'published'` books, so a draft can never leak into someone's note.
- Rate-limit the endpoint with `lib/rate-limit.ts`.

---

# PART B — Insert a Qur'an aya into a note

Desktop reference: `src/notes.js` — «ئايەت قىستۇرۇش», «ئايەتكە بېرىش», «تەرجىمىسى بىلەن»,
and `quran-content-snippet` in `main.js` (~line 1167).

- In the same panel, a Qur'an tab: pick a sura and aya by number, or search the Qur'an
  text with the existing Qur'an search.
- Insert options: Arabic only, translation only, or both — matching the desktop's
  «تەرجىمىسى بىلەن» behaviour and reusing `lib/quran/copy.ts` so the formatting is
  identical to the mushaf's copy action.
- The Arabic must render in the Uthmanic font already loaded for the Qur'an module, and
  must still render correctly after the note is saved, reloaded and exported to DOCX.
- Every insertion carries the sura and aya reference, and the source attribution added in
  PROMPT 13 must not be lost when a note is exported or printed.

---

# PART C — Notebook gaps the desktop has and the web does not

## C1. Find and replace

Desktop: «ھەممىنى ئالماشتۇرۇش», «ئالماشتۇرۇش», «ئالدىنقى» / «كېيىنكى» in `notes.js`.

- Find with a match counter and previous/next navigation, replace one, replace all.
- Uses the same normalization the rest of the site uses, so Uyghur text with and without
  diacritics matches consistently.
- Undo must restore the document in one step after a replace-all — a replace-all that
  cannot be undone will eventually destroy someone's work.
- On a phone it must not cover the text it is searching in.

## C2. Font family, size and line height inside the notebook

The desktop notebook lets the writer choose «خەت نۇسخىسى», «خەت چوڭلۇقى» and
«قۇر ئارىلىقى». The web notebook has colours, lists and alignment but no typography
control. Add it, offering only the fonts the site legitimately ships after PROMPT 13,
and persist the choice per user in the browser.

## C3. Format painter — decide, do not assume

The desktop has one («فورمات سۈپۈرگىسى»). Judge whether it is worth building on a
touch screen. If you conclude it is not, say so in the report with your reasoning and
skip it. Do not build a half-working version.

---

# PART D — Admin: import many books at once, each with its own details

**This is the most valuable part of this prompt for the owner. Do not treat it as a
convenience feature.**

The desktop imports a whole folder in one go («توپلاپ كىتاب قوشۇش», `showBatchImport` in
`src/index.html`, `read-folder` in `main.js` ~line 983) — but it applies **one** category
to everything and takes the title from the filename. That is not enough here. The owner
needs to select many files at once and then give **each book its own title, author,
description, category and status** before anything is written. Books that share a folder
do not share a title, and some will be `draft` while others are `published`.

## D1. Three stages on one screen

**Stage 1 — choose the files.** Multi-file selection, plus folder drop where the browser
supports it. Accepted formats stay exactly as they are: `.docx`, `.doc`, `.md`,
`.html`/`.htm`, `.txt`. **PDF is still rejected at every layer with the existing Uyghur
message** — rejected files are listed as rejected, they never silently disappear.

**Stage 2 — review and edit. This is the heart of the feature.**
A table on a wide screen, a card list on a phone, with one editable row per file:

| Field | Notes |
|---|---|
| ماۋزۇ (title) | required |
| ئاپتور (author) | |
| چۈشەندۈرۈش (description) | |
| تۈر (category) | picker, per row |
| ھالەت (status) | قارالما / ئېلان قىلىنغان, per row |
| *(read-only)* | file name, format, size, extracted page count, duplicate warning |

**Pre-fill everything you honestly can, so the admin corrects rather than types:**
- **Title** from the document's own first heading when there is one (a Markdown `#`, or
  the first `Heading 1` in a DOCX), otherwise from the filename cleaned up — extension
  stripped, underscores and dashes turned into spaces, a leading `01.` / `1 -` style
  numbering removed.
- **Author** from the DOCX core properties (`dc:creator`) when the file actually carries
  one.
- **Description** from the opening paragraph, trimmed to a sensible length.
- Every pre-filled value must be **visibly marked as a suggestion** so the admin can see
  what still needs checking. **Never invent an author or a description** — if the file
  does not contain one, leave the field empty.

**Bulk edit sits on top of per-row editing, it does not replace it.** Provide
«ھەممىسىگە قوللىنىش» for category, author and status; row checkboxes so a bulk change can
be applied to a selection rather than everything; and the ability to sort rows so similar
books can be handled together.

**Stage 3 — import**, with per-row progress and a final result for every row.

## D2. Never lose the admin's typing

Entering metadata for twenty books is real work and must survive an accident. As the
admin types, persist the batch's metadata to IndexedDB, keyed by filename plus size.
If the tab is closed or reloaded, re-selecting the same files restores everything that
was typed. Offer an explicit way to discard a saved batch. (File handles themselves
cannot be persisted — restoring the *metadata* is what matters.)

## D3. Safety rules

- Extraction stays **in the browser** — Vercel's 4.5 MB body limit and short timeouts
  make server-side parsing wrong. Process files one at a time so a large batch does not
  freeze the tab, keep the interface responsive, and show which file is being worked on.
- Insert pages in batches of ≤500 rows.
- **Never half-import a book.** Create each book as `draft`, insert all of its pages,
  verify the stored page count matches what was extracted, and only then apply the status
  the admin chose. If the tab is closed mid-run, nothing is left published in a broken
  state. Give the admin a way to find and remove any book left incomplete.
- **Duplicate detection by `file_hash` happens in stage 2, before anything is written**,
  shown as a warning naming the existing book, with a per-row choice to skip or import
  anyway.
- One file failing must never stop the others. It is reported with a readable Uyghur
  reason, and the batch can be retried for just the failed rows.
- The import button stays disabled until every row has a title and a category.
- Everything re-verifies the admin/uploader role **server-side** on every write, like the
  rest of `/admin`.

## D4. Show the cost before it is spent

Before the import starts, show the estimated database growth for the whole batch and the
remaining free-tier headroom, using the existing `lib/usage.ts`. If the batch would push
the database past a safe threshold, warn clearly in Uyghur and require an explicit
confirmation. **The 500 MB wall must be visible before it is hit, not after.**

## D5. After the import

A summary: how many imported, skipped and failed; the actual database growth against the
estimate; a link to each new book; and, if anything failed, exactly what to do about it.

---

# Tests and reporting (mandatory)

- `npm run typecheck && npm run lint && npm run build` all pass.
- Existing unit and Playwright suites stay green at **375×667, 390×844 and 1280×800**,
  including the whole spellcheck suite.
- New Playwright coverage at all three viewports:
  - search the library from inside a note, insert a source, and verify the blockquote,
    the citation and the working link survive save → reload → DOCX export;
  - insert an aya in all three modes and verify the Arabic still renders correctly after
    reload and in the exported DOCX;
  - find and replace, including one replace-all followed by a single undo that fully
    restores the document;
  - the notebook panel and the find bar never cover the editor and never trap body
    scroll on a phone, and every control is still reachable after scrolling down and up;
  - a multi-file import of at least six files where one is a PDF (rejected), one is a
    duplicate (skipped), one fails extraction, and three succeed **with three different
    titles, authors, categories and statuses** — and afterwards each book has exactly the
    metadata that was typed for it and the successful ones are readable;
  - titles, authors and descriptions pre-filled in stage 2 are marked as suggestions, and
    a file with no author leaves the author field empty rather than guessing;
  - «ھەممىسىگە قوللىنىش» applies to a checkbox selection, not blindly to every row;
  - metadata typed in stage 2 survives closing and reopening the tab;
  - no book is ever left published with zero pages, and an interrupted batch leaves
    nothing broken behind;
  - the free-tier headroom warning appears before a large batch is written.
- A unit test proving the note sanitizer preserves inserted citations and aya markup
  while still stripping scripts and event handlers.
- Final report in **simple Uyghur**: what was added, whether the format painter was built
  or deliberately skipped and why, the measured database growth of a five-book batch
  import, and a numbered list of what I must do myself.

# Acceptance criteria
- Writing a note, finding a passage in the library, and citing it correctly is a single
  smooth flow on a phone as well as on desktop — the desktop app's strongest feature now
  exists on the web.
- An aya can be inserted with its translation and still looks right after export.
- Replace-all is always undoable in one step.
- An admin can select a folder of books, give **each one its own title, author,
  description, category and status** in a single review screen, and import them all in
  one pass — seeing exactly what happened to each file and never ending up with a
  half-imported published book.
- The spellchecker is untouched and all its tests still pass.
- Nothing from Phases 1–15 regressed; PDF is still rejected everywhere; no trigram index
  was re-added; the CSP was not weakened; no paid service and no new vendor account.
- Do NOT start the AI layer — that is the final phase.

Commit per logical step with English conventional messages. **If any part of this cannot
be done without breaking the free-tier rules, the mobile rules, or the note sanitizer,
stop and explain the trade-off to me in Uyghur rather than choosing silently.**
