# Bilim Hezinisi — Web Edition («بىلىم خەزىنىسى» تور نۇسخىسى)

## Project Overview
Public web edition of the Uyghur digital library «بىلىم خەزىنىسى». Anyone can browse,
read, and search books WITHOUT an account; optional free accounts add bookmarks, notes,
and reading progress; ONLY the admin (and users the admin grants `uploader` rights) can
add or edit books. The UI must visually and structurally mirror the existing desktop
(Electron) app — same warm manuscript design language, same layout concepts — adapted
responsively for phones.

The desktop app source is the READ-ONLY reference at
`../bilim hezinisi/bilim hezinisi pc` (port logic and design tokens from it; NEVER
modify anything there from this project).

## Stack (fixed — do not swap without explicit request)
- **Next.js (App Router) + TypeScript + Tailwind CSS.** Next.js Route Handlers / Server
  Actions ARE the Node.js backend — no separate Express server.
- **Supabase**: Postgres (data + full-text search), Auth (email/password), Storage
  (optional original book files, covers). Free tier now; Pro later — nothing may depend
  on paid-only features.
- **Vercel** hosting; git push → auto deploy. GitHub account: `kelemdepter-rgb`.
- **Gemini AI — LAST phase only.** Called exclusively from server routes with a
  server-side paid key; SSE streaming; STRICT user-selected model (never silently
  switch models); per-user daily quotas; usage logged. Port prompts/logic from desktop
  `ai.js` and `_mobile-ai-reference/`.

## Core Principles
- UI is Uyghur, **RTL mandatory** (`<html lang="ug" dir="rtl">`). Code, comments, and
  commits in English. Uyghur ONLY in UI strings and content.
- Anonymous reading must always work: browsing, reading, search require NO login.
- Production-grade: `npm run typecheck && npm run lint && npm run build` must pass
  before every commit. No dead code, no placeholder lorem ipsum in shipped UI.
- Free-tier aware: 500 MB database / 1 GB storage / 5 GB egress. Text-first storage;
  chunked content; no waste (no base64 blobs in Postgres, no duplicate content copies).
- Mobile-first quality: the phone experience must equal desktop quality (see Mobile
  Rules — these are hard requirements).

## Visual Identity (port from desktop, do not invent a new design)
- Source of truth: `:root` CSS variables in desktop `src/index.html` (lines ~38–90):
  paper/gold manuscript palette (`--bg #FBF6EC`, `--am #B0832F`, `--gold #C9A24B`,
  grain texture, radii), with dark and sepia theme variants. Reuse the SAME variable
  names and values so themes stay consistent across desktop and web.
- Fonts: copy from desktop `assets/` into `public/fonts/` — `ukijekran.ttf` (UKIJ
  Ekran, primary UI), `trad-arabic(.bold).ttf`, `Bahij_Nazanin-Regular.ttf`,
  `UthmanicHafs*.otf` (Quran only). Self-hosted `@font-face` with `font-display: swap`;
  convert to woff2 where possible. Never load fonts from third-party CDNs.
- Layout concepts to mirror: top bar with brand, right-side category sidebar
  (drawer on mobile), book grid/list toggle, reader with themes (light/dark/sepia) and
  font-size controls, SVG sprite icons (copy the desktop `<symbol>` icon set).

## Roles
- `admin` (the owner): everything — books, categories, users/roles, settings, AI config,
  usage dashboards. Bootstrap: the user whose email equals env `ADMIN_EMAIL` is
  auto-promoted to admin on first sign-in.
- `uploader`: may create/edit/publish books and manage covers; no user management.
- `reader` (any signed-in user): bookmarks, notes, reading progress, later AI (quota).
- anonymous: browse + read + search only.

## Data Model (Postgres; mirror desktop schema, adapted)
`profiles` (id → auth.users, role, display_name, created_at) ·
`categories` (id, parent_id, name, icon, sort_order) — hierarchical tree ·
`books` (id, title, author, category_id, format, date, description, language,
cover_path, original_file_path NULL, file_hash, page_count, status `draft|published`,
uploaded_by, timestamps) ·
`book_pages` (book_id, page_no, content, content_norm tsvector) — desktop stores one
big text per book; the web MUST chunk into pages (~2,000–3,000 chars, split on
paragraph boundaries) for lazy loading and search snippets ·
`quran_suras` / `quran_ayas` (same columns as desktop: number, name_ar, name_ug,
text_ar, text_ar_simple, text_ug) + FTS ·
`bookmarks`, `book_notes`, `reading_progress`, `recent_reads` (all per-user:
user_id + book_id + position) ·
`note_documents` (user_id, title, content_html sanitized, content_text) — Notebook ·
`ai_usage` (user_id, day, model, requests, tokens_in, tokens_out) ·
`settings` (key, value) — admin-editable site settings.

## Search (must match desktop quality)
- Postgres FTS with the `simple` config on normalized text + `pg_trgm` GIN indexes for
  substring/wildcard matching. Target <3 s across 500 books.
- Port `normalizeArabicQuery` from desktop `database.js` into a SQL function
  `ug_normalize(text)` (hamza unification, ya/alif maqsura, ta marbuta, diacritic
  stripping) and apply it BOTH at index time (`content_norm`) and query time.
