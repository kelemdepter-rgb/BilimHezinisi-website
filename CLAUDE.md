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
`note_documents` (user_id, title, content_html sanitized, content_text, pinned_at,
deleted_at = in the trash, generated preview / content_length / content_bytes) — Notebook ·
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
- **Where the library is opened from: a tally, never a trace** (2026-10-22,
  migration 0033). `proxy.ts` reduces a page opening to the two-letter country
  code Vercel puts on the request (`x-vercel-ip-country`) and adds one to
  `public.country_visits (day, country, visits)`. **Nothing else may ever be
  stored or logged for it** — no IP, cookie, user agent, path, referrer, user
  id or session; no new column, no per-visit row, no analytics script. It
  counts a browser's full navigation (`Sec-Fetch-Dest: document`) on the
  production deployment only — not prefetches, the app's own fetches, bots,
  `/api`, `/auth`, `/admin`, previews or localhost (`lib/visits/count.ts`,
  unit-tested). It is page OPENINGS, not people, and /admin says so. Writes
  are batched per server instance (≤ 1 call per 5 s) and sent inside
  `event.waitUntil`, so no reader waits and a failure changes nothing they
  see; `lib/visits/record.ts` is deliberately a plain `fetch` RPC with the
  shared `fetchWithTimeout`, because `lib/supabase/admin.ts` is `server-only`
  and the proxy bundle is not known to honour that. The table and its three
  functions are service-role ONLY; the admin card (`CountryVisitsCard`,
  admin role only) reads through `lib/visits/data.ts`; the daily /api/health
  sweeps days past 366. The privacy page (summary + section 3), About and
  `tests/trust.spec.ts` say this in the owner's words — **change one, change
  all**, and move the privacy page's date.
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
  `SAVE_CODES`, `CODE_STATE` and `SAVE_MESSAGES`. A failed session check is
  `failed` (retried), never `needs_account`.
- **One account may not fill the database** (PROMPT-44, owner's numbers of
  2026-10-07): **200 notes and 5 MB per account** (UTF-8 bytes of title +
  HTML + text, the stored column `content_bytes`), enforced by the trigger
  `note_documents_quota` in migration 0030 under a per-account advisory lock
  (key 20261007). It raises exactly `note_quota_count` / `note_quota_bytes`
  → codes `quota_count` / `quota_bytes` (`blocked`; the device copy stays).
  An update no larger than before always passes, so anyone over a limit can
  shrink or delete; every row counts, trashed ones included once there is a
  trash. A write with no `auth.uid()` (service role, SQL Editor) is not
  limited, nor is a row that is not the caller's (RLS refuses it). The
  numbers are mirrored in `lib/notes/limits.ts`; the PGlite test fails if
  they differ. In front of it, per instance and keyed on the user:
  `NOTE_CREATE_RULE` 30/hour and `NOTE_SAVE_RULE` 600/10 min → `rate`
  (save: waits `RATE_RETRY_MS` = 60 s before ANY resend). Specs that only
  need a note to work in make it with `tests/fixtures/notes.ts` `newNote`
  (service role), never by pressing «يېڭى خاتىرە» — a run writes ~350
  notes as one staff account and would trip the create limit.
- **Nothing over 900 KB is sent** (`MAX_SAVE_BYTES`): Server Actions refuse
  1 MB bodies, and `serverActions.bodySizeLimit` stays at its default.
- **The whole document is replaced in one helper**, the editor's
  `putDocument` — a direct, sanitized `innerHTML` write; the caller then
  tells the loop what the text is (`adopt(version)` for a server version,
  `change()` for an edit). Never `selectAll` + `insertHTML`.

