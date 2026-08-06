# PROMPT 3 — Phase 3: Reading Experience
مۇشۇ سىزىقتىن تۆۋەنكى تېكىستنى Claude Code غا چاپلاڭ.
(BilimHezinisi-website قىسقۇچىدا تېرمىنال ئېچىپ `claude` نى ئىجرا قىلىڭ)

---

Strictly follow **CLAUDE.md** in this folder and use the **bilim-web** skill.
Phases 1–2 are DONE and live: design tokens, RTL shell, themes, schema + RLS, auth,
category tree, upload wizard, book/user admin.
Now execute **Phase 3 — Reading Experience**: the public library, the reader, global
search, and per-user bookmarks/notes/progress.
The desktop app at `../bilim hezinisi/bilim hezinisi pc` remains the read-only design
and behaviour reference — the library grid, the reader chrome and the search results
should feel like the desktop app, adapted for phones.

## 0. Read before coding
`supabase/migrations/0001_init.sql` (especially the existing `search_books` and
`search_quran` RPCs and the RLS policies), `lib/data.ts`, `components/app-shell.tsx`,
`lib/sanitize.ts`. Reuse what exists; do not duplicate helpers.

## 1. Library home (`/`) — works fully logged-out
- Book grid and list views with a toggle (persisted per user in a cookie), mirroring
  the desktop layout: cover, title, author, category, page count.
- The existing category sidebar filters the list (including all descendant categories
  of the selected node). Selected category reflected in the URL (`?cat=`) so it is
  shareable and back/forward works.
- Sort control: newest / title / author. Pagination or "load more" — must not refetch
  everything, and must keep scroll position when more items load.
- Books with no cover get a generated placeholder card in the manuscript style
  (title + author on paper texture) — no broken images.
- "ئاخىرقى ئوقۇغانلىرىم" (recent reads) strip for signed-in users only, from
  `recent_reads`; hidden entirely for anonymous visitors.
- Empty state in Uyghur when a category has no books.

## 2. Book detail (`/books/[id]`)
Cover, full metadata, description, page count, category breadcrumb, and a primary
«ئوقۇش» button. For signed-in users also show their progress ("45-بەت / 320") and a
«داۋاملاشتۇرۇش» button. Draft books are visible only to admin/uploader (server-side).

## 3. Reader (`/books/[id]/read`) — the most important screen
- Lazy-loads `book_pages` (initial window + fetch-ahead as the user scrolls); never
  loads the whole book at once. Smooth continuous scroll, page numbers visible.
- Reader chrome: theme (light/dark/sepia — reuse the global tokens), font size
  +/− with sane min/max, font family choice (UKIJ Ekran / Traditional Arabic /
  Bahij Nazanin), line-height control. Settings persist per user (cookie or
  `settings`-style local storage) and apply instantly.
- Position restore: save reading position (page + offset) to `reading_progress`,
  debounced, for signed-in users; for anonymous use localStorage. On reopening, jump
  back and show a small "قايتىپ كەلدىڭىز" indicator.
- Also write to `recent_reads` on open (signed-in only), keeping it deduplicated.
- Page jump: enter a page number; plus a "go to top/bottom" control.
- In-book search: find text within the current book, highlight hits, next/previous
  navigation, and a results list that jumps to the page.
- Print / save-as-PDF via a clean print stylesheet (no chrome, correct RTL, page
  breaks between book pages).
- Text selection actions: copy, and for signed-in users «خەتكۈچ قوشۇش» (bookmarks) and
  «خاتىرە قوشۇش» (book_notes) anchored to the position. A side panel lists bookmarks
  and notes for the book with jump-to and delete.
- All page HTML/text rendered through the existing sanitizer.

### Reader mobile requirements (HARD — this is what burned previous projects)
- The reader toolbar must NEVER hide or swallow controls. After scrolling down and
  back up on a 375 px phone, every control (back, theme, font size, bookmark, panel
  toggle) must be visible and tappable. No auto-hiding toolbar that traps buttons.
- Full height uses `100dvh`/`min-h-dvh`, safe-area padding on any fixed bar, ≥44 px
  touch targets, no hover-only affordances.
- The bookmark/notes panel is a proper drawer on mobile with `overscroll-contain`; it
  must not lock body scroll after closing.
- No horizontal scroll at 360 px, even with long unbroken Arabic/Uyghur words.

## 4. Global search (`/search`)
- Uses the existing `search_books(q, category_id, lim, off)` RPC — do not rewrite it
  unless a real bug is found (then add a NEW migration).
- Query box in the top bar wired up; results show cover, title, author, page number
  and the `<mark>`-highlighted snippet (render the marks safely, not with raw HTML
  injection). Clicking a result opens the reader at that exact page with the term
  highlighted.
- Supports the desktop operators: "quoted phrases", OR, and -exclusion. Show a short
  Uyghur hint about the operators.
- Category filter, pagination, result count, and the elapsed time. Empty and
  loading states in Uyghur. Target: results under 3 s.
- Search must work logged-out.

## 5. Per-user features (signed-in only)
`/my/bookmarks` and `/my/notes`: list everything across books, grouped by book, with
jump-to and delete. Owner-only via existing RLS — plus server-side checks.

## 6. Quality bar
- Anonymous browsing/reading/search must keep working with no account. Verify.
- No N+1 query storms; use single queries with joins/counts where possible.
- All new UI in Uyghur, RTL, existing design tokens and Icons component only.
- New migrations only as NEW files in `supabase/migrations/`.

## 7. Tests (mandatory before you call this done)
- `npm run typecheck && npm run lint && npm run build` pass.
- Playwright at 375×667, 390×844, 1280×800:
  - home grid/list toggle, category filter, no horizontal overflow;
  - reader: opens, loads more pages on scroll, font-size and theme controls work, and
    **after scroll down + scroll up every toolbar control is still visible and
    clickable**;
  - bookmark panel opens/closes on mobile and body scroll is restored;
  - search returns results and clicking one lands on the right page;
  - anonymous session can read and search; `/my/bookmarks` redirects to login.
- Unit tests for the in-book search/highlight helper and the position-restore logic.

## 8. Then walk me through it (Uyghur, one step at a time)
Apply any new migration, then have me open the real book I uploaded in Phase 2 on my
phone and test: reading, changing theme/font, closing and reopening (position
restored), adding a bookmark, and searching a word from that book.

## Acceptance criteria
- I can browse by category, open a book, read it comfortably on my phone, change
  theme/font size, come back later and continue from where I stopped.
- Searching a word from inside a book finds it with a highlighted snippet and opens
  the right page.
- A logged-out visitor can do everything except bookmarks/notes/progress.
- Nothing in the reader gets covered or trapped after scrolling on a phone.
- Do NOT start Phase 4 (Quran module) yet.

Commit per logical step with English conventional messages. Ask me only when a
decision is genuinely mine; otherwise follow CLAUDE.md defaults.
