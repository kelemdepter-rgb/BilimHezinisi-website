# PROMPT 36 — تېلېفوندا بېسىش تەس بولغان ئۈچ ئۇلىنىشنى چوڭايتىش

## قانداق ئىشلىتىسىز (يېڭى تۈر ئېچىپ)
1. Claude Code نى ئېچىپ **BilimHezinisi-website** قىسقۇچىنى تاللاڭ.
2. سىزىقتىن تۆۋەنكى تېكىستنى پۈتۈنلەي كۆچۈرۈپ چاپلاڭ.

> **بۇ نېمە ئىش:** تېلېفوندا بارماق بىلەن ئاسان بېسىش ئۈچۈن ھەر بىر ئۇلىنىش ياكى
> كۇنۇپكا كەم دېگەندە 44 پىكسېل ئېگىز بولۇشى كېرەك — بۇ لايىھەنىڭ قاتتىق قائىدىسى.
> سايتتا پەقەت ئۈچ يەر بۇ قائىدىگە ئۇيمايدۇ: ئەڭ ئاستىدىكى «ھەققىدە» (20 پىكسېل) ۋە
> «مەخپىيەتلىك ۋە بىخەتەرلىك» (20 پىكسېل)، ھەمدە ئەڭ ئۈستىدىكى سايت بەلگىسى — باش بەتكە
> قايتىش ئۇلىنىشى (30 پىكسېل). بۇ ئۆزگىرىش ئۇلارنىڭ كۆرۈنۈشىنى ئۆزگەرتمەيدۇ، پەقەت
> بېسىلىدىغان دائىرىسىنى چوڭايتىدۇ.

---

You are continuing an existing, live project. Read `CLAUDE.md` in this folder FIRST — it is
the project instruction and always wins — and use the **bilim-web** skill.

## What this task is

Three tap targets on every page are shorter than the 44 px the Mobile Rules require. Make their
tappable area at least 44 px tall without changing how they look.

## Project context

Next.js 16 + Tailwind, live at `https://bilimhezinisi.com`, phases 1–35 deployed. Everything is
in `components/app-shell.tsx`:

- the footer's `<nav aria-label="سايت ئۇچۇرلىرى">` — the links «ھەققىدە»
  (`data-testid="about-link"`) and «مەخپىيەتلىك ۋە بىخەتەرلىك» (`data-testid="privacy-link"`),
  the account link (`AccountLink`) and the © year;
- the header's brand link (`aria-label="باش بەت — بىلىم خەزىنىسى"`), deliberately the one
  element in the header row allowed to shrink so the row never passes 360 px.

## The finding — measured on the live site, 2026-09-11

A sweep of every visible `a`, `button`, `input` and `select` outside running text, at 375×667,
on `/`, `/books/466`, `/authors` and `/quran/1` (and at 360×640 on `/`, `/about`, `/privacy`):
only these three are under 44 px tall —

| Element | Size |
|---|---|
| footer «ھەققىدە» | 36 × 20 px |
| footer «مەخپىيەتلىك ۋە بىخەتەرلىك» | 122 × 20 px |
| header brand link | 120 × 30 px |

The footer pair was already reported in `AUDIT-2026-09-02.md` (P2-7) and deferred. No page
scrolls sideways at 360 px today; keep it that way.

---

# What to do

- Give the two footer links, and the account link beside them if it is also short, a tappable
  box at least 44 px tall — e.g. `inline-flex min-h-11 items-center` — keeping their font,
  colour, hover underline and order. Adjust the `nav`'s `gap-y` so a wrapped second line does
  not look double-spaced.
- Give the header brand link `min-h-11` (or equivalent) so its box is at least 44 px tall. It
  must keep shrinking in width exactly as it does now: the header row at 360 px must not grow,
  wrap or push any control off-screen.
- Nothing else in the header, the footer or any page changes.

---

# Constraints — restated, because they are not negotiable

- **No budget, ever.** Supabase Free (500 MB database / 1 GB storage / 5 GB egress / 50,000
  MAU / paused after a week idle) and Vercel Hobby (cron minimum once a day, and that one slot is
  `/api/health`; a single function region; non-commercial use). No paid service, no new vendor
  account, no new dependency — now or later.
- **Anonymous reading always works** — browsing, reading and search need no account.
- **RTL Uyghur UI.** Logical properties only (`ps-*`, `pe-*`, `ms-*`, `me-*`, `start-*`, `end-*`,
  `text-start`); never physical left/right. Code, comments and commit messages in English;
  Uyghur only in UI strings.
- **Mobile quality equals desktop quality.** The Mobile Rules in `CLAUDE.md` are hard
  requirements: `100dvh` never `100vh`, safe-area padding on fixed bars, ≥ 44 px targets, no
  hover-only affordances, no horizontal scroll at 360 px, no trapped scroll, every control
  visible and tappable after scrolling down and back up.
- **No PDF and no OCR on the web.** Accepted formats: `.docx`, `.doc`, `.md`, `.html`, `.txt`
  and a web URL.
- **Search operators stay removed.** Typed text is one literal phrase.
- **AI is bring-your-own-key and browser-only.** Do not touch `lib/ai/`.
- **The desktop repo is a read-only reference.** Never modify anything there.
- **RLS stays on every table**; `/admin` and every mutating Server Action re-verify the role
  server-side — do not touch `lib/admin/guards.ts` or any policy unless this task says so.
- **Never edit an applied migration** — always a new file in `supabase/migrations/`.
- **Do not weaken the CSP**; no third-party runtime script or CDN.
- No new colour, font or icon; nothing outside `components/app-shell.tsx` and its tests.
- No `git add -A` / `git add .` / `git commit -a`. One commit:
  `fix(mobile): make the footer links and the brand at least 44 px tall`. **Ask the owner before
  pushing.**

---

# Tests

- `npm run typecheck && npm run lint && npm run build` — green.
- **Playwright, at 360×640, 375×667, 390×844 and 1280×800**, on `/`, `/about`, `/search` and a
  book page: each of the three elements' bounding box is ≥ 44 px tall; no horizontal overflow;
  the header row's height is unchanged from before this change (record it first); the footer
  links still work (they navigate) after scrolling to the bottom and back up.
- A sweep assertion like the audit's: no visible `a`, `button`, `input` or `select` outside
  running text (`p`, `td`) is under 44 px tall on those pages. If it finds something the audit
  did not, report it — do not fix it in this change.
- Every existing suite green (`trust.spec.ts` finds the footer links by test id). Known flaky:
  `keyboard.spec.ts:151`, `ai.spec.ts:148`, `ai.spec.ts:261`, `offline.spec.ts:181`,
  `reader-ai.spec.ts:534`.
- Take a screenshot of the footer and the header at 360×640 and 390×844 and look at them.

---

# Acceptance criteria

1. The three elements are ≥ 44 px tall at every tested viewport.
2. The header row and the footer look the same as before at a glance — same text, same order,
   same colours — and nothing scrolls sideways at 360 px.
3. Typecheck, lint, build and all suites green.

---

# The report

Report in **simple Uyghur**, with the before/after sizes of the three elements and the two
screenshots' verdict.

**If the brand link cannot reach 44 px without making the header row taller or pushing a control
off a 360 px screen, stop and ask the owner in Uyghur** — he would rather choose than receive a
header that is broken on a phone.
