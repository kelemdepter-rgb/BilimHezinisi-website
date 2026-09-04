---
name: bilim-web-audit
description: >-
  Audit and review the WEB edition of «بىلىم خەزىنىسى» (Bilim Hezinisi) — the live
  Uyghur digital library at bilimhezinisi.com, repo folder BilimHezinisi-website. Use
  WHENEVER the user wants the site examined rather than changed: find bugs, find what is
  missing, review quality, check speed, mobile behaviour, security or RLS, or free-tier
  cost; judge whether a feature is worth building; or produce a findings report plus the
  numbered PROMPT-N.md files Claude Code will later execute. Trigger on short or indirect
  requests too — "review the site", "what is wrong with it", "find the problems",
  "what should I build next", or Uyghur «سايتنى تەكشۈرۈپ چىق»، «خاتالىقلىرىنى تاپ»،
  «يېتەرسىزلىكىنى ئېيت»، «ئىلغارلاشتۇرۇش تەكلىپى بەر». This skill NEVER writes application
  code — it investigates and writes prompts. Do NOT use it for building or deploying (that
  is bilim-web), or for the desktop app (bilim-desktop) or the Android app (bilim-apk).
---

# bilim-web-audit — reviewing the Bilim Hezinisi web edition

The owner is **not a programmer**. He builds this library by pasting prompts into
Claude Code. This skill's job is therefore to *find things and decide what matters*,
then hand him prompts he can paste. Explanations to him are in **simple Uyghur**;
the prompts themselves are in **English**.

## The one rule that outranks everything else

**This skill does not write application code, and it does not touch production data.**

`bilimhezinisi.com` is a live library holding the owner's real books.
An audit that deletes a book, unpublishes one, edits a category tree, or fills the
database with test rows has done more damage than any bug it found.

- Never run a destructive admin action against production. Not to "verify it works".
- Never create books, categories or users in production. If a write must be exercised,
  do it on a **local dev server against a scratch Supabase project**, or ask the owner
  first, in Uyghur, with the exact consequence spelled out.
- Never edit anything in the desktop repo — it is a read-only reference.
- Never put the owner's Gemini API key, a book's contents, or a reader's note into a
  file, a log, a report or a commit.
- Editing files is limited to the audit's own outputs: the report and the `PROMPT-N.md`
  files. If a fix is genuinely one line and obviously safe, still write it as a prompt
  instead of applying it — the owner's workflow depends on every change going through
  Claude Code with tests.

## Evidence, not impressions

Every finding must carry proof. A finding without evidence is a guess and must be
labelled as one.

| Kind of claim | What counts as proof |
|---|---|
| "This is slow" | a measured number, on the deployed site, with the route and viewport named |
| "This is broken" | the exact steps to reproduce, what happened, what should have happened |
| "This is insecure" | the file and line, plus what an attacker would actually get |
| "This will hit a limit" | the current usage, the documented limit, and the arithmetic |
| "This is missing" | where a reader would look for it and find nothing |

Never invent a number, a price or a platform limit. Check it against the vendor's own
documentation and cite it. Where the vendor no longer publishes a figure, say so.

## The four lanes

Run them in this order. Each lane produces findings; nothing is fixed here.

### Lane 1 — Reader experience and speed
The site's whole purpose is that an ordinary Uyghur reader on an ordinary phone can
find and read a book. Judge it as that reader, not as a developer.

- Time real navigations on the **deployed** site: home → category → book → reader →
  search → Qur'an → notebook. Record time to first visual change and time to usable.
- Does every tap acknowledge itself immediately? A control that does nothing for a
  second reads as broken.
- The hard Mobile Rules in `CLAUDE.md` exist because earlier projects were ruined by
  them. Check each one, at **375×667, 390×844 and 1280×800**: no horizontal scroll at
  360 px; `100dvh` never `100vh`; safe-area padding on fixed bars; ≥44 px targets; no
  hover-only affordances; every control still visible and tappable after scrolling down
  and back up; drawers and modals that do not trap body scroll.
- RTL correctness: logical properties only, nothing that flips wrongly, no Latin text
  breaking the line direction, correct Uyghur shaping in every font.
- Offline: with the network off, does a previously-read book still open at the right
  page, and does everything else fail with a readable Uyghur message?
