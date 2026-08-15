# PROMPT 8 — خاتىرە دەپتىرى + ئۇيغۇرچە ئىملا تەكشۈرۈش

## قانداق ئىشلىتىسىز
1. Claude Code نى ئېچىپ **BilimHezinisi-website** قىسقۇچىنى تاللاڭ، ھەمدە دېسكتوپ دېتال
   قىسقۇچىنىمۇ قوشۇپ تاللاڭ (`bilim hezinisi pc`) — پايدىلىنىش مەنبەسى.
2. سىزىقتىن تۆۋەنكى تېكىستنى پۈتۈنلەي كۆچۈرۈپ چاپلاڭ.

---

You are continuing an existing, live project. Read `CLAUDE.md` FIRST (it always wins)
and use the **bilim-web** skill. The site is deployed at
`https://bilim-hezinisi-website.vercel.app` on Vercel Hobby + Supabase Free.

## Where the project stands
Done and working — do not rebuild any of it:
- **1** Foundation (design tokens, RTL shell, themes, Auth + roles, RLS, `ug_normalize`).
- **2** Admin: category tree, upload wizard, book management, user roles.
- **3** Library home, book detail, reader (lazy pages, themes, fonts, position restore,
  bookmarks, notes, print), global search.
- **4** No PDF / no OCR (`.docx`, `.doc`, `.md`, `.html`, `.txt`, URL only); content
  stored as Markdown; free-tier hardening (~184 KB/book, CDN covers, daily cron on
  `/api/health`, admin usage panel, `backup.mjs` / `restore.mjs` / `ZAPASLA.bat`).
- **5** Quran module (114 suras / 6,236 ayas + Uyghur translation, mushaf view, search).
- **6** Desktop-library migration script, SEO (sitemap, robots, OG, JSON-LD), abuse
  protection.
- **7** Search flow fixed: exact-phrase matching, jump to the exact word, «ئالدىنقى» /
  «كېيىنكى» match navigation with an «n/total» counter, and «قايتىش» returning to the
  search results.

**Search operators were deliberately removed — do NOT reintroduce quoted phrases, `OR`
or `-exclusion` anywhere, including in anything you build now.**

## Hard constraints (unchanged, non-negotiable)
- **No budget, ever.** Supabase Free (500 MB DB / 1 GB storage / 5 GB egress) + Vercel
  Hobby. No paid service, no new vendor account. Measure with `scripts/db-usage.mjs`
  before and after anything that stores data.
- Anonymous browsing, reading and search keep working with no account.
- All Mobile Rules in CLAUDE.md apply to every new screen.

