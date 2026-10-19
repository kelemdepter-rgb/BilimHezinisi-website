# PROMPT 51 — مۇندەرىجە ئۇلانمىلىرى: باسقاندا كىتابنىڭ شۇ ئورنىغا بېرىش

**قانداق ئىشلىتىسىز:** PROMPT-50 سايتقا چىقتى (تەكشۈرۈلدى: `main` = `origin/main` = `6ed5590`).
Claude Code نى `BilimHezinisi-website` قىسقۇچىدا **يېڭى تۈر** قىلىپ ئېچىڭ، «---» دىن كېيىنكى پۈتۈن
ئىنگلىزچە قىسمىنى چاپلاڭ. «Start with worktree» دېگەن كارتا چىقسا **X** نى بېسىڭ (ئىككى تۈر بىرلا
ۋاقىتتا ئىشلىمىسۇن).

ئىش ئاخىرلىشىشقا يېقىن Claude Code سىزدىن Supabase تا **كىچىك بىر SQL ھۆججىتىنى** ئىجرا قىلىشنى
سورايدۇ — ئىلگىرىكىگە ئوخشاش: **SQL Editor** → **New query** → چاپلاش → **Run**. بۇ كىتابلىرىڭىزغا
تەگمەيدۇ، پەقەت «ئوقۇيدىغان» يېڭى بىر ئىقتىدار قوشىدۇ. سىز ئىجرا قىلغۇچە سايت بۇزۇلمايدۇ.

> **بۇ نېمە ئىش:** Word دىكى مۇندەرىجە ھەر بىر بابنىڭ ماۋزۇسىدىكى **يوشۇرۇن بەلگە (bookmark)** غا
> ئۇلانغان. كىتاب يۈكلەنگەندە ئۇلانمىلار ساقلىنىپ قالغان، ئەمما يوشۇرۇن بەلگىلەر يوقالغان. يەنە
> كېلىپ كىتاب سايتتا 260 بەتكە بۆلۈنۈپ، ئاستا-ئاستا يۈكلىنىدۇ. شۇڭا مۇندەرىجە سېرىق، ئاستى سىزىقلىق
> كۆرۈنىدۇ، ئەمما ھېچ يەرگە بارمايدۇ.
>
> **ھەل قىلىش:** مۇندەرىجىدىكى بىر قۇرنى باسقاندا، سايت شۇ ئىسىمدىكى باب ماۋزۇسىنى كىتابتىن ئىزدەپ
> تاپىدۇ، شۇ بەتنى ئاچىدۇ ۋە ماۋزۇنى ئېكراننىڭ ئۈستىگە ئېلىپ كېلىدۇ. «قۇتادغۇبىلىك» تە تەكشۈردۈم:
> 88 قۇرنىڭ **88 ى** نىڭ ماۋزۇسى كىتابتا بار. ئاستى ئىزاھات `[1]` لارمۇ ئىشلەيدۇ. بارغاندىن كېيىن
> ئاستىدىكى بالداقتا **«قايتىش»** كۇنۇپكىسى چىقىدۇ — مۇندەرىجىگە قايتۇرىدۇ. **ھازىرقى كىتابلارنى
> قايتا يۈكلەشنىڭ ھاجىتى يوق.**
>
> **قىلمايدىغىنىمىز:** مۇندەرىجىدىكى Word بەت نومۇرلىرىنى (… 12) ئۆچۈرمەيمىز — ئۇلار كىتابنىڭ
> ئەسلى نەشرىدىكى بەت نومۇرى، كىتاب تېكىستىنىڭ بىر قىسمى؛ ئاپتوماتىك ئۆچۈرسەك، بەزىدە ھەقىقىي
> تېكىستنى ئۆچۈرۈپ قويۇشى مۇمكىن.
>
> **تۈگىگەندىن كېيىن سىناڭ:** تېلېفونىڭىزدا «قۇتادغۇبىلىك» نى ئېچىپ، مۇندەرىجىدىن بىر نەچچە قۇرنى
> بېسىڭ، ئاندىن «قايتىش» نى بېسىڭ.

---

You are continuing an existing, live project. Read `CLAUDE.md` in this folder FIRST — it is the
project instruction and always wins — and use the **bilim-web** skill. This is Next.js 16: before
using any Next.js API you are not certain of, read the matching guide in
`node_modules/next/dist/docs/`.

This is one self-contained task from the audit project (`PROMPT-51.md`). **Do only this.**

