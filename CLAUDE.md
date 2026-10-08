# Bilim Hezinisi — Web Edition («بىلىم خەزىنىسى» تور نۇسخىسى)

## Project Overview
Public web edition of the Uyghur digital library «بىلىم خەزىنىسى». Anyone can browse,
read, and search books WITHOUT an account; optional free accounts add bookmarks, notes,
and reading progress; ONLY the admin (and users the admin grants `uploader` rights) can
add or edit books. The UI must visually and structurally mirror the existing desktop
(Electron) app — same warm manuscript design language, same layout concepts — adapted
responsively for phones.

**Address (since 2026-08-29): `https://bilimhezinisi.com`.** `www.bilimhezinisi.com`
308-redirects to that apex, and the old address
`bilim-hezinisi-website.vercel.app` is **kept, never deleted**, permanently
308-redirecting to the new one (`lib/legacy-host.ts`, applied in `proxy.ts`) —
except `/api/health` and `/auth/`, which must keep answering on the old host
itself. PROMPT-1 … PROMPT-22 name the old address because that is where the site
lived when they were written; they are history and are not rewritten.

The desktop app source is the READ-ONLY reference at
`../bilim hezinisi/bilim hezinisi pc` (port logic and design tokens from it; NEVER
modify anything there from this project).

## Stack (fixed — do not swap without explicit request)
- **Next.js (App Router) + TypeScript + Tailwind CSS.** Next.js Route Handlers / Server
  Actions ARE the Node.js backend — no separate Express server.
- **Supabase**: Postgres (data + full-text search), Auth (email/password), Storage
  (optional original book files, covers). **Free tier permanently — the owner has no
  budget. Nothing may require a paid plan, now or later.**
- **Vercel** hosting (Hobby, non-commercial free library); git push → auto deploy.
  GitHub account: `kelemdepter-rgb`.
- **Gemini AI — LAST phase, bring-your-own-key, BROWSER-ONLY.** The owner does NOT
  pay for AI and runs NO server code for it. Each signed-in reader supplies their
  OWN free Gemini key; it is stored **in that reader's browser only** and the
  request goes **directly from their browser to Google**. It never reaches our
  server, is never written to Supabase, and is never logged. There is no
  `GEMINI_API_KEY` env var and no AI server route — verified on 2026-08-26 that
  `generativelanguage.googleapis.com` answers cross-origin browser requests,
  streaming endpoint included (see "AI Layer" below). SSE streaming; STRICT
  user-selected model (never silently switch); four key slots with automatic
  failover; per-user usage kept in that reader's browser.
  Port prompts/logic from desktop `ai.js` and `_mobile-ai-reference/`.

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
- **Fonts — only what we may legally redistribute.** Shipped from `public/fonts/`:
  the UKIJ family (LGPL, ukij.org) as woff2 — `ukijekran.woff2` (primary UI),
  `ukij-tuz`, `ukij-tuz-tom`, `ukij-tuz-kitab` (+ bold cuts) — and
  `UthmanicHafs*.otf` (Quran only, KFGQPC). Regenerate the woff2 files with
  `node scripts/build-fonts.mjs`; every source is verified LGPL from its OWN name
  table, not from its filename (`UKIJEsliye.ttf` is "All Rights Reserved" and is
  therefore NOT shipped). Self-hosted `@font-face` with `font-display: swap`; never
  load fonts from third-party CDNs.