- First-load JS per route, and what a first-time visitor on a slow connection pays.

### Lane 2 — Correctness and bugs
- Walk every user-facing flow end to end, as all three personas (below).
- Search: does the exact phrase behave the way the desktop's `indexOf` search does?
  Operators are permanently removed — check none crept back.
- Reader: position restore, match navigation with its n/total counter, «قايتىش» back to
  results, print, download.
- Notebook: autosave, offline recovery, DOCX export, spellcheck underlining and
  suggestions, citation and aya insertion, find-and-replace with a single-step undo.
- Qur'an: sura and aya navigation, search with and without tashkil, copy, attribution.
- AI: model selection is strict, key failover across four slots, truncation is surfaced,
  nothing is logged. Never spend the owner's real quota unless he asks — mock it.
- Admin: batch import states, duplicate detection, and that nothing can be left
  half-imported and published.
- Empty states, error states, and what happens on a genuinely slow connection.

### Lane 3 — Security and privacy
This audience is one where a leak is not an inconvenience.

- RLS on every table, with policies read and understood — not just "RLS is enabled".
  Confirm anon reads only published content, and that per-user tables are owner-only.
- `/admin` routes and every mutating Server Action re-verify the role **server-side**.
  Client-side gating alone is a finding.
- No service-role key or Gemini key reachable from the client, in any bundle, ever.
- The CSP is enforcing, not report-only, and has not been widened.
- HTML sanitisation of book and note content.
- Rate limiting where it matters.
- What an account actually stores about a reader, whether the privacy page tells the
  truth about it, and whether export and deletion really remove everything.
- Anything that would let one reader see another reader's state — including a cache.

### Lane 4 — Cost and the free tier
The owner has no budget and never will. A design that only works while the library is
small is a finding.

- Current database size, storage use and egress against **500 MB / 1 GB / 5 GB**.
- Bytes per book, and how many books still fit.
- What the site costs per visitor, and what a hundred readers a day would cost.
- Vercel Hobby: function invocations, and the fact that its cron minimum is **once per
  day** — already used by `/api/health`.
- Anything that would break if the library doubled.
- Anything that quietly requires a paid plan.

## The three personas

Every lane is walked as all three. Most role bugs are only visible by comparing them.

1. **مېھمان (anonymous)** — no account. Browsing, reading and search must work fully.
2. **ئوقۇرمەن (reader)** — a signed-in account. Bookmarks, notes, progress, notebook, AI.
3. **ئادمىن (admin)** — the owner. Everything, but see the destructive-action rule above.

## How to look at the live site

**Know which tool you actually have.** The browser automation available here drives
**Chrome only**. The owner normally works in **Firefox**, and his Hostinger, Vercel and
Supabase dashboards live there — you cannot reach those, and you should not try. Ask him
to read a value or send a screenshot instead, and never fill in a value he has not given
you.

For the **public site**, use whichever of these actually works:

1. **Chrome automation**, if Chrome is available — navigate, click, resize to each
   viewport, read the console, read the network panel, screenshot anything visual.
2. **Playwright** against the live URL — this uses its own bundled browser, is
   independent of whatever the owner has open, and is the better tool for the
   three-viewport checks and for anything that must be repeatable.
3. **Plain fetches** of public URLs — enough to check redirects, headers, `robots.txt`,
   `sitemap.xml`, `feed.xml`, canonicals and OG tags.

Say which method produced each finding, so the owner knows how much to trust it.

- Set the viewport explicitly for each of the three sizes; do not judge phone layout by
  a narrow desktop window.
- Read the console on every page — an error the owner never sees is still a defect.
- If a browser tool fails two or three times, stop and ask rather than fighting it.
- Do not trigger native dialogs (`alert`, `confirm`) — they freeze the session.
- Keep to the site itself. Do not wander into unrelated pages.

Where the browser cannot answer a question, read the code, run the Playwright suite, or
run the project's own scripts (`db-usage.mjs`, `search-timing.mjs`, `search-parity.mjs`).

## Severity

Rank every finding, and lead with the worst.

- **P0 — losing or exposing something.** Data loss, a privacy or auth hole, the library
  becoming unreachable, a licence violation.
