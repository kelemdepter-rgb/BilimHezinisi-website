# PROMPT 5 — قۇرئان بۆلۈمى (Quran Module)

## قانداق ئىشلىتىسىز (يېڭى تۈر ئېچىپ)
1. Claude Code نى ئېچىڭ ۋە **BilimHezinisi-website** قىسقۇچىنى تاللاڭ
   (`E:\ditallar\men yasigan ditallar\BilimHezinisi-website`).
   دېسكتوپ دېتال قىسقۇچىمۇ (`E:\ditallar\men yasigan ditallar\bilim hezinisi\bilim hezinisi pc`)
   تاللانسا تېخىمۇ ياخشى — ئۇ پەقەت **ئوقۇش ئۈچۈن** پايدىلىنىش مەنبەسى.
2. سىزىقتىن تۆۋەنكى تېكىستنى پۈتۈنلەي كۆچۈرۈپ چاپلاڭ.

---

You are continuing an existing, live project. Read `CLAUDE.md` in this folder FIRST —
it is the project instruction and always wins — and use the **bilim-web** skill
(`.claude/skills/bilim-web/SKILL.md`).

## Where the project stands right now (Phases 1–4 are DONE and deployed)
Live at `https://bilim-hezinisi-website.vercel.app` (Vercel Hobby + Supabase Free,
GitHub `kelemdepter-rgb/BilimHezinisi-website`).

Already built and working — **do not rebuild or "improve" any of it unless a task below
says so**:
- **Phase 1:** Next.js App Router + TS + Tailwind; manuscript design tokens ported from
  the desktop app (light / dark / sepia); RTL shell with top bar + category sidebar
  (drawer on mobile); self-hosted fonts in `public/fonts/` (UKIJ Ekran, Traditional
  Arabic, Bahij Nazanin, **UthmanicHafs1 / UthmanicHafs1B — already there, for the
  Quran**); Supabase Auth with `admin` / `uploader` / `reader` roles; RLS on every
  table; `ug_normalize()` + `search_books` / `search_quran` RPCs.
- **Phase 2:** admin category tree, book upload wizard, book management, user roles.
- **Phase 3:** public library home (grid/list, category filter, recent reads), book
  detail, the reader (lazy page loading, themes, font controls, position restore,
  bookmarks, notes, in-book search, print), global search page.
- **Phase 4:** PDF and OCR removed entirely (accepted formats: `.docx`, `.doc`, `.md`,
  `.html`/`.htm`, `.txt`, web URL); content stored as **Markdown**
  (`books.content_format = 'markdown' | 'text'`); free-tier hardening — database
  shrunk to ~184 KB/book, covers via `next/image` + CDN caching, daily Vercel cron on
  `/api/health` so Supabase never pauses, admin usage panel, `scripts/backup.mjs` +
  `scripts/restore.mjs` + `ZAPASLA.bat`.

**Hard constraint that still applies: the owner has no budget, ever.** Everything must
stay inside Supabase Free (500 MB DB / 1 GB storage / 5 GB egress) and Vercel Hobby.
No paid service, no new vendor account. The Quran data must be added with this in mind.

Now execute **Phase 5 — the Quran module**.

## 0. Read before coding
- `supabase/migrations/0001_init.sql` — `quran_suras`, `quran_ayas` (note `text_norm`
  is a stored generated tsvector) and the existing `search_quran` RPC.
- Desktop reference (READ-ONLY, never modify):
  `../bilim hezinisi/bilim hezinisi pc/src/quran.js` and `src/quran.css` for behaviour
  and styling; `scripts/seed-quran.js` for the exact data pipeline (`SURA_META`,
  `stripTashkil`, `stripBasmalaPrefix`, `cleanUyghurTranslation`, `parseUyghurXml`).
- Also check how Phase 4 changed `book_pages` (the stored tsvector column was replaced
  by an expression index). Apply the SAME lesson to `quran_ayas` — see task 2.

## 1. Seed the Quran data (once, safely)
- Source files live in the desktop app at `assets/seed/`:
  `quran-uthmani-hafs.txt` (Uthmani Arabic) and `uyghur_saleh_v1.0.2-xml.1.xml`
  (Uyghur translation by Muhammad Salih). Copy them into `migration-data/` in THIS
  project (gitignored) — never read from or write to the desktop folder at runtime.
- Write `scripts/seed-quran.mjs` (service-role, batched ≤500 rows, **idempotent and
  resumable** — running it twice must not duplicate ayas). Port the desktop logic
  exactly: `SURA_META` (114 suras with `name_ar`, `name_ug`, `name_translit`,
  `revelation`, `aya_count`), `stripTashkil` for `text_ar_simple`, basmala handling,
  and the Uyghur XML parser.
