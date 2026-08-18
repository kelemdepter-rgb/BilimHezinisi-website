# PROMPT 9 — ئىزدەش بوياشنى تۈزىتىش + خاتىرە دەپتىرىنىڭ خاتالىقى

## قانداق ئىشلىتىسىز (يېڭى تۈر ئېچىپ)
1. Claude Code نى ئېچىپ **BilimHezinisi-website** قىسقۇچىنى تاللاڭ، ھەمدە دېسكتوپ دېتال
   قىسقۇچىنىمۇ قوشۇپ تاللاڭ (`bilim hezinisi pc`) — ئۇ پەقەت ئوقۇش ئۈچۈن پايدىلىنىش مەنبەسى.
2. سىزىقتىن تۆۋەنكى تېكىستنى پۈتۈنلەي كۆچۈرۈپ چاپلاڭ.

---

You are continuing an existing, live project. Read `CLAUDE.md` in this folder FIRST —
it is the project instruction and always wins — and use the **bilim-web** skill
(`.claude/skills/bilim-web/SKILL.md`).

## Project context (Phases 1–8 are done and deployed)
Live at `https://bilim-hezinisi-website.vercel.app` — a free public Uyghur digital
library. Next.js App Router + TypeScript + Tailwind on **Vercel Hobby**, data in
**Supabase Free**. GitHub `kelemdepter-rgb/BilimHezinisi-website`.

Already built — do not rebuild or redesign any of it:
1. Foundation: manuscript design tokens (light/dark/sepia), RTL shell, Supabase Auth
   with `admin` / `uploader` / `reader`, RLS on every table, `ug_normalize()`.
2. Admin: category tree, upload wizard, book management, user roles.
3. Library home, book detail, reader (lazy page loading, themes, font controls,
   position restore, bookmarks, notes, print), global search.
4. No PDF and no OCR (accepted: `.docx`, `.doc`, `.md`, `.html`/`.htm`, `.txt`, URL);
   content stored as Markdown; free-tier hardening (~184 KB/book, CDN-cached covers,
   daily Vercel cron on `/api/health`, admin usage panel, backup/restore scripts).
5. Quran module (114 suras / 6,236 ayas + Uyghur translation, mushaf view, search).
6. Desktop-library migration script, SEO (sitemap, robots, OG, JSON-LD), rate limiting.
7. Search flow: exact-phrase matching, jump-to-match, «ئالدىنقى»/«كېيىنكى» navigation
   with an «n/total» counter, «قايتىش» returning to the search results.
8. Notebook (`/notes`) with rich text, autosave, DOCX export, and Uyghur spellcheck.

## Non-negotiable constraints
- **No budget, ever.** Supabase Free (500 MB DB / 1 GB storage / 5 GB egress) + Vercel
  Hobby. No paid service, no new vendor account. Do NOT re-add the `pg_trgm` index on
  `book_pages` (removed in Phase 4 to fit the free tier).
- **Search operators are permanently removed.** No quoted phrases, no `OR`, no
  `-exclusion`. Whatever the user types is one literal phrase. Do not reintroduce them.
- Anonymous browsing, reading and search must keep working with no account.
- All Mobile Rules in `CLAUDE.md` apply to anything you touch.
- New migrations are NEW files in `supabase/migrations/`; never edit an applied one.

Two real bugs were found in production. Fix both.

---

# BUG 1 — The reader highlights words the user did not search for, and loses the highlight entirely after clicking a result

## What the user sees
Searching for the two-word phrase **«نامازغا چا»**:

- **In the reader**, the highlighter marks unrelated words that merely *begin* with
  «چا» — for example a standalone **«چالايلى»** and a standalone **«چاقىر»** that are
  NOT preceded by «نامازغا ». The user typed one phrase; the page lights up with
  fragments of it. This makes the site look broken and makes real reading impossible.
- **In the search-results list** the same query renders correctly (the literal
  «نامازغا چا» is highlighted as one unit), so the two code paths clearly disagree.
- **Clicking a search result** opens the book at roughly the right place but the
  searched phrase is **not highlighted at all** on the destination page — no `<mark>`,
  nothing flashes. The user has to hunt for the text by eye.

## Root causes to verify (do not assume — reproduce first)
1. **The reader highlighter tokenises the query.** It appears to split «نامازغا چا»
   into words and match each one with prefix/`:*` semantics, so «چا» matches any word
   starting with «چا». The search-results snippet path does an exact substring match.
   **There must be exactly ONE matching algorithm shared by both paths.**
2. **Offset mismatch between normalized and original text.** `ug_normalize()` removes
   diacritics and unifies characters, so a character offset computed on the *normalized*
   string does not point at the same character in the *original* string — the more
   Arabic (harakat-bearing) text a page contains, the further the highlight drifts, and
   a naive `slice(pos, pos + query.length)` on the original text can land on
   non-matching characters and therefore render no mark at all. Confirm this is what is
   happening before fixing it.

## Required behaviour — the desktop app is the specification
Study `../bilim hezinisi/bilim hezinisi pc/database.js` →
`getBookContentSnippets` (~lines 620–667). Its semantics are simple and must be
reproduced exactly:

> take the user's text as-is, and find every **case-insensitive occurrence of that
> whole literal string** inside the book content. Nothing is tokenised, nothing is
> prefix-matched, nothing is stemmed.

Therefore:

1. **One shared matcher.** Implement a single function (e.g.
   `lib/search/findOccurrences(text, query)`) that returns the ordered list of
   occurrences of the entire query string in a piece of text, normalization-aware and
   case-insensitive, in **original-text coordinates**. Use it for:
   - the search-results snippets,
   - the reader's highlighting,
   - the match counter and «ئالدىنقى»/«كېيىنكى» navigation,
   - the in-book search box.
   Delete every other highlighting/matching implementation. If a helper is needed on
   both the server (SQL) and the client, keep the client one authoritative for
   rendering and make the SQL side agree with it, with a test proving they agree.