## The problem (reported by the owner, measured on the live site)

When a `.docx` book with a Word table of contents is uploaded, the TOC entries appear in the reader
as gold, underlined links with a pointer cursor — and clicking one goes nowhere: the address bar
gets `#QBH1` and the page does not move.

Measured read-only on `https://bilimhezinisi.com/books/3275/read` (published, 260 pages):

- 88 TOC links on pages 1–4, `href="#QBH1"` … `#QBH88`. Each sits alone in a paragraph, with the
  Word page number after it as plain text (`<p><a href="#QBH1">1. …</a> 1</p>`). Every label starts
  with an enumeration `N. `.
- No element in any of the 260 rendered pages has an `id`, so there is nothing to scroll to.
- After the TOC (from page 4 on) the book has 87 Markdown headings: 84 `h1` and 3 `h2`.
  - With the leading enumeration stripped and the text normalized, 87 of the 88 labels each equal
    exactly one heading, in TOC order.
  - In the 88th, a 15-character heading is a prefix of the 63-character label: the entry joins the
    heading and the subtitle that follows it.
  - The first target sits on page 4, the same page the TOC ends on, below its last link.
  - No label is duplicated.

## Why (confirmed in the code)

1. **The targets are lost at import.**
   - Word TOC entries are internal hyperlinks to bookmarks. mammoth 1.12 emits them as
     `<a href="#QBH1">` and emits each bookmark as an empty `<a id="QBH1"></a>`
     (`node_modules/mammoth/lib/document-to-html.js`: `bookmarkStart`, `hyperlink`).
   - turndown (`lib/books/markdown.ts`) keeps the link as `[label](#QBH1)` and drops the empty
     anchor, so the stored Markdown has links but no targets.
   - Footnotes and endnotes come out the same way: `[\[1\]](#footnote-1)` in the text, and
     `[↑](#footnote-ref-1)` at the end of each note (`noteReference`).
2. **The renderer cannot emit ids.** `renderMarkdown` (markdown-it, `html: false`) cannot emit ids,
   and must not be changed to.
3. **Most targets are not in the DOM.** The reader keeps a lazily loaded window of pages
   (`components/reader/reader.tsx`, `WINDOW_SIZE = 8`), so even a real id would usually be on a page
   that has not loaded.

## The decision (made in the audit — do not reopen)

**Resolve internal links in the reader, at click time, from the text that is already stored.** This
fixes every existing book without a re-upload, and fixes new uploads the same way.

- **Do not change** the import pipeline, the Markdown format, `book_pages.content`, `file_hash`,
  chunking or search. No backfill, and no write to any book.
- **Do not add**:
  - markers in the content;
  - ids in markdown-it output;
  - a stored anchor table.

  Rejected because every consumer of the text would have to learn to strip markers (search,
  export, AI context, quote cards, notebook citations), or every upload and delete path would have
  to maintain a table. The measured book does not need either.
- **Do not hide or rewrite the Word page numbers printed in the TOC.** They are the print edition's
  page numbers and part of the book's text. A heuristic that hides "a number after a link" could
  hide real text. The owner has been told.

## Before you start

1. **Check the repository state.**
   - Run `git status`, `git log --oneline -10` and `git fetch`.
   - Expect `main` == `origin/main` at `6ed5590` or later, and a clean tree apart from the owner's
     untracked planning files in the root (`PROMPT-*.md`, `AUDIT-*.md`, `PROJECT-INSTRUCTIONS.md`
     and the like).
   - If HEAD is detached, `main` is ahead of or behind `origin/main`, or there are uncommitted
     changes you did not make → **stop and tell the owner in Uyghur**.
2. **Make sure no other Claude Code session or Playwright run is active on this machine.** They
   share ports :3000/:3300 and the `bh-e2e-` test accounts, and delete each other's data. If one is
   active, stop and ask.
3. **Find the next migration number.** The highest file in `supabase/migrations/` should be
   `0031_note_list.sql`; yours is the next number.

## Project context — read in full first

- **Import and rendering (understand only — no changes):**
  - `lib/books/extract.ts`
  - `lib/books/markdown.ts`
  - `lib/books/chunk.ts`
  - `lib/books/render-markdown.ts`
  - `lib/books/strip-markdown.ts`
- **The reader:**
  - `components/reader/reader.tsx`: `goToPage`, `goToOccurrence`, the restore effect,
    `loadAround`/`maybeFetchMore`, the sticky header and the bottom bar.
  - `components/reader/markdown-content.tsx`