- **Verify integrity before declaring success**: 114 suras, 6,236 ayas, every sura's
  aya count matches `SURA_META`, no empty `text_ar`, and the Uyghur translation is
  present for every aya (report any gaps rather than hiding them).
- Report the exact database size added by the Quran, and the remaining free-tier
  capacity afterwards, using `scripts/db-usage.mjs`.

## 2. Keep it small (free-tier discipline)
In a NEW migration, apply the Phase-4 optimisation to the Quran tables too: replace the
stored `text_norm` tsvector column on `quran_ayas` with an **expression index**
(`gin (to_tsvector('simple', ug_normalize(text_ar_simple || ' ' || text_ug)))`) and
update `search_quran` to match, so the index is still used (`explain analyze` must show
an index scan). Measure and report before/after.
Do NOT add a trigram index over the Quran text.

## 3. Mushaf view (`/quran`) — public, no login needed
Mirror the desktop app's Quran view, responsively:
- Sura list in the sidebar (number, Arabic name, Uyghur name, aya count, Meccan/Medinan),
  with a filter box that matches Arabic name, Uyghur name and number.
- Sura page (`/quran/[sura]`) rendering the ayas with:
  - Arabic in the **UthmanicHafs** font (already in `public/fonts/` — add the
    `@font-face` if it is not declared yet), correct line height for tashkil.
  - Uyghur translation under each aya, toggleable (Arabic only / Uyghur only / both).
  - Aya numbers in Arabic-Indic numerals, styled like the desktop app.
  - Basmala shown as a heading where the desktop app shows it (not as part of aya 1),
    following `stripBasmalaPrefix` behaviour.
  - Font-size control and the three themes, reusing the reader's existing controls and
    design tokens — do not invent new UI.
- Navigation: previous/next sura, jump to sura+aya, and deep links `/quran/2?aya=255`
  that scroll to and highlight that aya.
- Copy actions on an aya: copy Arabic, or copy Arabic + Uyghur translation, matching
  `copyAyaToClipboard` in the desktop app. Show a short Uyghur confirmation toast.
- Signed-in users can bookmark an aya (reuse the existing bookmarks concept; if the
  schema needs a Quran-capable bookmark, add it in a NEW migration without breaking
  book bookmarks). Anonymous visitors get everything except bookmarks.

## 4. Quran search
- Use the existing `search_quran` RPC (updated per task 2). Search box on `/quran`
  searching Arabic (normalized, so a query with or without tashkil/hamza variants
  matches) and the Uyghur translation together.
- Results show sura name + aya number + highlighted snippet; clicking opens the sura at
  that aya. Support the same quoted-phrase / OR / exclusion operators as book search.
- Make sure Quran search does not pollute book search and vice versa; if the global
  search page shows both, separate them into clear sections.

## 5. Wire it into the app
Add «قۇرئان كەرىم» to the main navigation (top bar and mobile drawer) using the existing
icon sprite. It must be reachable in one tap on a phone.

## 6. Mobile rules (HARD — CLAUDE.md)
`100dvh` not `100vh`; safe-area padding on fixed bars; ≥44 px touch targets; no
horizontal scroll at 360 px even with long Arabic lines; the sura-list drawer uses
`overscroll-contain` and must not trap body scroll; **after scrolling down and back up,
every control (font size, theme, translation toggle, copy, navigation) must still be
visible and tappable.**

## 7. Tests (mandatory before you call this done)
- `npm run typecheck && npm run lint && npm run build` pass; all existing unit and
  Playwright suites still green.
- New unit tests: `stripTashkil`, basmala handling, sura/aya counts from the seeder.
- New Playwright tests at 375×667, 390×844, 1280×800: `/quran` lists 114 suras; opening
  Al-Fatiha shows 7 ayas with the Uthmanic font; the translation toggle works; a search
  for a known phrase finds the right aya and clicking it lands on that aya; copy works;
  no horizontal overflow; controls survive scroll down + up.

## 8. Then walk me through it (simple Uyghur, one step at a time)
Tell me exactly what I must do myself: copy the two seed files into `migration-data/`,
apply the new migration, run the seeder, verify on my phone, and run `ZAPASLA.bat`
afterwards so the Quran data is in my backup too.

## Acceptance criteria
- 114 suras / 6,236 ayas present and verified, with the Uyghur translation.
- `/quran` works logged-out, reads beautifully on a 375 px phone in all three themes.
- Quran search finds ayas by Arabic (with or without tashkil) and by Uyghur text.
- Database growth is reported, and the free tier still has clear headroom.
- Nothing from Phases 1–4 regressed — the book library, reader and search are untouched.
- Do NOT start Phase 6 (Notebook + spellcheck) or the AI layer.

Commit per logical step with English conventional messages. Ask me only when a decision
is genuinely mine; otherwise follow CLAUDE.md defaults.
