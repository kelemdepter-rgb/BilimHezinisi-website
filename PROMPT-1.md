# PROMPT 1 — Phase 1: Foundation
بۇ بۇيرۇق Claude Code ۋە Cowork ھەر ئىككىسىگە ماس:
- **Claude Code:** BilimHezinisi-website قىسقۇچىدا تېرمىنال ئېچىپ، `claude` نى ئىجرا قىلىپ، تۆۋەندىكى تېكىستنى چاپلاڭ.
- **Cowork:** ھەر ئىككى قىسقۇچ تاللانغان يېڭى سۆزلىشىشكە چاپلاڭ.

---

Strictly follow **CLAUDE.md** in this folder — it is the project instruction. If a
**bilim-web** skill is available, use it too.
Execute **Phase 1 — Foundation** of the Bilim Hezinisi web edition. Work only inside
`E:\ditallar\men yasigan ditallar\BilimHezinisi-website`. The desktop app at
`../bilim hezinisi/bilim hezinisi pc` is a read-only reference.

## Tasks

### 0. Setup check
- If `.claude/skills/bilim-web/SKILL.md` does not exist in this folder, create it by
  copying `setup/claude-skills/bilim-web/SKILL.md` (keep the original), so the skill
  is always available here.
- Verify `node -v` (LTS 20+) and `git --version` work. If either is missing on the
  user's machine, STOP and guide them (in simple Uyghur) to install Node.js LTS from
  nodejs.org and Git from git-scm.com, then continue.

### 1. Scaffold
Next.js (latest stable, App Router) + TypeScript + Tailwind CSS + ESLint, scaffolded
IN PLACE in this folder (it already contains CLAUDE.md and PROMPT files — do not
create a nested project folder). Add npm scripts: `dev`, `build`, `typecheck`
(`tsc --noEmit`), `lint`, `test` (Playwright). Git: init, `.gitignore` covering
`.env*`, `node_modules`, `.next`, `migration-data/`, `test-results/`.

### 2. Design system ported from desktop
- Copy the `:root` CSS variable palette (light + dark + sepia themes) from desktop
  `src/index.html` into `app/globals.css`, keeping the SAME variable names (`--bg`,
  `--am`, `--gold`, `--paper`, `--grain`, radii, shadows).
- Copy fonts from desktop `assets/` into `public/fonts/` (ukijekran.ttf,
  trad-arabic.ttf, trad-arabic-bold.ttf, Bahij_Nazanin-Regular.ttf, both
  UthmanicHafs OTFs) and declare `@font-face` (`font-display: swap`). Primary UI font
  stack: `'UKIJ Ekran', 'Traditional Arabic', serif`.
- Copy the desktop SVG icon sprite (`<symbol>` set) into a shared `Icons` component.
- Theme switching (light/dark/sepia) via `data-theme` on `<html>`, persisted in a
  cookie so SSR renders the right theme without flash.

### 3. RTL app shell (mirrors the desktop layout, responsive)
`<html lang="ug" dir="rtl">`. Top bar with brand «بىلىم خەزىنىسى» + theme toggle +
search box (UI only for now) + login button. Category sidebar on the inline-start
side: permanent on ≥1024 px, sliding drawer with overlay on mobile. Content area with
placeholder home page. Footer minimal. ALL Mobile Rules from CLAUDE.md apply
(dvh, safe-area, ≥44 px targets, no horizontal scroll at 360 px, drawer must not trap
body scroll). All visible strings in Uyghur.

### 4. Database: initial migration
One migration file `supabase/migrations/0001_init.sql` containing the FULL Phase-1
schema from CLAUDE.md (profiles, categories, books, book_pages, quran_suras,
quran_ayas, bookmarks, book_notes, reading_progress, recent_reads, note_documents,
ai_usage, settings), plus:
- `ug_normalize(text)` SQL function ported from `normalizeArabicQuery` in desktop
  `database.js` (hamza/ya/alif-maqsura/ta-marbuta unification, diacritic strip).
- Generated `content_norm` tsvector (config `simple`, over `ug_normalize(content)`),
  GIN indexes (tsvector + `pg_trgm` on content), and RPC
  `search_books(q text, category_id bigint, lim int, off int)` returning ranked
  matches with highlighted snippets. Same normalization applied to the query.
- RLS ON for every table with the exact policies described in CLAUDE.md
  (anon: SELECT published only; owner-only for per-user tables; admin/uploader checks
  via `profiles.role`; role changes admin-only).
- Trigger creating a `profiles` row on new auth user; auto-promote to `admin` when
  the email matches the `admin_email` value stored in `settings`.
- Storage buckets `book-files` and `covers` with matching policies (public read,
  admin/uploader write).

### 5. Auth
Supabase SSR auth (`@supabase/ssr`): login + register + logout pages in Uyghur,
middleware session refresh, `/admin` route group with SERVER-SIDE role guard showing
a placeholder dashboard (role, book count, category count). Reading pages must work
logged-out.

### 6. Tests
Playwright configured with three projects (375×667, 390×844, 1280×800). Smoke tests:
home renders RTL with Uyghur brand; no horizontal overflow on any viewport; sidebar
drawer opens/closes on mobile and body scroll is not trapped; login page renders;
after scrolling down and back up all header controls remain clickable.

### 7. Guide me through the browser steps (Uyghur, one step at a time)
1. Create the Supabase project (kelemdepter@gmail.com account) and put the three keys
   plus `ADMIN_EMAIL` and `SITE_URL` into `.env.local` (never commit).
2. Apply the migration (SQL Editor paste, or `supabase db push` if linked).
3. Register my admin account and verify auto-promotion.
4. Create the GitHub repo `kelemdepter-rgb/BilimHezinisi-website` and push.
5. Import to Vercel, set the env vars, deploy, and open the URL on my phone together
   with me to verify.

(In Claude Code I can also preview locally: run `npm run dev` and tell me to open
`http://localhost:3000` in my browser.)

## Acceptance criteria (verify each, then report)
- `npm run typecheck`, `lint`, `build` all pass; all Playwright projects green.
- Site deployed on Vercel; opens correctly on a phone: RTL, Uyghur UI, desktop-style
  paper/gold theme, all three themes switchable, no horizontal scroll, drawer works.
- Schema + RLS applied; anonymous visitor sees the (empty) library without login;
  my account shows role `admin`; a second test account gets role `reader`.
- No secret appears in the client bundle, logs, or git history.
- Do NOT start Phase 2 features (no upload UI yet).

Commit per logical step with English conventional messages. If a decision is
genuinely mine to make, ask me — otherwise proceed with CLAUDE.md defaults.