- **DO NOT re-add `trad-arabic(.bold).ttf` or `Bahij_Nazanin-Regular.ttf`.** They were
  removed in the licence clean-up: Traditional Arabic is a Monotype "Microsoft supplied
  font" that may not be redistributed (it is still offered in the reader, resolved from
  the reader's own Windows install — named in the font stack, never served), and Bahij
  Nazanin's own licence says "Not for reproduction, distribution or commercial use".
  Uthmanic Hafs stays `.otf`: KFGQPC forbids modifying the font software, and a woff2
  conversion is a modification. See `THIRD-PARTY-NOTICES.md`.
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
`book_pages` (book_id, page_no, content) — searched through the expression index
`book_pages_fts_idx` on `to_tsvector('simple', ug_normalize(content))`; there is NO
stored `content_norm` column (0014 dropped it: 4 MB per book on a 500 MB ceiling).
Desktop stores one big text per book; the web MUST chunk into pages (~2,000–3,000
chars, split on paragraph boundaries) for lazy loading and search snippets ·
`quran_suras` / `quran_ayas` (same columns as desktop: number, name_ar, name_ug,
text_ar, text_ar_simple, text_ug) + FTS ·
`bookmarks`, `book_notes`, `reading_progress`, `recent_reads` (all per-user:
user_id + book_id + position) ·
`note_documents` (user_id, title, content_html sanitized, content_text) — Notebook ·
`ai_usage` (user_id, day, model, requests, tokens_in, tokens_out) — **UNUSED, and
must stay that way**: AI runs entirely in the reader's browser, so nothing writes
here. The table is left in place because an applied migration is never edited ·
`settings` (key, value) — admin-editable site settings.

## Search (must match desktop quality)
- Postgres FTS with the `simple` config on normalized text + `pg_trgm` GIN indexes for
  substring/wildcard matching. Target <3 s across 500 books.
- Port `normalizeArabicQuery` from desktop `database.js` into a SQL function
  `ug_normalize(text)` (hamza unification, ya/alif maqsura, ta marbuta, diacritic
  stripping) and apply it BOTH at index time (the expression index
  `book_pages_fts_idx`) and query time.
- **Every search path must be able to use `book_pages_fts_idx`.** `search_books` and
  `book_match_pages` are PL/pgSQL with `plan_cache_mode = force_custom_plan` for that
  reason (0025): each call is planned with the real word, so a whole-library search
  reads the index instead of every page (17,601 pages timed out at 3 s for every
  anonymous visitor on 2026-09-11). After the owner applies ANY migration that touches
  search, `node --env-file=.env.local scripts/search-timing.mjs after` runs **as anon**
  (the default) and must pass — it exits non-zero on a failure or a missed budget.
- **Pages are found through the index and nothing else** (0029, PROMPT-41):
  `search_books` and `book_match_pages` take their pages from
  `private.matching_pages`, whose one statement runs with the planner's walks
  (`enable_seqscan/indexscan/nestloop`) off. Left free, the planner walked the
  books normalizing every page for «ئاللاھ» (gathered in a few books) and timed
  out live; on an unchanged copy the same plan flipped between 5 s and 0.7 ms.
  A phrase asks the index for pages holding ALL its words and opens at most
  1,000 of them; when that bound stops it, the answer carries `partial` (and a
  flags-only row with no book when nothing turned up), which /search and the
  notebook show as «only part searched» — never «nothing found».
  `runBookSearch` filters that row; any new caller of `search_books` must too.
  Measurements and the reasoning: `docs/search-common-words.md`.
- RPC `search_books(query, category, limit, offset)` returning ranked results with
  highlighted snippets, plus `page_no` and `match_pos` so the reader can jump to the
  exact occurrence.
- **Search operators are DELIBERATELY REMOVED — do not reintroduce them.** No quoted
  phrases, no `OR`, no `-exclusion`. Whatever the user types is searched literally as
  one exact phrase (after `ug_normalize`), the way the desktop app's `indexOf` search
  behaves. A result is only shown when that exact phrase occurs; the whole phrase is
  highlighted, never a fragment of it.
- **Every expensive anonymous search takes a slot first** (migration 0028,
  PROMPT-40): `search_books` (whole library 2, one category 3),
  `book_match_pages` 2 and `search_quran` 1 transaction-scoped advisory locks
  via `private.take_search_slot()`; a full pool answers at once with
  `PT429 bh:search_busy` (HTTP 429), which every caller shows as the calm
  «ھازىر ئىزدەۋاتقانلار كۆپ» with a retry (`lib/search/busy.ts`). A new
  expensive anonymous RPC gets a pool of its own. Never replace the try-lock
  with the blocking one, and never count searches in a table. Sizes and
  measurements: `docs/search-flood.md`.