- RPC `search_books(query, category, limit, offset)` returning ranked results with
  highlighted snippets; support phrase ("...") and boolean operators like desktop.
- Quran search: separate RPC over `quran_ayas` (Arabic-normalized + Uyghur columns).

## Upload Pipeline (admin/uploader only)
- Extraction happens **in the browser** (pdfjs-dist, mammoth, plain text, HTML/MD →
  turndown): Vercel functions have a 4.5 MB request-body limit and short timeouts —
  NEVER parse large files server-side. Web-URL import (readability) runs server-side
  (small HTML only).
- `.doc` (legacy Word): word-extractor is Node-only → server route accepts ≤4 MB;
  otherwise instruct the admin to convert via the desktop app.
- Original files (when the admin opts to keep the PDF) and covers upload DIRECTLY to
  Supabase Storage via signed upload URLs; extracted pages insert in batches
  (≤500 rows per request). Compute file_hash for duplicate detection (like desktop).
- Scanned PDFs (no text layer): v1 → detect and tell the admin to OCR in the desktop
  app first; browser-side tesseract.js OCR is a later phase.

## Mobile Rules (HARD requirements — previous projects were burned by these)
- Full-height layout uses `100dvh` / `min-h-dvh`. NEVER bare `100vh`.
- `env(safe-area-inset-*)` padding on every fixed/sticky bar; touch targets ≥44 px;
  no hover-only affordances (everything reachable by tap).
- Fixed/sticky bars must NEVER cover interactive content. After scrolling down then
  back up, every control must remain visible and tappable — no auto-hiding toolbars
  that swallow buttons, no controls trapped behind bottom bars.
- No horizontal scroll at 360 px width. Nested scroll containers must not trap or lock
  body scroll; modals/drawers use proper scroll containment (`overscroll-contain`).
- RTL: use logical properties / Tailwind logical utilities (`ps-*`, `pe-*`, `start-*`,
  `end-*`, `text-start`); never physical left/right that breaks RTL.
- Every feature is tested at 375×667 AND 390×844 AND 1280×800 with Playwright before
  it is called done (assert: no horizontal overflow; key controls visible & clickable
  after scroll down+up).

## Security / DO-NOT-TOUCH
- `SUPABASE_SERVICE_ROLE_KEY` and `GEMINI_API_KEY` are server-only: never sent to the
  client, never logged, never committed. `.env*` stays in `.gitignore`.
- **RLS enabled on EVERY table.** Public (anon) SELECT only on `status='published'`
  books/pages, categories, quran, and public settings. Writes to books/categories only
  for admin/uploader (checked via `profiles.role`, not client claims). Per-user tables
  (bookmarks, notes, progress, note_documents) readable/writable only by their owner.
- `/admin` routes and all mutating Server Actions re-verify the role SERVER-SIDE on
  every request. Never trust client-side gating alone.
- Sanitize all rendered book/note HTML (port `sanitize.js` approach; DOMPurify).
- Do not weaken CSP; no third-party scripts/CDNs at runtime.
- Never edit an applied migration — always add a new file in `supabase/migrations/`.

## Workflow
Plan → new migration SQL (if schema changes) → code → `npm run typecheck` +
`npm run lint` + `npm run build` → Playwright smoke (mobile + desktop viewports) →
commit (English, conventional, one logical change) → push → Vercel auto-deploy →
verify the preview URL on a real phone.

## Environment Variables
`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY` (server-only), `ADMIN_EMAIL` (admin bootstrap),
`SITE_URL`, `GEMINI_API_KEY` (last phase, server-only).

## Phases (build in order; each phase ships deployable)
1. **Foundation**: scaffold, design-token theme system ported from desktop, RTL app
   shell, full DB schema + RLS + search functions, auth + roles, first Vercel deploy.
2. **Books & Admin**: upload wizard (client-side extraction, page chunking, preview),
   metadata editing, category tree CRUD (drag-drop), covers, duplicate detection,
   role management UI.
3. **Reading Experience**: library home (grid/list, category sidebar, recent reads),
   reader (themes, font size, position restore, print), global FTS search with
   snippets & operators, bookmarks/notes/progress for signed-in users.
4. **Quran Module**: seed suras/ayas from desktop data, mushaf view with Uthmanic
   fonts, Quran search, copy.
5. **Notebook + Spellcheck**: port rich-text notebook (notes.js) with DOCX export,
   SymSpell + n-gram spellcheck in the browser (lazy-load dictionary from storage).
6. **Polish & Migration**: SEO/share metadata per book, performance passes,
   `scripts/migrate-from-desktop.mjs` importing a copy of the desktop `library.db`
   placed in `migration-data/` (batched, resumable, service-role).
7. **AI Layer**: paid Gemini key, model picker (strict), streaming chat/translate/
   summarize/ask ported from desktop prompts, per-user daily quotas, admin usage
   dashboard, key never exposed.

## Cost / Free-Tier Notes
- Supabase free projects PAUSE after ~7 days without requests → keep an external
  uptime ping (e.g. cron / UptimeRobot) once live; upgrade to Pro ($25/mo) when the
  library grows.
- Gemini paid tier: billing is enabled in Google AI Studio on a Google Cloud project
  (prepay credit model); costs are per token — enforce app-side daily quotas and show
  usage to the admin.
