# PROMPT 15 — تېپىلىش ۋە تارقىلىش (ئاپتور، يېڭى كىتابلار، RSS، كىتاب تەلىپى، ئىزدەش قولايلىقى)

## قانداق ئىشلىتىسىز (يېڭى تۈر ئېچىپ)
1. Claude Code نى ئېچىپ **BilimHezinisi-website** قىسقۇچىنى تاللاڭ، ھەمدە دېسكتوپ دېتال
   قىسقۇچىنىمۇ قوشۇپ تاللاڭ (`bilim hezinisi pc`) — پەقەت ئوقۇش ئۈچۈن پايدىلىنىش مەنبەسى.
2. سىزىقتىن تۆۋەنكى تېكىستنى پۈتۈنلەي كۆچۈرۈپ چاپلاڭ.

> **مەقسەت:** كۇتۇپخانا كەڭ تارقالسۇن. ئىككى تەرەپتىن: ①كىشىلەر كىتابنى **تاپالىسۇن**
> (ئاپتور بويىچە كۆرۈش، يېڭى كىتابلار، RSS)؛ ②كىشىلەر **ئىزدىيەلىسۇن** — نۇرغۇن
> تېلېفوندا ئۇيغۇرچە كۇنۇپكا تاختىسى يوق، شۇڭا ئېكران كۇنۇپكا تاختىسى قوشىمىز.
> ئۈستىگە ئوقۇرمەن كىتاب تەلەپ قىلالايدىغان بولىدۇ.

---

You are continuing an existing, live project. Read `CLAUDE.md` in this folder FIRST —
it is the project instruction and always wins — and use the **bilim-web** skill.

## Project context (Phases 1–14 are done and deployed)
Live at `https://bilim-hezinisi-website.vercel.app` — a free public Uyghur digital
library. Next.js App Router + TypeScript + Tailwind on **Vercel Hobby**, data in
**Supabase Free**. GitHub `kelemdepter-rgb/BilimHezinisi-website`.

Already built — do not rebuild or redesign any of it: manuscript design tokens
(light/dark/sepia), RTL shell, Supabase Auth with `admin`/`uploader`/`reader`, RLS on
every table, `ug_normalize()`, admin category tree + upload wizard + user roles, library
home (grid/list, category filter, recent reads), book detail, reader, global
exact-phrase search with jump-to-match, Qur'an module, desktop-library migration, SEO
(sitemap, robots, OG, JSON-LD), rate limiting, notebook with spellcheck, the
licence/trust work from PROMPT 13, and the PWA + download + share work from PROMPT 14.

## Non-negotiable constraints
- **No budget, ever.** Supabase Free (500 MB DB / 1 GB storage / 5 GB egress / 50,000
  MAU / project pauses after 1 week idle) + Vercel Hobby (cron minimum interval once per
  day; the daily `/api/health` cron is already at that limit — do **not** add a cron that
  needs to run more often, it will fail deployment). No paid service, no new vendor
  account, not now and not later.
- Anonymous browsing, reading and search must keep working with **no account**.
- RTL Uyghur UI; code, comments and commit messages in English.
- No new runtime third-party CDN, script or service. No captcha service — spam is
  handled with our own rate limiting.
- Search operators stay removed: what the user types is one literal phrase.
- All Mobile Rules in `CLAUDE.md` apply. Do not weaken the CSP.
- New migrations are NEW files in `supabase/migrations/`; never edit an applied one.
- RLS on every new table, written explicitly, and verified with a test that a signed-out
  visitor and a wrong-user account both get nothing.

---

# PART A — Browsing by author

`books.author` already exists but there is no way to browse by it.

- `/authors` — every author with at least one published book, with a book count, sorted
  sensibly for Uyghur text. Paginate or virtualise; do not load the whole library.
- `/authors/[author]` — that author's published books, reusing the existing book grid /
  list components. Do not build a second card component.
- The author name on the book detail page links to that page.
- Handle the real data honestly: authors will be missing, duplicated with different
  spellings, or padded with whitespace. Normalise with `ug_normalize()` for grouping and
  matching while displaying the original spelling, and report how many books have no
  author at all.
- Add both routes to the sitemap with correct canonical URLs and metadata.
- Do the grouping in Postgres (an indexed query or a view), not by pulling every row
  into a route handler.

---

# PART B — «بۇ ئايدىكى يېڭى كىتابلار» and a feed

## B1. New books

- A section on the home page showing recently published books, positioned so it does not
  push the existing category browsing below the fold on a 375 px phone.
- `/new` — the full list, newest first, paginated.
- "New" means recently **published**, not recently uploaded. If the schema cannot
  currently distinguish the two, add a migration that can, and backfill it safely.

## B2. RSS / Atom feed

- `/feed.xml`, valid Atom, listing recently published books with title, author,
  description, canonical link and publication date.