- **Reader and search libraries:**
  - `lib/reader/pages.ts` (`fetchPages`, `fetchBookMatchPages`)
  - `lib/reader/normalize.ts` (`ug_normalize_client`)
  - `lib/reader/matches.ts`
  - `lib/search/busy.ts`
- **Styles:** `app/globals.css` (`.md-body a`, `.match-flash`).
- **Migrations:**
  - `supabase/migrations/0001_init.sql`: the `book_pages_select_published_or_staff` policy.
  - `0009_cap_anonymous_reads.sql`: **`pgrst.db_max_rows = 1000` for `anon`**. A set-returning
    function would be truncated at 1,000 rows for anonymous readers.
  - `0017_phrase_search.sql` and `0028_search_concurrency_gate.sql`.
- **Tests and fixtures:**
  - `tests/unit/note-list-sql.test.ts` and `tests/unit/sql-parity.test.ts` (the PGlite patterns)
  - `tests/reader.spec.ts`
  - `tests/auth.setup.ts` and `tests/auth.teardown.ts` (seeding and sweeping)
  - `tests/fixtures/books.ts`
  - `tests/fixtures/docx.ts`
  - `playwright.config.ts`
- **mammoth:** `node_modules/mammoth/lib/document-to-html.js` (`bookmarkStart`, `hyperlink`,
  `noteReference`).

## Non-negotiable constraints (restated from `CLAUDE.md`; they win over anything here)

- **Production safety.**
  - **Never write to production data.** That means no book, page, category or account change
    outside the existing e2e seeding and teardown.
  - The production checks in step E are **read-only**.
  - **Never** put a book's text into a report, a log, a commit or a test fixture. Fixtures use
    invented text, and reports use ids and counts only.
- **No budget, ever.**
  - Supabase Free and Vercel Hobby; no new vendor and no new runtime dependency.
  - The resolver is lazy-loaded on first use: the reader page's first-load JavaScript must not grow
    by more than **2 KB** (compare `next build` before and after; put both numbers in the report).
  - The new database function returns compact data (target well under 30 KB for a 260-page book),
    and is called at most once per reader visit.
- **Anonymous reading always works.** RTL Uyghur UI. Code, comments and commits in English.
- **The Mobile Rules are hard.**
  - `100dvh`; safe areas; touch targets ≥ 44 px; nothing hover-only.
  - No horizontal scroll at 360 px.
  - Every control stays visible and tappable after scrolling down and back up.
  - Fixed and sticky bars never cover text.
  - Logical properties only.
- **Migrations and security.**
  - Never edit an applied migration.
  - RLS stays in charge: the new function is `security invoker`.
  - Do not weaken the CSP.
- **No native dialogs.** No `alert`, `confirm` or `prompt`.

## What to do

### A. Measure first (read-only, informational)

Run **one** read-only query with the public anon key over PostgREST to find published books whose
pages contain an internal link:

- Use `book_pages?select=book_id&content=like.*](#*`, URL-encoded.
- Run it once. If it takes longer than 30 s or errors, skip it and say so — it only informs the
  report.
- Record the distinct book ids and, per book, the fragment families: `_Toc…`, `footnote-`,
  `endnote-`, and custom names such as `QBH…`.
- Keep the ids for step E. Record ids and counts only, never text.

### B. Migration `0032_book_outline.sql` — one read-only function

Create `public.book_outline(p_book_id bigint) returns jsonb`. It returns **one jsonb value**, not a
set of rows, because `anon`'s `db_max_rows = 1000` (0009) would silently truncate a row set.

**Contents.** The value holds, in document order (`page_no`, then position in the page), compact
entries of three kinds:

- **ATX headings.** Lines matching `^ {0,3}#{1,6}[ \t]+…`, with the level and the raw heading text
  capped at 300 characters. turndown writes only ATX headings; confirm there are no setext headings
  in imported books.
- **Inline links whose destination starts with `#`.** Include the raw label (it may contain
  escaped brackets such as `\[1\]`; cap it at 300 characters) and the fragment without `#` (cap it
  at 200 characters).