- Reader match navigation: «ئالدىنقى» / «كېيىنكى» with an «n/total» counter walking
  every occurrence in the whole book (ported from desktop `updateMatchNav` /
  `jumpToMatch`); returning from the reader goes back to the search results.
- Quran search: separate RPC over `quran_ayas` (Arabic-normalized + Uyghur columns).

## Upload Pipeline (admin/uploader only)
- **Accepted formats: `.docx`, `.doc`, `.md`, `.html`/`.htm`, `.txt`, and web URL.
  PDF upload is NOT supported on the web** — it is rejected with an Uyghur message
  telling the admin to open the PDF in the desktop app (OCR there if scanned) and
  export it as DOCX, then upload that. Never re-add PDF parsing without an explicit
  request: it pulls in pdfjs-dist, and scanned PDFs need OCR the web cannot do.
- **Stored content is Markdown.** `.docx` → mammoth `convertToHtml` → turndown →
  Markdown (headings, bold/italic, lists, blockquotes, tables, links preserved).
  `.html` → turndown → Markdown. `.md` → stored as-is. `.txt` and legacy `.doc`
  have no formatting to preserve → stored as plain text.
  `books.content_format` records `markdown` or `text` per book so the reader renders
  each correctly; existing books stay `text`.
- Extraction happens **in the browser** (mammoth, turndown, plain text): Vercel
  functions have a 4.5 MB request-body limit and short timeouts — NEVER parse large
  files server-side. Web-URL import (readability) runs server-side (small HTML only).
- `.doc` (legacy Word): word-extractor is Node-only → server route accepts ≤4 MB and
  yields plain text only; prefer telling the admin to re-save as `.docx` for formatting.
- Markdown is rendered through a sanitizing renderer (no raw HTML passthrough), and
  search snippets strip Markdown syntax before display.
- Covers (and the original file, only when the admin opts in — default OFF) upload
  DIRECTLY to Supabase Storage via signed upload URLs; extracted pages insert in
  batches (≤500 rows per request). Compute file_hash for duplicate detection.
- **Draft first, publish last** — the wizard and the batch importer alike. The
  row is created as a draft whatever status the admin chose, pages/cover/original
  are written, `countStoredPages` must equal the extracted count, and only then is
  the chosen status applied. A failed save is retried INTO THE SAME ROW (the
  unique `file_hash` index refuses a second one); cancelling a failed save
  removes the row through `deleteBooksAction`. Never create a `published` row
  before its pages exist (PROMPT-35).
- Covers are supplied manually or auto-generated as a styled placeholder; there is no
  PDF-first-page cover generation.

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
- The sign-in and registration specs (`auth-flow-*` projects) run against a FAKE
  Supabase (`tests/fixtures/supabase-mock.ts`, through a second dev server on :3300
  with fixed DNS answers) — never the real project, which they would otherwise
  fill with lockouts, signups and emails.

## Security / DO-NOT-TOUCH
- `SUPABASE_SERVICE_ROLE_KEY` is server-only: never sent to the client, never logged,
  never committed. `.env*` stays in `.gitignore`. There is **no** `GEMINI_API_KEY`:
  the only Gemini key that exists is the reader's own, in the reader's own browser.
- **Never accept, forward, proxy or log a reader's Gemini key.** No route may take one
  as a parameter, and no prompt or answer may be logged on either side.
- **RLS enabled on EVERY table.** Public (anon) SELECT only on `status='published'`
  books/pages, categories, quran, and public settings. Writes to books/categories only
  for admin/uploader (checked via `profiles.role`, not client claims). Per-user tables
  (bookmarks, notes, progress, note_documents) readable/writable only by their owner.
- `/admin` routes and all mutating Server Actions re-verify the role SERVER-SIDE on
  every request. Never trust client-side gating alone.