- Correct `Content-Type`, sensible `Cache-Control`, and a `<link rel="alternate">` in the
  document head so feed readers discover it.
- Generated on request from the database with caching — not a cron job, because Vercel
  Hobby only allows one run per day and that slot is already used.
- Validate the output against a real feed validator and say in the report that you did.

---

# PART C — Book requests

Readers should be able to ask for a book without an account and without giving the owner
a moderation problem.

## C1. Public form

- `/request` — book title, author (optional), a short note (optional), and an optional
  contact email. No account required.
- Nothing submitted is ever displayed publicly. This is an inbox, not a forum.

## C2. Table and policies

- New table `book_requests` with a new migration. RLS: `anon` and `authenticated` may
  `INSERT` only; **only `admin` may `SELECT`**. Prove with a test that a signed-out
  visitor and a plain `reader` both read back nothing.
- Length caps on every column enforced in the database, not only in the form.

## C3. Spam, without a third-party captcha

- `lib/rate-limit.ts` on the endpoint, per IP and tighter than the existing limits.
- A hidden honeypot field and a minimum time-to-submit; silently accept and discard
  anything that trips them, so a bot learns nothing.
- Hard caps on total rows per day; when exceeded, show a polite Uyghur message rather
  than failing silently.
- Storage discipline: these rows must never be able to grow into the 500 MB budget.
  Cap the stored length, and give the admin a way to delete handled requests.

## C4. Admin inbox

- `/admin/requests` — list, mark as handled, delete. Role re-verified server-side on
  every action, like the rest of `/admin`.
- Show the count of unhandled requests on the admin dashboard.

---

# PART D — Making search usable on a phone

## D1. On-screen Uyghur keyboard

Many phones in this audience have no Uyghur keyboard installed. Right now those readers
simply cannot search.

- A toggle next to the main search input, the in-book search input and the Qur'an search
  input that opens an on-screen Uyghur Arabic-script keyboard.
- The full Uyghur alphabet, in the conventional layout, plus space, backspace, and a
  close button. No emoji, no numbers pad, nothing decorative.
- Keys are at least 44 px, laid out RTL, and legible at 360 px width without horizontal
  scroll.
- The keyboard must **not** cover the input it is typing into, and must not trap body
  scroll. Opening and closing it must not lose what has already been typed or move the
  caret unexpectedly.
- It is a convenience, never a requirement: a reader with a real Uyghur keyboard must
  never be forced through it, and it must be closed by default.
- Entirely client-side, no dependency, no layout data fetched from anywhere.

## D2. Search history

The desktop remembers recent searches (`db-search-history`); the web does not.

- Store the last few queries **in the browser only** (localStorage). Do not create a
  server table — search terms are the most sensitive thing a reader produces here, and
  they should not sit on a server.
- Show them when the empty search box is focused, exactly as the desktop does
  (`src/index.html`, `id="search-history"`).
- Each entry can be removed individually, and the whole history cleared with one action,
  reachable from `/my/account` as well as from the dropdown.
- Nothing is recorded for a reader who has never searched, and clearing it clears it
  completely.

---

# Tests and reporting (mandatory)

- `npm run typecheck && npm run lint && npm run build` all pass.
- Existing unit and Playwright suites stay green at **375×667, 390×844 and 1280×800**.
- New Playwright coverage at all three viewports:
  - `/authors` and `/authors/[author]` render with no horizontal overflow and paginate;
  - the home "new books" section does not push category browsing off a 375 px screen;
  - `/feed.xml` returns valid Atom with the right content type;
  - the request form submits, the honeypot path is silently discarded, and the rate limit
    returns a friendly Uyghur message;
  - `/admin/requests` is unreachable for a signed-out visitor and for a `reader`;
  - the on-screen keyboard opens by tap, types into all three search inputs, never covers
    the input, never traps body scroll, and every key is at least 44 px;
  - search history appears, individual entries delete, and clearing removes everything.
- A database-level test that `book_requests` is readable only by an admin.
- Final report in **simple Uyghur**: how many books have no author, the feed URL, what
  the spam limits actually are, and a numbered list of what I must do myself (which
  migration to paste into the Supabase SQL Editor, and how to check the admin inbox).

# Acceptance criteria
- A visitor can browse by author, see what is new, and subscribe to a feed — all without
  an account.
- A reader with no Uyghur keyboard can search the library from a 375 px phone.
- A reader can request a book; only the admin can read the requests; a bot cannot flood
  the table.
- Search history lives only in the reader's own browser and can be erased completely.
- Nothing from Phases 1–14 regressed; no new cron job was added; the CSP was not
  weakened; no paid service and no new vendor account.
- Do NOT start the AI layer and do NOT touch the notebook — those are separate prompts.

Commit per logical step with English conventional messages. **If any part of this cannot
be done without breaking the free-tier rules, the mobile rules, or the privacy position
above, stop and explain the trade-off to me in Uyghur rather than choosing silently.**