- **Fence lines.** Lines that open or close a ``` or ~~~ code block, so the client ignores headings
  and links inside code.

**Cap.** At most 5,000 entries; set `"capped": true` when the cap was hit.

**Function attributes.**

- `language sql stable security invoker set search_path = ''`.
- RLS on `book_pages` decides visibility: anon sees published books only, and staff also see
  drafts.
- `revoke all … from public`; `grant execute … to anon, authenticated`.

**Comment block.** Explain why no search slot (0028) is needed: the function reads one book's pages
by primary key, and anyone can already read the same pages through REST.

**TS twin.** Add `outlineFromPages(pages)` in `lib/reader/`. It produces the same value from page
strings. It is used by the offline path, the e2e stub and the DOCX pipeline test.

**PGlite tests.** Copy the existing patterns. Prove:

- The file runs exactly as it will be pasted into the SQL Editor.
- The output is correct, and **identical to the TS twin's** output, for fixtures covering:
  - footnotes and endnotes;
  - escaped brackets;
  - a heading inside a fenced block;
  - a heading on the same page after the last TOC link;
  - Uyghur text with diacritics;
  - a label broken by a line break, which must not break anything;
  - the cap.
- The anon role gets nothing for a draft book and everything for a published one.
- The function's attributes and grants are exactly as specified.

### C. The resolver — a pure module, dynamically imported

Create `lib/reader/internal-links.ts` (the name is yours to choose).

**Input:** the outline, plus the clicked link's fragment, DOM label and page as a fallback.

**Output:** a target or `null`. A target carries the page, the kind (`heading` | `note`), and
whatever the reader needs to find the element **by text** — never by index alone.

**Normalization** (labels and headings alike):

- Run `stripMarkdown` and unescape backslash escapes.
- Apply `ug_normalize_client`.
- Drop zero-width and bidi marks and tatweel.
- Collapse whitespace and trim punctuation at both ends.

From **labels only**, also strip:

- a leading enumeration: ASCII, Arabic-Indic `٠–٩` or Extended Arabic-Indic `۰–۹` digits, then
  optionally `.` `-` `)` `:` and a space;
- a trailing page reference: a tab, dot leaders (`…`, `....`) or spaces, then digits. Word
  sometimes puts the number inside the link: `Title\t12`.

**Resolution order** for a fragment:

1. **Notes.** mammoth names notes `footnote-N` ↔ `footnote-ref-N` and `endnote-N` ↔
   `endnote-ref-N`. The target is the place of the link that carries the reciprocal fragment.
2. **Slug.** A heading whose GitHub-style slug equals the fragment. This covers `.md` and `.html`
   imports that link `#some-heading`.
3. **Text alignment over headings** (headings outside fences only). It is computed once for the
   whole book, with fragments taken in the order of their first link.
   - **Tier 1:** the normalized label equals the normalized heading.
   - **Tier 2:** they are equal once the enumeration is stripped from either side.
   - **Tier 3:** one is a prefix of the other at a word boundary, and the shorter is at least 8
     normalized characters long.
   - **Forward pass:** candidates come after the link's own position and after the previous tier-1
     or tier-2 target. This monotonic cursor maps duplicate chapter titles in order. Tier 3 is used
     only when tiers 1–2 find nothing, and a tier-3 match does not move the cursor.
   - **Second pass:** for fragments still unresolved, repeat from the beginning of the book with a
     fresh cursor. This covers a TOC printed at the **end** of the book, as many Uyghur books do,
     and back-references.
   - Every link with the same fragment shares that fragment's target.
4. **Unresolved:** return `null`, and the reader falls back to phrase search (D.4).

**Unit tests — write them first:**

- the measured shape: enumerated labels, the page number outside the label, the first target on the
  TOC's last page, one prefix entry;
- the page number inside the label: `\t12`, `..... 12`, and Arabic-Indic digits;
- `1\.` escapes in headings;
- duplicated chapter titles;
- a TOC at the end of the book;
- a back-reference;
- slug fragments;
- footnotes and endnotes in both directions;
- a heading inside a fence is ignored;
- diacritics, alif variants and zero-width marks;
- an unresolvable fragment returns `null`;
- a capped outline still resolves what it holds;
- 2,000 headings plus 2,000 links resolve in under 50 ms in Node.

**DOCX pipeline test (new uploads).**

- Build a `.docx` with a real Word-style TOC: `w:hyperlink w:anchor` entries with page numbers, and
  `w:bookmarkStart` on heading paragraphs. Add a footnote, and use invented Uyghur text.
- Run it through `extractFromFile` (which calls the internal `extractDocx`) → `chunkIntoPages` →
  `outlineFromPages` → the resolver.
