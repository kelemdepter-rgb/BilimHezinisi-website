# PROMPT 14 — تورسىز ئوقۇش (PWA) + كىتابنى چۈشۈرۈش + ئۈلەشتۈرۈش

## قانداق ئىشلىتىسىز (يېڭى تۈر ئېچىپ)
1. Claude Code نى ئېچىپ **BilimHezinisi-website** قىسقۇچىنى تاللاڭ، ھەمدە دېسكتوپ دېتال
   قىسقۇچىنىمۇ قوشۇپ تاللاڭ (`bilim hezinisi pc`) — پەقەت ئوقۇش ئۈچۈن پايدىلىنىش مەنبەسى.
2. سىزىقتىن تۆۋەنكى تېكىستنى پۈتۈنلەي كۆچۈرۈپ چاپلاڭ.

> **بۇ نېمە بېرىدۇ:** ①ئىنتېرنېت ئۈزۈلسىمۇ ئوقۇغان كىتاب ئېچىلىدۇ ۋە سايت
> تېلېفوننىڭ باش ئېكرانىغا قاچىلىنىدۇ؛ ②كىتابنى Word ياكى تېكىست قىلىپ چۈشۈرگىلى
> بولىدۇ (سايت بىر كۈنى ئىشلىمەي قالسا ئوقۇرمەندە نۇسخا قالىدۇ)؛ ③بىر بەتنى ياكى
> بىر ئۈزۈندىنى دوستىغا ئەۋەتكىلى بولىدۇ. ئۈچىلىسى ھەقسىز، ھەمدە ①بولسا
> egress نى **ئازايتىدۇ**.

---

You are continuing an existing, live project. Read `CLAUDE.md` in this folder FIRST —
it is the project instruction and always wins — and use the **bilim-web** skill.

## Project context (Phases 1–13 are done and deployed)
Live at `https://bilim-hezinisi-website.vercel.app` — a free public Uyghur digital
library. Next.js App Router + TypeScript + Tailwind on **Vercel Hobby**, data in
**Supabase Free**. GitHub `kelemdepter-rgb/BilimHezinisi-website`.

Already built — do not rebuild or redesign any of it: manuscript design tokens
(light/dark/sepia), RTL shell, Supabase Auth with `admin`/`uploader`/`reader`, RLS on
every table, `ug_normalize()`, admin category tree + upload wizard + user roles, library
home, book detail, reader (lazy pages, themes, font controls, position restore,
bookmarks, notes, in-book search, print), global exact-phrase search with jump-to-match
and «ئالدىنقى»/«كېيىنكى» navigation, Qur'an module, desktop-library migration, SEO,
rate limiting, notebook with autosave + DOCX export + Uyghur spellcheck, and the
licence/trust work from PROMPT 13 (fonts, attribution, `/about`, `/privacy`, password
reset, account deletion, security headers).

## Non-negotiable constraints
- **No budget, ever.** Supabase Free (500 MB DB / 1 GB storage / 5 GB egress / 50,000
  MAU / project pauses after 1 week idle) + Vercel Hobby (cron minimum interval once per
  day; the daily `/api/health` cron is already at that limit). No paid service, no new
  vendor account, not now and not later.
- Anonymous browsing, reading and search must keep working with **no account**. Every
  feature in this prompt must work for a signed-out visitor unless stated otherwise.
- RTL Uyghur UI; code, comments and commit messages in English.
- No PDF, no OCR, no new runtime third-party CDN or script. Search operators stay
  removed. Desktop repo is read-only reference.
- All Mobile Rules in `CLAUDE.md` apply. Do not weaken the CSP added in PROMPT 13 —
  extend it deliberately if a new source is genuinely needed, and say so.
- New migrations are NEW files in `supabase/migrations/`; never edit an applied one.

---

# PART A — Offline reading (PWA)

There is currently no `manifest`, no service worker and no app icon: the site cannot be
installed and dies the moment the connection drops.

## A1. Installable

- A web app manifest with the Uyghur name «بىلىم خەزىنىسى», short name, `lang: "ug"`,
  `dir: "rtl"`, `display: "standalone"`, `start_url: "/"`, and theme/background colours
  taken from the existing design tokens (`--bg`, `--am`) so the splash matches the
  manuscript palette in light mode.
- Icons at 192 and 512, plus a maskable variant, generated from the desktop's
  `assets/icon.png` (do not draw a new logo).
- Apple touch icon and the meta tags iOS needs, since a large part of the audience is on
  iPhone where installation is manual.

## A2. Service worker — hand-written, no new dependency

Write `public/sw.js` yourself and register it from a small client component. **Do not
add `next-pwa` or any similar package** — one more build-time dependency that may not
track Next 16 is not worth it here.

Caching rules, in this order of importance:

1. **Never cache anything private or privileged.** No `/admin` route, no Supabase auth
   response, no Server Action response, no per-user data (bookmarks, notes, progress,
   notebook). If in doubt, do not cache it. A cached page that shows one reader another
   reader's state would be a serious failure.
2. **App shell** — precache the minimum needed to boot: the shell, the CSS, the icon
   sprite, and the woff2 font actually used for first paint. Nothing else.
3. **Book pages the reader has actually opened** — cache them as they are fetched
   (stale-while-revalidate). Do not pre-fetch a whole book behind the reader's back;
   that spends their mobile data and our egress without being asked.
4. **Covers** — cache-first with a bounded number of entries, evicting the oldest.
5. **Everything else** — network-first with a cached fallback.

Also required:
- A **versioned cache name** and cleanup of old versions on `activate`.
- An **offline fallback page** in Uyghur that explains what is and is not available, and
  links to whatever the reader already has cached.