- Sanitize all rendered book/note HTML (port `sanitize.js` approach; DOMPurify).
- Do not weaken CSP; no third-party scripts/CDNs at runtime.
- **Never load-test production**: no bursts at bilimhezinisi.com or the live Supabase project, ever — floods run only against the local stack in `scripts/flood/`.
- **Nothing waits for Supabase for minutes** (PROMPT-40, after the 2026-10-05
  outage): every Supabase client carries a fetch timeout through `global.fetch`
  (`lib/supabase/timeouts.ts` — 10 s on the server, 30 s in the browser, 10 min
  for Storage uploads), session checks have overall deadlines, pages and route
  handlers have `maxDuration` 30 (health 60), and `app/error.tsx` /
  `app/global-error.tsx` show the Uyghur error page. A new Supabase client must
  pass the same `global.fetch`; a new route handler must export its own
  `maxDuration`. Loaders whose read failed THROW (`throwIfUnavailable` in
  `lib/cache.ts`) — inside `unstable_cache` a returned empty answer would be
  cached for everyone. Slowness may only take a permission away: role checks
  fail closed, and the proxy never marks a page cacheable when it could not
  verify the session cookie that came with it. `public/sw.js` never stores a
  page that failed on the server (`FAILED_RENDER`). The Vercel Firewall
  rate-limit rule on `/search` lives in the dashboard; its settings are in
  `docs/search-flood.md`.
- Never edit an applied migration — always add a new file in `supabase/migrations/`.
- Test accounts are created at run time with random passwords, on a domain whose
  mail nobody can read (`example.com`), and are swept by the `bh-e2e-` prefix at
  the start and end of every run. Never commit a password
  (`tests/unit/test-account-hygiene.test.ts` fails if one comes back).
- **Sign-in and registration: three failed attempts, then an hour's lock**
  (PROMPT-38). Counted in Postgres (`auth_attempts`, migration 0026) under an
  HMAC of form + IP + a random device cookie (`bh_dev`), with an IP-only backstop
  at ten an hour — **never by email address**, or anyone could lock a stranger
  out. The table and its `auth_attempt_*` functions are service-role ONLY,
  reached from the Server Actions through `lib/supabase/admin.ts`, and the
  actions fail open when they are unreachable. The rules live in
  `lib/auth/attempts.ts`; `lib/rate-limit.ts` is only the outer burst brake and
  must never trip before the third failure. **Password recovery is never counted
  and never locked.**
- **Addresses under Chinese (PRC) jurisdiction are refused** — `.cn`/`.hk`/`.mo`,
  their internationalised forms, PRC mail providers, and domains whose every MX
  is PRC-hosted — on register, login, forgot-password and resend. The one
  editable list is `lib/auth/blocked-email-domains.ts` (the database's copy,
  which the sign-up hook reads, follows it — see the domain lists below);
  Taiwan and everyone else stay allowed. DNS checks fail open.
- Nothing may reveal whether an address is registered: «resend the confirmation»
  answers the same for every address, whatever Supabase says. What a reader
  typed crosses a redirect in short-lived httpOnly cookies (`lib/auth/flash.ts`),
  never in the URL.
- `app/(auth)` deliberately has no `loading.tsx`: a loading boundary streams the
  form into a hidden element that only JavaScript reveals, and the sign-in forms
  must work without it.
- **Fake accounts are refused in the database as well as the forms**
  (PROMPT-39): the anon key is public, so anyone can call `/auth/v1/signup`
  and skip the site. The Before User Created hook
  `public.hook_before_user_created` (migration 0027; security definer,
  `search_path = ''`, executable by `supabase_auth_admin` only; switched on by
  the owner in Authentication → Hooks) answers `bh:registration_paused`,
  `bh:blocked` or `bh:disposable`, which `lib/auth/reasons.ts` maps to the
  Uyghur messages. Auth calls it only for a NEW user on a public path — never
  for the admin API, which is how the suite makes its `bh-e2e-` accounts.
  Never put IP logic in the hook, and never lower Supabase's per-IP limit.