## Notebook editing (PROMPT-45 — a command does what it says)
- **Nothing rewrites a whole note through the editing commands.**
  Find-and-replace writes each hit with one `insertText` on that hit's own
  Range, last hit first (`replaceHits`, `lib/notes/find.ts`);
  `selectAll` + `insertHTML` merged a note's first block into everything
  after it (a heading swallowed the note, a citation's quote took it in).
  A whole document goes on screen only through the editor's `putDocument`.
  `tests/unit/note-whole-document.test.ts` fails on `selectAll` and on any
  `insertHTML` beyond the two caret insertions (citation, paste).
- **Several commands, one change:** the editor's `runBatch` lets each
  command's input event pass and runs autosave, the counts, the revision and
  the spellcheck once at the end; every toolbar command goes through it.
  Replace-all runs inside one, with the page held still. «ھەممىنى
  يېنىۋېلىش» runs that many native undos, compares the note with the
  snapshot taken before, and writes the snapshot back through `putDocument`
  if they differ; it goes with the next change of any kind, on closing the
  find bar, or once used.
- **Block style** is one menu — «ئادەتتىكى تېكىست» / «ماۋزۇ» / «نەقىل» —
  showing where the caret is. A heading becomes normal text with
  `formatBlock div`; a quote goes whole, with `formatBlock div` if it holds
  text and line breaks and `outdent` if it holds blocks
  (`lib/notes/blocks.ts`, measured in Chromium 151, Firefox 153 and WebKit
  26.5). One native undo step each. Known leftover: WebKit's `outdent` on a
  quote of mixed text and blocks — a shape none of the three engines makes
  by typing; it arrives by pasting — leaves an empty `<blockquote>`.
- **The phone header is two rows, ≤ 112 px** (below 640 px, menus, find
  bar and spell step row closed): back · title · save state · spellcheck · AI, then undo ·
  redo · bold · block style · list · «مەنبە قىستۇرۇش» · «باشقا
  ئىقتىدارلار». Italic, underline and find join the tool row from 640 px up
  and sit under «باشقا ئىقتىدارلار» below it (`useWideToolbar`) — one button
  in one place, never a copy in each. Undo and redo never go into the
  overflow; the back link wears `arrow-right`, never `undo`; no UI text
  names Ctrl+Z.
- **The spell popup follows its word** on scroll, resize and visualViewport
  changes, at most once a frame, and closes only when the word leaves the
  visible part of the page (below the toolbar, inside the visual viewport),
  on an outside tap, on Escape or on an edit.

## Notebook history (PROMPT-46 — every destructive action can be undone)
- **Earlier versions live in the writer's browser and nowhere else**:
  IndexedDB `bh-notebook`, store `versions` (`lib/notes/history.ts`), index
  `[userId, noteId, at]`. Never Supabase — a server-side history would
  multiply every note inside the 500 MB database. Never sent, never logged;
  shown only through `sanitizeNoteHtml`.
- **When a version is taken**: `open` (what the note opened on), `auto`
  (after a CONFIRMED save — the save loop's `onConfirmed` — at most every 5
  minutes per note), `before-replace-all` (the find bar's snapshot),
  `before-ai` (right before a proofread is applied), `before-restore`
  (before a version or the AI undo is put back) and `before-conflict` (both
  choices: «ئىككى خاتىرە…» keeps this version; «مېنىڭ نۇسخام…» fetches the
  server's with `loadNoteAction`, keeps it, and saves over EXACTLY that
  version — `keepMine(updatedAt)` — so a later one is a conflict again).
  A version identical to the note's newest is never stored twice; a
  `before-*` reason relabels an identical newest `open`/`auto` version
  instead, so a note opened and at once replaced-all is found under
  «ئالماشتۇرۇشتىن بۇرۇن».
- **Limits**: 30 versions a note, 20 MB for the store (2 × the characters of
  title + HTML, a running total in store `meta`). Evicted: the oldest `auto`
  first, then the oldest of any reason — never a note's newest.
- **Fails soft, never waited on**: no IndexedDB, a refused one, a full disk or
  an open that never answers (3 s) → `unavailable`, never an exception. The
  editor starts the write and moves on; saving never waits for it. Tests and
  scripts must never CREATE `bh-notebook` (a database of that name without
  the stores leaves the history unavailable) — abort the upgrade instead.
- **Putting a version back** = `before-restore`, then the editor's
  `putDocument`, then `change()`: saved like an edit, conflict check intact.
  The AI panel's undo goes through the editor (`onRestore`) too — the panel
  never writes `innerHTML` itself.
- **Cleared on sign-out** (the sign-out form empties the store first, waiting
  at most 1 s, and works without JavaScript), **on account deletion** (once
  the server confirmed — `finishPendingDeletion()` returns true), and by
  «تازىلاش» on /my/account (two taps, inline). Unsaved drafts
  (`bh-note-draft-v2:`) are never touched by any of these.

## Notebook list and trash (PROMPT-47)
- **Deleting is moving to the trash** (`deleted_at`, migration 0031): at
  once, no question, with «قايتۇرۇش» in the row's own place for 10 s. A note
  is deleted for good only from /notes/trash, always in two steps in an
  inline box — never a native dialog — or after `note_trash_days()` = 30
  days (`NOTE_TRASH_DAYS`), by `purge_note_trash` from /api/health
  (production only, 500 a day, last and only while the run has time, the
  count alone logged) or when the writer opens the trash. **The trash still
  counts against the quota**, and the quota messages say so.
- **Pinning and the trash are not edits.** `note_documents_set_updated_at`
  fires only on `title, content_html, content_text`; `updated_at = created_at`
  means "never saved". Never move `updated_at` for anything else — open
  editors would see a conflict.
- **A save never writes into the trash** (`deleted_at is null` in its
  filter) → `in_trash`: the editor holds still, keeps the device copy, and
  «قايتۇرۇش» → `SaveLoop.resume()`. A trashed note's URL opens read-only
  (`TrashedNoteView`), with no save loop at all.
- **The list never downloads a body**: the stored `preview` (160
  characters), `content_length`, `content_bytes`. One read gives the notes
  and the trash (`loadNotebook`); the usage line counts both.
- **`search_my_notes`** is SECURITY INVOKER, one literal phrase, 2–100
  characters, 50 rows, pinned first. It never normalizes the notes: the
  normalized query becomes a pattern accepting exactly what `ug_normalize`
  folds (alif forms, marks between letters, whitespace runs, case), every
  other character escaped. tests/unit/note-list-sql.test.ts compares it with
  strpos over ug_normalize on generated texts; **if ug_normalize ever
  changes, change the pattern with it.** 0.1 s at 200 × 60,000 characters
  on the local stack (docs/notes-search.md; plain strpos took 2 s). What is
  typed is never stored or logged; `NOTE_SEARCH_RULE` 60/min per writer.
- **Title order**: `Intl.Collator("ug")` where the engine has it (Firefox,
  Safari); Chromium has none and gets the same CLDR order from
  `uyghurSortKey` (ئ first, then the alphabet) — never code-point order.
- **Untouched new notes go**: leaving inside the app asks
  `discard_note_if_empty` (default title, no text, `updated_at =
  created_at`; the server decides) — the back arrow waits for it, any other
  exit asks once React has really unmounted (never from an effect cleanup
  directly: development runs every cleanup once after mounting), never while
  another tab holds the note's Web Lock, and **never on pagehide** (it fires
  on a reload). The list tidies notes still untouched a day after they were
  made.
- Dates in the list are the reader's local time (`LocalTime`, filled in the
  browser), never a UTC slice. /my/notes is «كىتابتىكى خاتىرىلىرىم» — a
  different name and icon from «خاتىرە دەپتىرىم».
