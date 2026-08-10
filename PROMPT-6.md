# PROMPT 6 — كىتابلارنى سايتقا يۆتكەش + Google دا تېپىلىدىغان قىلىش

## قانداق ئىشلىتىسىز (يېڭى تۈر ئېچىپ)
1. Claude Code نى ئېچىپ **BilimHezinisi-website** قىسقۇچىنى تاللاڭ
   (`E:\ditallar\men yasigan ditallar\BilimHezinisi-website`).
2. سىزىقتىن تۆۋەنكى تېكىستنى پۈتۈنلەي كۆچۈرۈپ چاپلاڭ.

---

You are continuing an existing, live project. Read `CLAUDE.md` in this folder FIRST —
it is the project instruction and always wins — and use the **bilim-web** skill
(`.claude/skills/bilim-web/SKILL.md`).

## Where the project stands right now (Phases 1–5 DONE and deployed)
Live at `https://bilim-hezinisi-website.vercel.app`
(Vercel Hobby + Supabase Free; GitHub `kelemdepter-rgb/BilimHezinisi-website`).

Already built and working — **do not rebuild or "improve" any of it unless a task below
says so**:
- **Phase 1** — Next.js App Router + TS + Tailwind; manuscript design tokens (light /
  dark / sepia); RTL shell with top bar + category drawer; self-hosted fonts; Supabase
  Auth with `admin` / `uploader` / `reader`; RLS on every table; `ug_normalize()` +
  `search_books` / `search_quran` RPCs.
- **Phase 2** — admin category tree, upload wizard, book management, user roles.
- **Phase 3** — library home (grid/list, category filter, recent reads), book detail,
  reader (lazy pages, themes, font controls, position restore, bookmarks, notes,
  in-book search, print), global search.
- **Phase 4** — PDF and OCR removed entirely (accepted: `.docx`, `.doc`, `.md`,
  `.html`/`.htm`, `.txt`, web URL; PDFs blocked client-, server- AND trigger-side);
  content stored as **Markdown** (`books.content_format`); free-tier hardening
  (~184 KB/book, `next/image` + CDN covers, daily Vercel cron on `/api/health`, admin
  usage panel, `scripts/backup.mjs` + `restore.mjs` + `ZAPASLA.bat` → OneDrive).
- **Phase 5** — Quran module: 114 suras / 6,236 ayas seeded with the Uyghur (Muhammad
  Salih) translation, mushaf view with Uthmanic fonts, Quran search that matches with
  or without tashkil and highlights the fully-vocalised text, aya copy and bookmarks.
  Migrations up to `0008` are applied.

## Hard constraints (unchanged, non-negotiable)
- **No budget, ever.** Everything stays inside Supabase Free (500 MB DB / 1 GB storage /
  5 GB egress) and Vercel Hobby. No paid service, no new vendor account.
- Anonymous browsing, reading and search must keep working with no account.
- All Mobile Rules in CLAUDE.md apply to anything you touch.

Now execute **Phase 6 — bring the real library online and make it findable**.

---

# PART A — Migrate the desktop library

The owner's existing books live in the desktop app's SQLite database at
`%USERPROFILE%\JamiyKutupxana\library.db` (books, `book_content`, categories,
bookmarks, notes). Bring those books into the website.

## A1. Copy, never touch the original
Guide me to copy `library.db` into `migration-data/` inside THIS project (gitignored).
Never open the live desktop database directly, and never write to the desktop folder.

## A2. Dry-run and size report FIRST — this is the critical step
Write `scripts/migrate-from-desktop.mjs` with a **`--dry-run` mode that is the default**.
Before importing anything it must report, in a clear table:
- how many books and categories are in `library.db`
- total extracted text size, and the **estimated database size after import**, using the
  real measured bytes-per-book from `scripts/db-usage.mjs`
- how much of the 500 MB free tier that would consume, and how much would remain
- a per-book list (title, chars, estimated KB) sorted largest first
- which books would be skipped as duplicates (by `file_hash`, like the desktop app)

**If the estimate would exceed ~80 % of the free tier, stop and tell me** — do not
import. Offer me choices in simple Uyghur: import only selected categories, import the
smallest N books first, or split the import across sessions. Support
`--categories=...`, `--limit=N` and `--skip-larger-than=KB` flags so I can choose.

## A3. The real import
- Service-role, batched (≤500 rows per request), **resumable** (re-running continues
  where it stopped and never duplicates), with a progress line per book.