- Every entry must resolve to its heading's page.

### D. The reader

1. **Intercept internal links.**
   - Add one delegated click listener on the reader content (`data-testid="reader-content"`) for
     `a[href^="#"]` inside `.md-body`. Use `closest`: the label can contain `<mark>` from
     `highlightHtml`.
   - For a primary-button click without modifier keys: `preventDefault`, and **never** change
     `location.hash` or push history.
   - Enter on a focused link arrives as the same click.
   - All other links behave exactly as today.
2. **Load lazily.**
   - On the first `pointerdown`/`focusin` on an internal link (to hide latency) or on its first
     click, dynamically import the resolver and call `book_outline` **once** per reader mount. Keep
     the result in memory.
   - While resolving, show the existing «يۈكلىنىۋاتىدۇ…» state and ignore repeat clicks.
3. **Arrive in one settled movement.**
   - When the target page is outside the DOM, load its window. Refactor `goToPage` so it can take a
     final element, and reuse its window logic.
   - Place a **heading** with its top just below the sticky header's **measured** bottom edge (do
     not hard-code 80 px). **Center** a note.
   - On the target page, pick the heading by normalized text (the k-th of equal ones).
   - Flash it with `.match-flash`; reduced motion must be respected.
   - Give the heading `tabindex="-1"` and call `focus({ preventScroll: true })` so screen readers
     announce it.
   - The position must survive the lazy loading that follows (`loadAround("before")` inserting
     pages above), with no visible double jump.
4. **Fallbacks, in this order. Each message is non-blocking, shown in the reader's existing
   status/error area, and the reader does not move:**
   - **`book_outline` missing or failed** (PostgREST 404 / `PGRST202` — the migration not applied
     yet): remember that for this mount and use phrase search.
   - **The resolver returns `null`:** run phrase search.
     - Call `fetchBookMatchPages(bookId, label)` with the label minus enumeration and page
       reference.
     - Take the first occurrence after the link, or else the first in the book.
     - Jump the way `goToOccurrence` does.
   - **Search busy** (0028): show `SEARCH_BUSY_TEXT`.
   - **Offline:** first try `outlineFromPages` over the pages already loaded. If that fails, show
     «تور ئۈزۈلدى — بۇ ئورۇنغا ھازىر بارغىلى بولمايدۇ.»
   - **Nothing found:** show «بۇ ئۇلانما كۆرسەتكەن ئورۇن كىتابتىن تېپىلمىدى.»
5. **The «قايتىش» button.**
   - After a successful jump, it appears at the start of the existing bottom bar.
     - `aria-label="ئۇلانمىنى باسقان ئورۇنغا قايتىش"`.
     - Use an icon from the existing SVG sprite; if a new symbol is needed, draw it in the same
       style.
     - On narrow screens the visible text may collapse to the icon, so the bar keeps its height.
   - Tapping it brings the clicked link back, reloading its page if needed: centered, flashed. Then
     the button disappears.
   - A new jump replaces the return point (one level only).
   - It is hidden in print.
   - If the bar can still grow taller, the content's bottom padding grows with it, so the bar
     **never** covers the last line.
6. **Nothing else changes.** Plain-text books, the server render, `?page=` and `?q=&m=` links,
   sharing, the saved position and the find bar all work exactly as today.

### E. Push, then verify on production (read-only)

1. Commit and push; the fallback keeps the site correct before the migration exists. Wait until
   Vercel has deployed it to `https://bilimhezinisi.com`.
2. Give the owner, **in simple Uyghur**, the exact steps to apply `0032_book_outline.sql`:
   - which file to open, and that he copies the whole file;
   - **SQL Editor** → **New query** → paste → **Run**;
   - what success looks like.

   Then wait for him.
3. Run a read-only check. It does not have to be committed.
   - Call `book_outline` for book 3275 with the anon key and run the resolver: expect **88/88
     resolved, in TOC order**.
   - Repeat for the books found in A: at most 100, sequential, at least 200 ms apart.
   - Report resolved/unresolved counts per book id only.
4. Open book 3275 in a real browser at 375×667 and 1280×800 without signing in. Click TOC entries 1,
   44 and 88, then use «قايتىش». Confirm each landing visually.

### F. Planning files on GitHub

The owner wants his planning files in the repository.