Now execute **Phase 8 — Notebook + Uyghur spellcheck** (CLAUDE.md's "Notebook +
Spellcheck" phase). The desktop app is the specification.

---

# PART A — Notebook (خاتىرە دەپتىرى)

Port the desktop notebook to the web for **signed-in users only** (it is personal
writing; anonymous visitors do not get it). The `note_documents` table already exists
(`user_id`, `title`, `content_html`, `content_text`) with owner-only RLS.

## A1. Study the desktop implementation first
`../bilim hezinisi/bilim hezinisi pc/src/notes.js` (~1,767 lines) and `src/notes.css`,
plus the `notes-*` IPC handlers in `main.js`. Match its feature set and its feel:
- Rich-text editing: bold, italic, underline, headings, lists, alignment, text colour /
  highlight, quote, undo/redo.
- **Format painter**, find & replace, word/character count, collapsible side panels —
  these are the parts users notice; port them faithfully.
- Document list with create / rename / delete, sorted by last-updated.
- **DOCX export** (the desktop uses the `docx` package) so a note can be downloaded.

## A2. Web-specific requirements
- Route `/notes` (list) and `/notes/[id]` (editor). Server-side auth guard; owner-only
  reads and writes, enforced by the existing RLS **and** re-checked server-side.
- **Sanitize on save and on render** with the existing `lib/sanitize.ts` (DOMPurify).
  Never store or render unsanitised HTML. Store the plain-text version in
  `content_text` as the desktop does, for counting and future search.
- **Autosave**, debounced, with a visible «ساقلاندى» state and offline tolerance: if the
  network drops mid-typing, keep the text locally and retry — never lose the user's
  writing.
- Free-tier discipline: notes are text only. No images pasted as base64 into the
  document (strip or reject them with a clear Uyghur message), and cap a single note at
  a sensible size with a friendly warning as it is approached.
- Export DOCX in the **browser** (the `docx` package works client-side), not through a
  Vercel function — keep it off the server.

## A3. Mobile (HARD)
A rich-text toolbar is the classic place where mobile breaks. Therefore:
- The toolbar must stay visible and usable while the on-screen keyboard is open, and
  must NOT cover the line being typed. Use `100dvh`, safe-area padding, ≥44 px buttons.
- Toolbar buttons that do not fit must be reachable through a proper overflow menu that
  opens on tap (no hover-only, no horizontal scroll of the page itself).
- After scrolling down and back up, every toolbar control is still visible and tappable.
- Selecting text and applying a format must work by touch, not just mouse.

---

# PART B — Uyghur spellcheck (ئىملا تەكشۈرۈش)

Port the desktop's spellchecker: `src/spellcheck.js`, `src/symspell.js`, `src/ngram.js`
and the dictionary in `assets/spellcheck/` (`uyghur_words.txt` ≈ 13 MB raw,
`uyghur_corrections.json`).

## B1. The size problem — solve it before writing UI
13 MB of dictionary must never be part of the page load, and must not eat the 1 GB
Storage or the 5 GB egress budget. Required approach:
- Build a **compact binary/compressed dictionary artifact** at build time (e.g. a sorted,
  deduplicated, gzip/brotli-compressed frequency list, ideally a few hundred KB to
  ~2 MB). Report the resulting size.
- Serve it as a **static asset from Vercel's CDN** (`public/`), not from Supabase
  Storage — Vercel's bandwidth is separate from Supabase's 5 GB egress, and the CDN
  caches it so each visitor downloads it at most once.
- **Lazy-load it only when the user actually opens the notebook and turns spellcheck
  on** — never on the library or reader pages. Cache it in the browser (Cache Storage /
  IndexedDB) so it is not re-downloaded on later visits.
- Run SymSpell + the n-gram model in a **Web Worker** so typing never stutters.
- Report: artifact size, first-load time, and the memory footprint on a phone.

## B2. Behaviour (match the desktop)
- Misspelled words underlined as the user types; tapping/clicking one offers ranked
  suggestions (SymSpell edit distance + n-gram context, exactly as `spellcheck.js`
  combines them), plus «رەت قىلىش» / add-to-my-dictionary.
- A personal dictionary per user, stored small (a list of words in `note_documents`'
  owner's settings or a tiny per-user table — choose the cheaper option and say why).
- Uyghur Arabic-script aware: normalization consistent with `ug_normalize` so the same
  word written with different hamza/ya forms is not flagged wrongly.
- If the dictionary fails to load, the notebook must keep working with spellcheck simply
  off — never block writing.

## B3. Mobile
Suggestion popovers must be tappable, must not be clipped by the toolbar or the
keyboard, and must close cleanly. Underlines must not break RTL text shaping.

---

# Wiring in
Add «خاتىرە دەپتىرى» to the main navigation for signed-in users only (existing icon
sprite, one tap on a phone). It must not appear for anonymous visitors.

# Tests (mandatory)
- `npm run typecheck && npm run lint && npm run build` pass; all existing unit and
  Playwright suites still green at 375×667, 390×844, 1280×800.
- Unit tests: sanitizer strips dangerous markup from pasted content; DOCX export
  produces a valid file; SymSpell returns the expected correction for a known set of
  misspelled Uyghur words; the dictionary loader works from a cold cache.
- Playwright at all three viewports: create a note, type, apply bold and a heading,
  autosave shows «ساقلاندى», reload restores the content; the toolbar stays visible and
  clickable after scroll down + up; export downloads a file; a reader-role user can
  reach `/notes` but an anonymous visitor is redirected to login; one user cannot open
  another user's note (test it, do not assume).
- Report DB growth from a realistic note and confirm free-tier headroom is unchanged.

# Acceptance criteria
- I can write and keep personal notes on my phone comfortably, with the toolbar never
  covering what I am typing.
- Formatting survives reload and exports to a Word file I can open.
- Uyghur spellcheck flags real mistakes and suggests sensible corrections, without
  slowing the site down or being downloaded by people who never open the notebook.
- Nothing from Phases 1–7 regressed; no search operators reappeared; no paid service
  and no new vendor account was added.
- Do NOT start the AI layer — that is the last phase.

Commit per logical step with English conventional messages. If porting a desktop
feature faithfully would break the free-tier or mobile rules, stop and explain the
trade-off instead of choosing silently.