2. **Normalization must not break offsets.** Choose one of these and say which:
   - build a normalized→original index map while normalizing, so every match position
     can be translated back exactly; or
   - have the server return the page number plus the **occurrence ordinal** (the Nth
     match on that page) instead of a raw byte/character offset, and let the client
     re-locate occurrences with the shared matcher and jump to the Nth.
   Whichever you pick, the highlight must land on the exact characters the user typed,
   including on pages full of vocalised Arabic.

3. **Correctness rules, stated as tests:**
   - Query «نامازغا چا» **must** highlight the literal «نامازغا چا» wherever it occurs —
     including where it sits inside a longer word, e.g. the first ten characters of
     «نامازغا چاقىرىش» (this is correct desktop behaviour: substring, not word).
   - Query «نامازغا چا» **must never** highlight a standalone «چالايلى», «چاقىر» or
     «چاقىرىش» that is not immediately preceded by «نامازغا ».
   - Two adjacent highlights must never be produced for one logical occurrence.
   - A query that occurs nowhere in the book shows «تېپىلمىدى» and no marks.

4. **Clicking a result always highlights.** After navigating from a search result the
   destination page must render the phrase highlighted, scroll it to the centre of the
   viewport, and flash it (port `flashMatch` from desktop `src/index.html`, ~line 1862).
   The «n/total» counter must show the correct index of that occurrence within the whole
   book. This must work on a 375 px phone with the sticky toolbar accounted for — the
   highlighted text must be visibly centred, never hidden behind a bar.

5. **Performance / free tier.** Keep using the FTS index as the cheap pre-filter and
   verify the exact phrase only on the candidate rows. Do not scan every page, do not
   re-add a trigram index. Report search timing before and after.

## Also
Apply the same single-matcher rule to **Quran search** highlighting where it applies.

---

# BUG 2 — «يېڭى خاتىرە» (new note) returns a server error

## What the user sees
On `/notes`, pressing «يېڭى خاتىرە» produces a blank page:
`This page couldn't load — A server error occurred. Reload to try again.`
The notebook is therefore completely unusable in production, even though it passed
tests locally.

## How to fix it — diagnose first, patch second
1. **Get the real error.** Do not guess. Reproduce locally with `npm run dev` and read
   the server-side stack trace in the terminal, and read the production error in the
   Vercel deployment logs (guide me, in simple Uyghur, to open
   Vercel → the project → Logs, and to copy the error text to you if you cannot reach it
   yourself). State the actual error message and the exact file and line before writing
   any fix.
2. **Check the most likely causes explicitly**, and report which one it was:
   - A migration from Phase 8 was never applied to the **production** database (the
     local DB has it, production does not). List every file in `supabase/migrations/`
     and verify each one is applied in production; if any is missing, tell me exactly
     which file to paste into the Supabase SQL Editor.
   - `note_documents` is missing an INSERT policy (or the policy's `with check` clause
     rejects the row), so the insert fails under RLS for a normal signed-in user.
   - A required column has no default and is not being supplied on insert.
   - A server component or Server Action throwing on `null` (e.g. session, profile, or
     the newly created row) instead of handling it.
   - An environment variable that exists locally but not in Vercel.
3. **Fix the root cause**, not the symptom. If a migration is required, add it as a NEW
   file and give me copy-paste instructions.
4. **Make failures visible and friendly.** Add an error boundary for the `/notes`
   route group so a future failure shows a readable Uyghur message with a retry action
   instead of a raw English server error, and log enough server-side detail to diagnose
   it — without ever logging secrets or note content.
5. **Prove it works against a real, empty account.** The bug was not caught by tests,
   so the tests were wrong. Add a Playwright test that signs in as a fresh `reader`
   account with **no existing notes**, presses «يېڭى خاتىرە», and asserts the editor
   opens and the note is persisted after reload — at 375×667, 390×844 and 1280×800.
   Also assert a second user cannot open that note.

---

# Testing and reporting (mandatory)
- `npm run typecheck && npm run lint && npm run build` all pass.
- All existing unit and Playwright suites stay green at 375×667, 390×844 and 1280×800.
- New unit tests for the shared matcher, including the exact «نامازغا چا» /
  «چالايلى» case above and a page containing vocalised Arabic (offset-mapping proof).
- New Playwright tests: search → click a result → the phrase is highlighted, centred
  and flashed; «كېيىنكى»/«ئالدىنقى» step through occurrences across pages with a correct
  counter; creating a new note works on a fresh account.
- Final report in simple Uyghur: what each bug actually was, what changed, search timing
  before/after, and exactly what I must do myself (apply a migration, set an env var,
  re-run `ZAPASLA.bat`).

# Acceptance criteria
- Searching «نامازغا چا» highlights only that literal phrase, never a bare «چالايلى» or
  «چاقىر», in the reader and in the results list alike — one algorithm, one behaviour.
- Clicking any search result lands on the exact occurrence with a visible highlight,
  on a phone as well as on desktop.
- «يېڭى خاتىرە» creates a note reliably in production, and a future failure shows a
  friendly Uyghur message rather than a raw server error.
- Nothing from Phases 1–8 regressed; no search operators reappeared; no trigram index
  was re-added; no paid service and no new vendor account was added.
- Do NOT start the AI layer — that is the final phase.

Commit per logical step with English conventional messages. If fixing one of these
correctly would conflict with the free-tier or mobile rules, stop and explain the
trade-off to me rather than choosing silently.