- The list's search box is read-only until the page has hydrated
  (`useHydrated`); a word typed before that was kept on screen and never
  searched. Specs wait for `[data-testid="notes-controls"][data-ready="true"]`
  (the trash: `[data-testid="trash"][data-ready="true"]`) before any tap.
- `logging.serverFunctions` stays `false` in next.config.ts: in development
  Next otherwise prints every Server Action's arguments — note HTML, search
  words — to the terminal.

## Notebook spelling (PROMPT-48 — nothing of it on the server)
- **Everything the spellchecker remembers lives in this browser**: the
  switch `bh-spell-on` ("1"/"0", `lib/spellcheck/toggle-store.ts`), the
  personal dictionary `bh-personal-dictionary` (browser-wide, not per
  account), and the words ignored in one note
  `bh-spell-ignore:<userId>:<noteId>` (≤ 500 a note,
  `lib/spellcheck/ignore.ts`). No table, no Server Action. A device change
  is what export/import is for. The ignore lists go with the account in
  `finishPendingDeletion`; the personal dictionary and the switch stay.
- **Stepping** is a row in the sticky header, like the find bar, **never
  open by default** (the phone header stays ≤ 112 px): from
  «بىر-بىرلەپ كۆرۈش» beside the summary and from «باشقا ئىقتىدارلار»
  (which switches the checker on). «كېيىنكى» = first mark after the cursor,
  wrapping; the cursor is a collapsed LIVE Range (edits before it move it),
  set at each word stepped to and at the caret on open or tap. The word is
  scrolled INSTANTLY to the middle of the visual viewport below the header
  (a smooth scroll would close the popup it opens). None left →
  «ئىملا خاتالىقى قالمىدى.», closed after 2 s. No F7: Chrome and Firefox
  use it for caret browsing.