- Map desktop → web: `books` metadata (title, author, category, format, date,
  description, file_hash) and `book_content` → chunked `book_pages` using the SAME
  chunker the upload wizard uses (paragraph boundaries, Markdown blocks never split).
- Desktop content is plain text, so set `content_format = 'text'` unless the source is
  genuinely Markdown. Do not fabricate formatting.
- Recreate the desktop category tree, merging into existing categories by name instead
  of creating duplicates.
- Books arrive as `status='draft'` by default, with a `--publish` flag, so I can review
  before anything goes public. Report at the end how many are drafts.
- Do NOT import the desktop's personal bookmarks/notes (they belong to a single local
  user and the web ones are per-account) unless I ask.

## A4. Verify the import
After importing, verify and report: book count, page count, that a random sample of
books reads back correctly (first and last page non-empty), that search finds a rare
word from a newly imported book, and the new database size vs the free-tier limit.
Then remind me to run `ZAPASLA.bat`.

---

# PART B — Make the site findable and shareable (SEO)

## B1. Metadata
- Proper `<title>` / description per page, in Uyghur: home, category, book detail,
  reader, `/quran`, sura pages, search.
- Open Graph + Twitter card tags so a shared link shows the book cover, title and
  author. Generate a tasteful fallback OG image in the manuscript style (using the
  existing design tokens) for books with no cover — generated at build/request time,
  **not** stored as files (free-tier discipline).
- `lang="ug"` and `dir="rtl"` already set — confirm they are correct on every route.

## B2. Discoverability
- `app/sitemap.ts`: all published books, categories, and Quran suras. It must stay
  correct as books are added, and must not become slow with hundreds of entries.
- `app/robots.ts`: allow public pages; **disallow `/admin`, `/my/*` and API routes.**
- Canonical URLs using `SITE_URL`.
- Structured data (JSON-LD `Book` on book pages, `WebSite` + `SearchAction` on home) so
  Google can show the library properly.
- Draft books must never appear in the sitemap, in metadata, or to anonymous visitors.

## B3. Speed (also protects the free tier)
- Run a Lighthouse pass on home, a book page and `/quran` at mobile size. Report scores
  before/after and fix the cheap wins (image sizing, font loading, unused JS).
- Confirm the caching from Phase 4 still holds after these changes: repeat visits must
  be served by Vercel's CDN, not by Supabase.

---

# PART C — Two safety items before sharing the site publicly

## C1. Email confirmation
The owner still has Supabase **Confirm email OFF**. Walk me through turning it ON
(Supabase → Authentication → Sign In / Providers → Confirm email), then verify that
registration still works end-to-end and that the confirmation link points at the real
site URL, not `localhost`. Fix `SITE_URL` / redirect URLs if needed.

## C2. Abuse and cost protection
The site is about to be public and must not be pushed over the free tier by accident:
- Rate-limit signup and login attempts (cheap, in-process or Postgres-based — no paid
  service).
- Make sure an anonymous visitor cannot trigger expensive queries (cap search result
  limits and page-fetch sizes server-side, not just in the UI).
- Confirm RLS still blocks reading draft books and other users' data — write an actual
  test that tries and fails.

---

# Tests + final report (mandatory)
- `npm run typecheck && npm run lint && npm run build` pass; all existing unit and
  Playwright suites still green at 375×667, 390×844, 1280×800.
- New tests: sitemap contains published books and excludes drafts; robots blocks
  `/admin`; a book page exposes correct OG tags; migration chunker matches the wizard's
  output for the same input.
- Final report in simple Uyghur: how many books were imported, the new database size and
  remaining free-tier headroom, Lighthouse scores, and exactly what I must do myself
  (copy `library.db`, choose what to import, publish the drafts, turn on Confirm email,
  run `ZAPASLA.bat`).

# Acceptance criteria
- I can see the size estimate BEFORE anything is imported, and choose what to import.
- My desktop books are on the site, readable and searchable, with the free tier still
  having clear headroom.
- Sharing a book link shows a proper preview; Google can index the library; `/admin`
  and personal data are excluded.
- Confirm email is on and registration works on the real domain.
- Nothing from Phases 1–5 regressed.
- Do NOT start the Notebook/spellcheck phase or the AI layer.

Commit per logical step with English conventional messages. If the import would not fit
in the free tier, STOP and ask me before importing anything.