- **The domain lists are TypeScript first, database second.**
  `lib/auth/blocked-email-domains.ts` and `lib/auth/disposable-domains.ts` —
  the vendored CC0 list `disposable-domains.list.ts` (refreshed by
  `node --use-system-ca scripts/update-disposable-domains.mjs`) plus an
  allowlist of real providers that always wins — are the source;
  `node --use-system-ca scripts/sync-auth-domains.mjs --apply` rewrites
  `supabase/seed/auth_domains.sql` and replaces the database's copies.
  `tests/unit/auth-domains-sync.test.ts` fails until the seed matches, and the
  /admin card warns while the database differs. Throwaway addresses are
  refused on register (counted) and resend (not counted), never on login or
  recovery; a probable typo is offered first, because the list names typo
  domains such as `gmial.com`.
- **Form bots**: /register, /forgot-password and «resend» — never /login —
  carry a honeypot (`bh_note`) and a signed page-made time (`bh_ts`,
  `lib/auth/bot-check.ts`). Under 2 s, over 2 h, missing or forged → the one
  generic «بەتنى يېڭىلاپ، قايتا سىناڭ.»; only a filled honeypot on /register
  counts as a failure. A spec that submits one of these forms calls
  `waitForFormAge` (`tests/fixtures/auth-pages.ts`) first. No CAPTCHA of any
  kind.
- **The pause and the brake** both answer `bh:registration_paused`. The pause
  is the public `settings.registration_paused`, flipped only from the admin's
  «ھېسابات بىخەتەرلىكى» card on /admin (re-verified server-side, two taps to
  turn on); while it is on, /register shows the notice instead of the form and
  sign-up and resend refuse — sign-in, recovery, confirmation, reading and
  search carry on. The brake is computed, never written: 30 or more
  UNCONFIRMED accounts created in the last hour (`auth_signup_brake_limit`),
  so confirmed admin-API accounts can never trip it, and it lifts by itself.
- **The unconfirmed sweep** in /api/health deletes readers never confirmed
  after 7 days — never the admin, an uploader or ADMIN_EMAIL; at most 200 a
  day; the log holds the count only. It runs on the production deployment
  alone (`VERCEL_ENV === "production"`): local servers, the suite's included,
  talk to the real project and call that route. It is OFF until the owner
  switches it on in the card (`settings.unconfirmed_sweep_enabled`); never
  switch it on on the owner's behalf.

## Notebook saving (PROMPT-43 — nothing written may be lost)
- **One save loop decides everything about saving a note**:
  `lib/notes/save-loop.ts` (no React, no DOM; clock, request and device copy
  injected; unit-tested on fake timers in `tests/unit/note-save-loop.test.ts`).
  The editor only reports changes and page events, and lends it the text. The
  title and body are read when the save is SENT, never captured earlier (N4).
  Debounce 1.2 s, at least 3 s between saves, one in flight; flush at once on
  `visibilitychange`→hidden, `pagehide` and unmount (a link inside the app
  fires no pagehide). Retries 5 s, 15 s, 45 s, then every 60 s while visible,
  and at once on `online`, on becoming visible and on «ھازىر قايتا سىناش».
- **A save confirms only the revision it carried.** An edit made while it was
  in flight keeps the label at «ئۆزگەردى…» and is sent next; the label never
  says «ساقلاندى» while something unsent is on screen (N2b).
- **Write-ahead copy** in localStorage `bh-note-draft-v2:<userId>:<noteId>`
  (`lib/notes/drafts.ts`): written ≤ 300 ms after every change and
  synchronously before every send and on leaving; removed only when the
  server confirmed that exact revision, and only by the tab that wrote it.
  Sign-out never removes it; account deletion removes that account's copies
  (and every legacy `bh-note-draft-<id>`) once the server confirmed. The user
  id in the key is a storage namespace, never a permission. A tab puts back
  another tab's copy only once that tab no longer has the note open — each
  open editor holds the Web Lock `bh-note-open:<userId>:<noteId>:<tab>`,
  which the browser drops when the tab closes or crashes
  (`components/notes/note-session.ts`).