- **P1 — a reader cannot do the thing.** A broken flow, a control that does nothing, a
  page unusable on a phone, something that will hit a hard limit soon.
- **P2 — it works but badly.** Slow, confusing, ugly on one viewport, an error message
  nobody can act on.
- **P3 — worth doing.** Improvements, additions, tidying.

Be honest about uncertainty. A suspicion labelled as one is useful; a suspicion dressed
as a finding wastes a whole Claude Code session.

## What the audit produces

### 1. A findings report
Written to the website folder, in **Uyghur**, one file per audit pass, named
`AUDIT-YYYY-MM-DD.md`. Structure:

1. **بىر ئېغىز خۇلاسە** — what state the site is in, in three sentences.
2. **دەرھال قىلىش كېرەك (P0)** — with evidence.
3. **P1 / P2 / P3** tables — finding, evidence, where, suggested fix.
4. **ياخشى ئىشلەۋاتقانلىرى** — what is genuinely good. The owner needs to know what not
   to touch.
5. **ئۆلچەنگەن سانلار** — the measurements, so the next audit can compare.
6. **قىلماسلىق كېرەك دەپ قارىغانلىرىم** — things deliberately not recommended, with the
   reason. Saying "no" clearly is part of the job.

### 2. Numbered prompts
One `PROMPT-N.md` per coherent piece of work, continuing the existing numbering — check
the folder for the highest existing number and carry on from there. Group findings so
each prompt is one reviewable change; never bundle unrelated fixes.

Each prompt follows the house style already in `PROMPT-1.md` … `PROMPT-21.md`:

1. A short **Uyghur header**: the file's title, «قانداق ئىشلىتىسىز» with the exact
   folders to attach, and one blockquote explaining in plain Uyghur what the problem is.
2. A horizontal rule, then the **entire rest in English**, written for a fresh Claude
   Code session with no memory:
   - "Read `CLAUDE.md` first — it always wins" and to use the **bilim-web** skill;
   - a **Project context** paragraph naming what is already built, so nothing is rebuilt;
   - a **Non-negotiable constraints** list (below);
   - the findings, with the evidence, and the root cause where it is known;
   - what to do, specifically, with the trade-offs named;
   - **Tests**: typecheck, lint, build, the existing suites green, and new tests at
     **375×667, 390×844 and 1280×800**;
   - **Acceptance criteria** that someone could check without trusting the author;
   - a final line telling Claude Code to **stop and ask in Uyghur** rather than silently
     trading away quality.

Deliver every file to the owner and write it into the website folder.

## The constraints every prompt must restate

These are the project's invariants. A prompt that omits them will get them broken.

- **No budget, ever.** Supabase Free (500 MB DB / 1 GB storage / 5 GB egress / 50,000
  MAU / paused after 1 week idle) and Vercel Hobby (cron minimum once per day, already
  used; single function region; non-commercial use only). No paid service, no new vendor
  account, now or later.
- **Anonymous reading always works** — browsing, reading and search need no account.
- **RTL Uyghur UI**; code, comments and commits in English.
- **Mobile quality equals desktop quality**; the Mobile Rules in `CLAUDE.md` are hard.
- **No PDF, no OCR** on the web. Accepted: `.docx`, `.doc`, `.md`, `.html`, `.txt`, URL.
- **Search operators are permanently removed** — typed text is one literal phrase.
- **AI is bring-your-own-key, browser-only.** The reader's Gemini key never reaches the
  owner's server and is never stored in Supabase. Strict model selection; failover
  changes the key, never the model.
- The **desktop repo is read-only reference**.
- **RLS on every table**; `/admin` and mutating Server Actions re-verify server-side.
- **Never edit an applied migration** — always a new file in `supabase/migrations/`.
- Do not weaken the CSP; no third-party runtime scripts or CDNs.

## Before calling an audit finished

- Every finding has evidence, a severity and a location.
- Every measurement is a real number from the deployed site, not an estimate.
- Every external limit or price cited was checked against the vendor's own page.
- All three personas were walked, at all three viewports.
- Nothing in production was created, changed or deleted.
- The report is in Uyghur and the prompts are in English.
- The owner is told, in one short list, exactly what to do next and in what order.