1. **What to commit.** After the feature commits, commit the untracked planning files in the root
   in **one separate commit**: `docs: add audit and prompt history`. That means `PROMPT-*.md`
   (including this one), `AUDIT-*.md`, `PROJECT-INSTRUCTIONS.md`, and any `HANDOFF-*.md` or
   `TEQQASLASH.md` that is untracked.
2. **Scan for secrets first.** Look for keys, JWTs (`eyJ…`), `sk-`, `AIza`, service-role
   references, passwords and similar. Leave out any file that matches, and tell the owner which one.
3. **If the repository is public** (`gh repo view --json visibility`, or ask the owner): also leave
   out any file that contains an e-mail address.
4. **Never commit** `.claude/`, `.env*`, `migration-data/` or `test-results/`.

## Tests

- **The full gate:** `npm run typecheck`, `npm run lint`, `npm run build`, `npm run test:unit` and
  the full Playwright suite must be green.
- **Unit and PGlite:** everything listed in B and C.
- **Playwright: a new `tests/reader-links.spec.ts`** on the three Chromium viewports (**375×667,
  390×844, 1280×800**) and on `webkit-mobile-390x844`.
  - **Test book.** Seed one more test book through the existing setup and teardown, with a prefixed
    title and hash so `removePrefixedBooks` sweeps it even after a failed run.
    - Seed it as a **draft** and read it with the existing staff test session, so it can never
      appear on the public site. If the harness makes that impractical, stop and ask.
    - Use invented text only, and at least 30 pages.
    - The book contains:
      - a TOC on its first pages, with enumerated labels and Word page numbers after the links;
      - chapters as headings, one on the TOC's last page and one far outside the initial window;
      - a duplicated chapter title;
      - footnotes with back-links;
      - one link whose target exists only as body text, to exercise the phrase fallback;
      - one link that resolves to nothing.
  - **Stub `book_outline`** with `page.route`, answering from the TS twin over the seeded pages, so
    the spec does not depend on the migration. Add one case that answers 404, to exercise the
    fallback.
  - **Assert:**
    - After each click, the target heading is visible, with its top below the sticky header's
      bottom and above the bottom bar.
    - The page indicator shows the target page.
    - `location.hash` is empty and `history.length` is unchanged.
    - After the network settles plus 1 s, the target is still in place.
    - «قايتىش» brings the clicked entry back into view.
    - A footnote can be followed there and back.
    - For an unresolved link, the message is visible and the scroll position is unchanged.
    - At 360 px with the return button shown there is no horizontal overflow.
    - After scrolling down and back up, every bottom-bar control is visible and tappable.
    - With the keyboard (Tab to a TOC link, then Enter), the reader jumps and focus lands on the
      heading.
- **The known intermittent `navigation` failure at 1280** (AUDIT-2026-10-07 §10) is not this task.
  If it fails, rerun it once and mention it; do not chase it.

## Acceptance criteria

1. On book 3275, all 88 TOC entries land on their chapter at phone and desktop sizes. This is
   verified read-only on production after the migration.
2. No book was re-uploaded or written. `git diff` shows no change in `lib/books/extract.ts`,
   `markdown.ts`, `chunk.ts` or `save.ts`, and stored content, hashes and search are untouched.
3. Footnote and endnote links work in both directions, wherever they exist.
4. Before the migration is applied, internal links still work through phrase search, and nothing
   errors.
5. `book_outline` is read-only, `security invoker` and RLS-bound; PGlite proves anon cannot see
   drafts. It returns one jsonb value, so it is unaffected by the 1,000-row anon cap.
6. «قايتىش» works and never breaks the Mobile Rules.
7. Every test is green, and the bundle numbers are in the report.
8. The planning files are on GitHub, and no secret is among them.

**Commits:**

- `feat(db): book_outline for in-book links` (the migration and SQL tests)
- `feat(reader): follow table-of-contents and note links` (resolver, reader, tests)
- `feat(reader): return to the clicked link`
- `docs: add audit and prompt history`

**Report.** Finish with a short report **in simple Uyghur**:

- what changed;
- whether the SQL step is done;
- the numbers from A and E (ids and counts only — never a book's text);
- the bundle numbers;
- what to try on his phone.

List anything you saw that deserves later work, without starting it. One example: downloaded books
(`lib/books/export-book.ts`) still carry the dead `#…` links.

If anything here conflicts with `CLAUDE.md`, or you cannot reach 88/88 without changing stored
content or the import, or «قايتىش» cannot fit without breaking the Mobile Rules, **stop and ask the
owner in Uyghur** — never make that trade silently.