- **«بۇ خاتىرىدە سەل قارا»** is applied after the verdict cache, which stays
  about the dictionary alone — the same word in another note is still
  asked about and still marked.
- **The personal dictionary is one external store**
  (`lib/spellcheck/personal-store.ts`) for the popup, the panel, the running
  checker and other tabs (storage event). A change reaches the worker at
  once and drops exactly the cached verdicts it changes: the word itself,
  and hyphenated words with it as a half. The panel («شەخسىي لۇغەت», the
  history panel's sheet/side shape) imports a chosen file as untrusted
  input (`mergeImport`): JSON array only; each entry exactly one
  `WORD_PATTERN` token of 2–64 characters; ≤ 5,000 words after merging;
  repeats dropped, everything else counted as rejected; never run, never
  rendered as HTML. Export is `bilim-hezinisi-lughet.json`, a JSON array.
- **Glued entries are a hint, never a removal**: 8+ letters, not accepted
  by the checker, splittable into two dictionary words of 3+ letters
  (`lib/spellcheck/glued.ts`, in the worker only — it pulls in the checker,
  so the page must never import it).
- **Quoted material is one definition**, `QUOTED_SELECTOR` in
  `lib/notes/quoted.ts` (`a[href]` and the Uthmani face): the AI proofreader
  never sends a unit holding it, and the spellchecker neither asks about
  nor marks a token touching it (`quotedSpans`). A citation's passage — the
  `<blockquote>` before its link — is NOT quoted by this definition, so both
  still look at it.

## Notebook links, outline and painter (PROMPT-49)
- **A tap on a link in a note opens the link card**
  (`components/notes/link-popover.tsx`) — nothing in a contentEditable
  follows a link (N10): its text, where it goes (`describeLink` in
  `lib/notes/links.ts`: «كىتاب: «ماۋزۇ» — 3-بەت» from the citation's own
  label, «قۇرئان: 2:255», otherwise the host name), «ئېچىش» and
  «ئۇلىنىشنى ئېلىۋېتىش». Ctrl/Cmd+click opens at once. The spell popup
  never opens for a tap on a link.
- **Only http(s) addresses and this site's paths are ever opened**, and only
  through `openLink` — a new tab, `noopener,noreferrer`. Any other scheme, or
  a user name before the host, is shown as written and never opened.
- **Unlinking is one `execCommand("unlink")` over the link's whole text**:
  the text stays, one «يېنىۋېلىش» puts the link back.
- **Boxes anchored to the note share one rule**,
  `components/notes/anchored.ts`: measured, then placed below or above the
  anchor, never over the toolbar or under the keyboard; they follow it on
  scroll and resize (page and visual viewport) at most once a frame and go
  only when it leaves the visible part. The spell popup and the link card use
  it; a third box does too.
- **«مۇندەرىجە»** lists `h1`–`h4` (`lib/notes/outline.ts`), empty ones left
  out, indented from the note's highest level, re-read 300 ms after each
  change. A tap puts the heading 8 px below the sticky header with the caret
  at its start; on a phone the sheet closes first, then the jump is made.
  The sheet frame is `components/notes/note-panel.tsx` (history and outline).
- **The format painter carries only what a note can keep**
  (`lib/notes/painter.ts`): bold, italic, underline, and a colour only when
  the text has one of its own — never the theme's ink, which would stay dark
  in the dark and sepia themes. It paints with the toolbar's own commands in
  one `runBatch`, never a styled span (`font-weight` and `text-decoration`
  do not survive the allow-list): at most two commands a property, one
  «يېنىۋېلىش» each; a heading's boldness is never touched. Two taps — the
  second, «فورماتنى بېرىش», in a header row that is never open by default.

## Notebook export (PROMPT-50 — in the browser, never on a server)
- **«چىقىرىش»** (`components/notes/export-menu.tsx`) is a header row that
  takes the overflow's place, never open by default and never a popover
  below the overflow (that pushed the sticky header past a 375×667 screen):
  «Word (.docx)», «PDF / بېسىپ چىقىرىش», «Markdown (.md)», «تېكىست (.txt)»
  and the switch «مەنبەلەرنى ئاستى ئىزاھات قىلىش» (`bh-note-export-footnotes`,
  `lib/notes/export-prefs.ts`; off by default; Word AND Markdown follow it).
  The menu is `lazy()` and does the exporting itself; the editor only lends
  it the note (`read`) and prefetches it 3 s after load, so it is cached for
  printing offline. Each writer is a dynamic `import()` inside it. The note
  page's first-load JavaScript grew 1,953 B (635 B gzip) with all of this —
  measure `.next/diagnostics/route-bundle-stats.json` before and after any
  change here (Next 16's build output no longer prints sizes), and keep
  anything new out of the editor's static imports: Turbopack keeps a whole
  module, unused exports included. No route converts a note, ever.
- **Word walks blocks recursively over `BLOCK_TAGS`**
  (`lib/notes/export-docx.ts`): every block its own paragraph, a `<br>` a
  `w:br`, an empty line an empty paragraph, a block's last `<br>` nothing;
  list items at their depth (`w:ilvl`), and **every `<ol>` its own numbering
  definition** — two `w:num` over one definition continue each other's count
  in Word. Tables are `w:bidiVisual` with gridSpan/vMerge. Only what is ON is
  written to a run (`bold: false` would undo a heading's bold).
- **`w:jc` in a right-to-left paragraph is logical**: CSS right/start →
  `left`, left/end → `right`, centre, justify → `both`; indents use `w:left`
  (the start side). Checked in LibreOffice's DOCX import and export;
  pinned in tests/unit/docx-export.test.ts. Never "fix" it to physical.
- **Word's defaults are the notebook's typography**: the first family of
  `NOTE_FONT_STACKS[font]` in all four `w:rFonts` slots, size × 0.75 pt
  (`w:sz` and `w:szCs`), line height as an at-least spacing, title and
  headings scaled from the body. Fonts are named, never embedded, by the
  name inside the font file: «Uthmanic Hafs» is only our `@font-face` alias,
  so a verse is written as the stack's next name, «KFGQPC Uthmanic Script
  HAFS» (`WEB_ONLY_FAMILIES`) — checked in Word itself.
- **A citation is `isCitationParagraph`** (`lib/notes/insert.ts`): a `<p>`
  holding only a link to `/books/N/read…` or `/quran/N?aya=N`.
  `takeCitations` (`lib/notes/export-shared.ts`) turns each into a mark at
  the end of the passage before it and a footnote of label + absolute
  address. Every exported link is `describeLink(...).url` — absolute, http(s)
  or this site — or only its words.
- **Markdown** wraps `createTurndown()` and never changes its rules (they are
  the upload pipeline's). **Text** follows the line map's rule (block edges
  and `<br>` end lines), keeps empty lines, sets paragraphs off with a blank
  line, and is UTF-8 with a BOM and CRLF. Every format ends with the Qur'an's
  credit when a verse is quoted; Markdown and text name an untitled note
  «يېڭى خاتىرە».
- **Print**: `window.print()`; on paper `[data-note-page]` keeps only the
  note (`.md-body`) and what is `print:block` in `<main>` (the print-only
  title, the credit) — rules in the `@media print` block of
  app/globals.css, not `print:` classes on the editor. The print colours
  name `:root[data-theme]` and `:root:not([data-theme])` too, or the dark
  theme's ink outranks them.

## In-book links (PROMPT-51 — a Word contents page and its notes, followed)
- **A `#fragment` link in a book is followed by the reader, never by the
  browser**: one delegated click on `reader-content` (`.md-body a[href^="#"]`,
  primary button, no modifier keys), `preventDefault`, no hash and no history
  entry. Everything else is `lib/reader/link-session.ts`, loaded on the first
  touch of such a link; the reader keeps the click, `goToPage(page, find)`,
  the bottom bar's status line and «قايتىش» — +1,983 B first-load (gzip
  +645). The session borrows the reader's search and matcher through
  `LinkHost` instead of importing them: a module shared with the lazy chunk
  stops being folded into the reader's and costs ~0.8 KB of wrappers.
- **Targets are worked out from the stored text, at click time.** mammoth
  writes a Word bookmark as an empty `<a id>` that turndown drops, so no
  stored book has its targets. `public.book_outline(p_book_id)` (migration
  0032) lists a book's headings, `#`-links and code fences — SECURITY
  INVOKER, RLS-bound, ONE jsonb value (anon's answers stop at 1,000 rows),
  ≤ 5,000 entries, no search slot (one book's pages by primary key).
  `lib/reader/outline.ts` is its twin; `tests/unit/book-outline-sql.test.ts`
  holds the two equal. `lib/reader/internal-links.ts` resolves: a note by the
  link carrying its reciprocal fragment (`footnote-N` ↔ `footnote-ref-N`,
  `endnote-…` likewise), then a GitHub-style slug, then the label aligned
  with the headings — exact, enumeration stripped, or a word-boundary prefix
  of ≥ 8 characters — forward from each link with a cursor that only moves on
  an exact hit, then from the start of the book (a contents page at the end),
  then each on its own (a back-reference).
- **Never** add markers to `book_pages.content`, ids to markdown-it's output
  or a stored anchor table, and never change the import for this: every
  consumer of the text would have to learn to strip them. The printed Word
  page numbers after the links are the book's text and stay.
- **A landing is held where it was put** until the layout has been quiet for
  1.5 s, the reader takes over (wheel, touch, key, press) or 12 s have passed:
  corrected in a ResizeObserver, before paint, while `loadAround("before")`
  skips its own scroll compensation (`pinnedRef`) — both would move it
  twice. `loadAround` adds pages only to the window it fetched them for and
  never runs twice at once (`loadingAroundRef`): two scroll events before
  the re-render used to add the same pages twice. A heading lands 8 px below
  the toolbar's measured bottom, a note in the middle of the free space; both
  flash and take focus.
- **When the book does not say**: the function missing (404 / PGRST202,
  remembered for the visit) or nothing resolved → the label, without its
  number and page, is searched with `book_match_pages` and the first
  occurrence after the link is shown as the find bar shows it; busy →
  `SEARCH_BUSY_TEXT`; offline → the loaded pages' own outline, else
  «تور ئۈزۈلدى — بۇ ئورۇنغا ھازىر بارغىلى بولمايدۇ.»; nothing →
  «بۇ ئۇلانما كۆرسەتكەن ئورۇن كىتابتىن تېپىلمىدى.». These, and
  «يۈكلىنىۋاتىدۇ…» after 250 ms, are the bottom bar's status line (8 s each)
  — the error line above the text is out of sight halfway down a contents
  page. Never a dialog.
- `tests/reader-links.spec.ts` reads a seeded DRAFT (`e2eLinks` prefix) and
  answers both functions itself. Only the setup and the teardown sweep that
  prefix (`removePrefixedBooks(admin, ALL_PREFIXES)`): the batch and wizard
  specs clear `BATCH_PREFIX` around their own tests, and a draft swept
  mid-run is gone before the next viewport reads it.

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