- An **update flow**: when a new service worker is waiting, show an unobtrusive Uyghur
  toast «يېڭى نۇسخا تەييار — يېڭىلاش» that activates it on tap. A reader must never be
  stuck on a stale build with no way out.
- A way to **clear the offline cache** from `/my/account`, with the current size shown,
  so a reader on a small phone can reclaim space.

## A3. What must work with the network off

Test this properly, with the browser's network genuinely disabled:
- a book the reader opened before still opens and scrolls, at the page they were on;
- the reader's font size, line height and theme still apply;
- search, and any book never opened, fail with a clear Uyghur message — not a blank
  screen, not an English browser error;
- signing in while offline fails with a clear Uyghur message.

## A4. Report the egress effect

Measure and report: how many bytes a first visit costs, and how many a repeat visit
costs, before and after. The point of this work is partly that it should *reduce* our
5 GB/month egress. If it does not, say so plainly.

---

# PART B — Download a book

The desktop reader has TXT / DOCX / PDF download buttons. The web has only a print
button (the download icon in `components/reader/reader.tsx` around line 730 actually
calls `window.print()`).

## B1. What to build

In the reader toolbar and on the book detail page, offer **DOCX** and **plain text /
Markdown**. No PDF — that stays out of the web edition.

- The `docx` package is already a dependency and `lib/notes/export-docx.ts` already
  shows the working pattern for the notebook. Reuse that approach.
- **RTL correctness is the whole point.** Port the bidi settings from the desktop's
  `export-as-docx` handler in `main.js` (~line 903): right-aligned paragraphs, RTL run
  properties, and a font the reader will actually have. A DOCX that opens
  left-to-right in Word is a failed feature, not a partial one.
- Include the title, author and a source line naming the site and the book's URL.
- Markdown books must export with their formatting intact (headings, lists, quotes,
  tables); `content_format: "text"` books export as plain text.

## B2. Cost discipline

Downloading a book means fetching every page, which is real egress. Therefore:
- only for `status = 'published'` books;
- generate the file **in the browser** from pages fetched through the normal reader
  path — no new server route that streams whole books;
- reuse pages already cached by Part A instead of re-fetching them;
- apply `lib/rate-limit.ts` to whatever endpoint serves the remaining pages, and cap how
  many full-book downloads one visitor can trigger in a short window;
- show progress for a long book and let the reader cancel.

Report the measured egress cost of downloading your largest test book.

---

# PART C — Sharing

The owner wants this library to spread. It has no advertising budget, so sharing has to
be the distribution.

## C1. Share a book or a page

- A share control on book detail and in the reader. Use `navigator.share` where the
  browser supports it, and fall back to copying the link with an Uyghur confirmation
  toast.
- The reader's share link must carry the current page (`/books/[id]/read?page=N`) and
  opening that link must land on that page. Verify it works from a cold load, signed
  out.
- The Open Graph and JSON-LD metadata already added for book pages must also be correct
  for a `?page=N` link — check, and fix if it is not.

## C2. Quote card

Selecting text in the reader offers «نەقىل رەسىمى»: render the selected passage to a
PNG on a `<canvas>` and let the reader save or share it.

- Manuscript palette, RTL, correct Uyghur shaping, the site's own font — a card that
  renders Uyghur badly is worse than no card.
- Includes book title, author, and the site name so the image itself carries the source.
- Sensible limits: cap the selection length with a friendly Uyghur message, and pick a
  size that looks right when posted to a messaging app.
- Entirely client-side. No image generation on the server, no external service, no new
  dependency if a plain `<canvas>` will do.
- Must work by **tap** on a phone, not only by mouse selection — no hover-only
  affordance. This is a hard mobile rule.

---

# Tests and reporting (mandatory)

- `npm run typecheck && npm run lint && npm run build` all pass.
- Existing unit and Playwright suites stay green at **375×667, 390×844 and 1280×800**.
- New Playwright coverage at all three viewports:
  - the manifest and service worker register, and the install criteria are met;
  - with the network disabled, a previously-opened book still opens at the right page,
    and an unopened book shows the Uyghur offline message;
  - a waiting service worker surfaces the update toast and activating it works;
  - DOCX and text download both produce a non-empty file for a Markdown book and for a
    plain-text book;
  - the share control is reachable by tap, is never covered by a sticky bar after
    scrolling down and back up, and `?page=N` deep links land correctly;
  - the quote card can be produced from a tap-driven selection;
  - **no `/admin` route and no per-user response is present in any cache** — assert this
    explicitly.
- A unit test for the DOCX builder proving RTL paragraph and run properties are set.
- Final report in **simple Uyghur**: measured first-visit and repeat-visit bytes before
  and after, the egress cost of one full-book download, what works offline and what does
  not, and a numbered list of anything I must do myself.

# Acceptance criteria
- The site installs on Android and iOS and opens a previously-read book with the network
  off, at the page the reader left.
- No private or admin response is ever served from cache, and a stale build can always
  be updated from inside the app.
- A reader can download any published book as a DOCX that opens correctly right-to-left
  in Word, and as plain text.
- A reader can share a link to an exact page, and can produce a legible Uyghur quote
  card by tapping on a phone.
- Repeat-visit egress went **down**, and the number is in the report.
- Nothing from Phases 1–13 regressed; the CSP was not weakened; no paid service and no
  new vendor account.
- Do NOT start the AI layer and do NOT touch the notebook — those are separate prompts.

Commit per logical step with English conventional messages. **If any part of this cannot
be done without breaking the free-tier rules, the mobile rules or the CSP, stop and
explain the trade-off to me in Uyghur rather than choosing silently.**