- **Never last-write-wins.** `saveNoteAction` updates only
  `where updated_at = baseUpdatedAt` — the string exactly as PostgREST printed
  it (microseconds) — and otherwise answers `conflict` (with
  `serverUpdatedAt`) or `not_found`. The writer chooses in a banner, never a
  native dialog; «ئىككى خاتىرە قىلىپ ساقلاش» (keep both) is the recommended
  choice. What a note opens on (server, this device's copy, or that choice) is
  `lib/notes/opening.ts`.
- **Result codes live in one place**, `lib/notes/save-protocol.ts`:
  `SAVE_CODES`, `CODE_STATE` and `SAVE_MESSAGES` (stage 3 adds `quota` and
  `rate` there). A failed session check is `failed` (retried), never
  `needs_account`.
- **Nothing over 900 KB is sent** (`MAX_SAVE_BYTES`): Server Actions refuse
  1 MB bodies, and `serverActions.bodySizeLimit` stays at its default.
- **The whole document is replaced in one helper**, the editor's
  `putDocument` — a direct, sanitized `innerHTML` write; the caller then
  tells the loop what the text is (`adopt(version)` for a server version,
  `change()` for an edit). Never `selectAll` + `insertHTML`.

## Workflow
Plan → new migration SQL (if schema changes) → code → `npm run typecheck` +
`npm run lint` + `npm run build` → Playwright smoke (mobile + desktop viewports) →
commit (English, conventional, one logical change) → push → Vercel auto-deploy →
verify the preview URL on a real phone.

## Environment Variables
`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY` (server-only), `ADMIN_EMAIL` (admin bootstrap),
`SITE_URL` (`https://bilimhezinisi.com` in production — see Project Overview).
**There is deliberately no `GEMINI_API_KEY`** — see AI Layer below.

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
7. **AI Layer**: each reader's own free Gemini key, held in their browser; model
   picker (strict), streaming chat/translate/summarize/ask ported from desktop
   prompts, per-reader usage shown to that reader. No server key, no admin usage
   dashboard (the owner never sees anyone's traffic — there is nothing to see).

## AI Layer (browser-only — do NOT rebuild this as a server proxy)
The reader's Gemini key lives in the reader's browser and nowhere else. This is a
decision, not an oversight; the design below is what is built, and reversing it would
put a bill on the owner and make us the custodian of other people's secrets.
- **No `GEMINI_API_KEY`. No AI route handler. No Server Action takes a key.** The
  browser calls `https://generativelanguage.googleapis.com` itself. That host is in
  `connect-src` in `lib/security/csp.ts` and is the ONLY thing AI added to the CSP.
- Verified 2026-08-26 from a page on our own origin: the endpoint answers cross-origin
  browser requests (`response.type === "cors"`, body readable) for
  `:generateContent` AND for `:streamGenerateContent?alt=sse`, with the key in the
  `x-goog-api-key` header — so the preflight passes too. Google's advice to proxy from
  a backend is about protecting the DEVELOPER's key; here the key is the reader's own.
- Everything AI keeps state in `localStorage` via `lib/ai/storage.ts`: the on/off
  switch (default OFF, forever, until the reader turns it on), four key slots, the
  chosen model, which slot last worked, and today's usage counters. `ai_usage` in
  Postgres stays empty.
- `lib/ai/client.ts` is the only place that talks to Google: SSE streaming, a 60 s
  watchdog, retry with backoff, and automatic failover down the four key slots on 429
  and 5xx. **Failover changes the KEY, never the MODEL** — the model the reader picked
  is the model that is called, always.
- Nothing logs a key, a prompt or an answer, on the client or the server.
- **No `temperature`, no `topP`, and no `thinkingLevel` on an ordinary request.**
  Google's Gemini 3 guide says to keep temperature at its default of 1.0 and warns
  that lowering it degrades performance; each model has its own documented default
  thinking level (`DEFAULT_THINKING_LEVEL` in `lib/ai/models.ts`). Overriding both —
  0.2–0.7 and `thinkingLevel: "low"` — is what made the Uyghur read as disjointed,
  and is why AI Studio answered better than this site. Sending nothing is how a
  default is kept. «چوڭقۇر مۇلاھىزە» asks for `high` explicitly and is offered ONLY
  for a model whose default is lower. Never re-add `thinkingBudget`.
- **A truncated answer is never shown as a finished one.** `finishReason` travels
  with the answer; anything but `STOP` gets a named Uyghur notice outside the answer
  card, plus «داۋاملاشتۇرۇش» where carrying on is possible. `modelVersion` is shown
  under every answer, and a model other than the one asked for is reported, not hidden.
- **`docs/ai-manual-check.md` is run by hand, with a real key, after any change under
  `lib/ai/`.** Every automated AI test mocks Google — they prove the plumbing, never
  the quality of the Uyghur. CI must keep spending nobody's quota.
- Exactly three models are offered (`lib/ai/models.ts`), each badged (ھەقسىز) or
  (پۇللۇق). A paid-only model on a key without billing gets its own named Uyghur
  message — never a generic error and never a silent downgrade.
- On 2026-08-31 the owner decided the on-page notices were too long for readers
  and had them removed: the privacy notice above the switch on `/my/ai`, the
  browser-storage note in the key slots, and the usage-counter caveat. The AI
  layer itself is unchanged — still bring-your-own-key and browser-only. A
  reader obtains their own key from Google and accepts Google's terms there.
- Three surfaces use it, all through the SAME transport: `/my/ai` (the switch,
  the four key slots, the model), the reader's panel
  (`components/reader/ai-panel.tsx`) and the notebook's workspace
  (`components/notes/ai-panel.tsx`). Adding a fourth means calling
  `askStream`/`chatStream` — never a new fetch to Google.
- **Prompts are ported VERBATIM from the desktop's `ai.js`** into
  `lib/ai/prompts.ts`, extracted mechanically rather than retyped. Do not
  reword them. Two bypass SYSTEM_BASE deliberately: translation (or "translate
  into Arabic" answers in Uyghur) and proofreading (its instructions are in
  English and must not be told to answer in Uyghur).
- **Proofreading applies whole or not at all.** `lib/ai/proofread.ts` numbers
  every visual line `⟦N⟧` and REJECTS a reply whose segments are missing,
  extra or reordered. A correction is previewed as a diff, applied only on a
  tap, and undoable in one. Blocks holding a citation or a Qur'an verse are
  never sent and never changed.
- The offline spellchecker (PROMPTs 10–12) is a SEPARATE feature and is not to
  be merged with, replaced by, or reopened for AI proofreading.

## Cost / Free-Tier Notes
- Supabase free projects PAUSE after ~7 days without requests → the daily Vercel cron
  hits `/api/health`, which is the keep-alive. There is **no upgrade, ever** — "free
  tier permanently" is a constraint, not a phase: the usage panel on `/admin`
  («ھەقسىز بوشلۇق ئەھۋالى») shows the headroom, and the library stays inside it.
- Auth email (confirmation, password reset) goes out through the owner's own Gmail
  as custom SMTP in the Supabase dashboard — the only sender allowed, no other mail
  vendor. Its App password is typed by him into that dashboard field and exists
  nowhere else: never in the repo, `.env*`, a log or a chat. Authentication → Rate
  Limits holds email at 20 an hour, because Gmail stops an account that sends more
  than 500 a day (20 × 24 = 480).
- Gemini costs the owner **nothing, by construction**: there is no server-side key and
  no AI server route, so no request the site makes is billable to anyone. A reader who
  wants the paid-only model enables billing on their OWN Google account; the site never
  asks for and never sees a payment detail.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
