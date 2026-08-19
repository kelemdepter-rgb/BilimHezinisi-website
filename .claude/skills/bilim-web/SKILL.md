---
name: bilim-web
description: Operational guide for developing, testing, and deploying the Bilim Hezinisi («بىلىم خەزىنىسى») web edition — Next.js + Supabase + Vercel. Use for ANY work on this website — running the dev server, features, bug fixes, DB migrations/RLS, mobile layout testing, deployment, migrating books from the desktop app, or the Gemini AI layer.
---

# bilim-web — Bilim Hezinisi Web Edition Operations

Web edition of the Uyghur digital library «بىلىم خەزىنىسى»: Next.js (App Router,
TypeScript, Tailwind) + Supabase (Postgres/Auth/Storage) + Vercel. The user is NOT a
programmer — explain every step they must do themselves in simple Uyghur, one step at
a time, with exact button names. Read `CLAUDE.md` in the repo root FIRST — it holds
the project invariants (RTL, RLS, mobile rules, phases) and always wins.

## Environments (detect which one you are in)
- **Claude Code on the user's Windows PC** (repo: `E:\ditallar\men yasigan ditallar\BilimHezinisi-website`):
  run `npm` / `npx` / `git` directly. The user can SEE the site live at
  `http://localhost:3000` in their own browser while `npm run dev` runs — use this for
  visual checks together. `git push` uses their stored Windows Git credentials.
- **Claude Cowork (Linux sandbox):** the repo is mounted under
  `/sessions/<session>/mnt/BilimHezinisi-website/` (find with `ls /sessions/*/mnt/`).
  The user views the site through the Vercel preview/production URL, not the sandbox
  dev server. If `git push` is unauthenticated, ask for a GitHub PAT (repo scope) and
  use `https://<TOKEN>@github.com/kelemdepter-rgb/<repo>.git`, or prepare a one-click
  `push.bat`.
- **User's browser (guide them, in Uyghur):** Supabase dashboard (project on the
  kelemdepter@gmail.com account; Project URL / anon key / service_role key; SQL
  Editor; Storage), GitHub `kelemdepter-rgb`, Vercel (import repo, env vars, deploys),
  Google AI Studio (billing + Gemini key, last phase).

## Paths
- Desktop app READ-ONLY reference: `E:\ditallar\men yasigan ditallar\bilim hezinisi\bilim hezinisi pc`
  (port logic/design tokens from it — parsers, `normalizeArabicQuery` in `database.js`,
  AI prompts in `ai.js` / `_mobile-ai-reference/`, `:root` design tokens in
  `src/index.html`, fonts in `assets/` — but NEVER modify that folder).

## Daily commands (repo root)
```bash
npm install
npm run dev          # dev server on :3000
npm run typecheck && npm run lint && npm run build   # ALL must pass before commit
npx playwright test  # mobile (375x667, 390x844) + desktop (1280x800) projects
```

## Database changes
- New timestamped SQL file in `supabase/migrations/` per change; NEVER edit an applied migration.
- Apply: `npx supabase db push` if the project is linked; fallback = walk the user
  through pasting the SQL into the Supabase SQL Editor.
- Every table: RLS ON + explicit policies. Anon may SELECT only published books/pages,
  categories, quran, public settings. Roles come from `profiles.role`, checked server-side.
- After schema changes, keep the generated DB types file in sync.

## Testing gate (MANDATORY before calling anything done)
1. typecheck + lint + build green.
2. Playwright at 375×667, 390×844, 1280×800: no horizontal overflow
   (`scrollWidth <= innerWidth`); key controls still visible and clickable after
   scrolling down then up; drawers/modals don't trap body scroll.
3. RTL sanity: layout under `dir="rtl"`, logical utilities only (`ps-*`, `pe-*`,
   `start-*`, `end-*`).

## Gotchas (learned the hard way)
- `100dvh` never `100vh`; `env(safe-area-inset-*)` on fixed bars; ≥44 px touch
  targets; no hover-only UI.
- Vercel request-body limit is 4.5 MB → book files upload DIRECT to Supabase Storage
  (signed URLs); DOCX/HTML/TXT extraction runs in the admin's BROWSER (mammoth,
  turndown), never server-side for big files. Page inserts batched ≤500 rows.
- **NO PDF and NO OCR on the web.** Accepted: `.docx`, `.doc`, `.md`, `.html`/`.htm`,
  `.txt`, web URL. PDFs are rejected client- AND server-side (an INSERT trigger on
  `books`); the admin exports DOCX from the desktop app instead. Never re-add
  pdfjs-dist or a browser OCR library.
- Content is stored as **Markdown** (`books.content_format = 'markdown' | 'text'`);
  the reader renders it with inline HTML disabled + DOMPurify, and search snippets
  strip Markdown syntax while keeping `<mark>`.
- Supabase free tier: 500 MB DB, 1 GB storage, 5 GB egress, project PAUSES after ~7
  days idle → a daily Vercel cron hits `/api/health`. This site must stay free:
  no paid plan, no new vendor. Measure with `node scripts/db-usage.mjs` before
  optimising anything.
- Uyghur search: normalize with `ug_normalize()` (ported from desktop
  `normalizeArabicQuery`) at BOTH index and query time; FTS config `simple` +
  `pg_trgm` for substrings.
- Fonts are self-hosted in `public/fonts/` and are **only** the ones we may
  redistribute: the UKIJ family as woff2 (Ekran, Tuz, Tuz Tom, Tuz Kitab — LGPL) plus
  Uthmanic Hafs `.otf` for the Quran (KFGQPC forbids modifying it, so no woff2).
  `font-display: swap`; no runtime third-party CDNs. **Traditional Arabic and Bahij
  Nazanin are gone and must never be re-added** — Traditional Arabic is a Monotype
  Windows font (still offered in the reader, resolved from the reader's own system,
  never served) and Bahij Nazanin's licence forbids distribution. Rebuild the woff2
  files with `node scripts/build-fonts.mjs`; verify any new font's licence in its own
  name table, not from its filename.
- Secrets: only `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY` may reach
  the client. `SUPABASE_SERVICE_ROLE_KEY`, `GEMINI_API_KEY` are server-only, never
  logged, never committed.
- Book/note HTML is sanitized (DOMPurify) before render.

## Migrating the desktop library
Desktop DB: `%USERPROFILE%\JamiyKutupxana\library.db`.
- In Claude Code on Windows: read it directly (copy it into `migration-data/` first so
  the live app DB is never touched).
- In Cowork: the sandbox cannot see `%USERPROFILE%` — have the user copy `library.db`
  into `migration-data/` inside the website folder.
Then run `node scripts/migrate-from-desktop.mjs` (reads SQLite, chunks book content
into pages, uploads via service-role in batches; resumable; skips duplicates by
file_hash).

## Release flow
typecheck/lint/build/Playwright green → bump version → commit (English, one logical
change) → push → Vercel auto-deploys → open the URL on a real phone and verify
scrolling/tapping → done.

## AI layer (LAST phase)
Gemini called only from server routes with the paid key from Google AI Studio billing;
SSE streaming; strict model selection (never silently switch); per-user daily quotas
in `ai_usage`; admin usage dashboard. Port prompts from desktop `ai.js`.
