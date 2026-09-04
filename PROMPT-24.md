# PROMPT 24 — كىتابخانا باش بېتىگە «يېڭى كىتابلار قوشۇلۇۋاتىدۇ» ئۇقتۇرۇشى

## قانداق ئىشلىتىسىز (يېڭى تۈر ئېچىپ)
1. Claude Code نى ئېچىپ **BilimHezinisi-website** قىسقۇچىنى تاللاڭ.
2. سىزىقتىن تۆۋەنكى تېكىستنى پۈتۈنلەي كۆچۈرۈپ چاپلاڭ.

> **بۇ كىچىك بىر ئۆزگىرىش** — كىتاب سانى بىلەن تەرتىپلەش كۇنۇپكىلىرىنىڭ ئارىسىدىكى
> بوش ئورۇنغا بىر قۇر يېزىق قوشۇش. ئەمما ئۇ قۇر **تېلېفوندا** ئەڭ تار يەرگە
> چۈشىدۇ، شۇڭا ئۆلچەم قاتتىق: ھېچقانداق كۇنۇپكا يوشۇرۇنۇپ قالمىسۇن.
>
> **مەن ئۇنى `/new` بېتىگە ئۇلانما قىلدىم** — «يېڭى كىتابلار قوشۇلۇۋاتىدۇ» دەپ
> ئېيتىپ، بېسىشقا بولمايدىغان بىر جۈملە بولغاندىن كۆرە، بېسىلسا يېڭى كىتابلارنى
> كۆرسىتىپ بەرگىنى ياخشى. ئۇنداق بولمىسۇن دېسىڭىز ماڭا دەڭ، ئۆزگەرتىمەن.

---

You are continuing an existing, live project. Read `CLAUDE.md` in this folder FIRST —
it is the project instruction and always wins — and use the **bilim-web** skill.

## What this task is

Add one line of Uyghur text to the library toolbar on the home page, in the empty
horizontal gap between the book count and the sort/view controls, telling readers that
new books are being added and inviting them back.

The owner adds books continuously and has just moved the library to its own domain
(`https://bilimhezinisi.com`, 2026-08-29). He is about to share the address with people
for the first time, and wants a visitor's first screen to say the collection is growing.

**This is the whole task. Do not bundle anything else into it.**

## Project context

Next.js 16 (App Router) + TypeScript + Tailwind on **Vercel Hobby**, Supabase Free.
GitHub `kelemdepter-rgb/BilimHezinisi-website`. The site is live at
`https://bilimhezinisi.com`; the old `bilim-hezinisi-website.vercel.app` 308-redirects
to it. Phases 1–24 are deployed.

---

# The change

## Where, exactly

`components/library/library-browser.tsx`, the toolbar `<div>` that currently reads:

```tsx
<div className="mb-4 flex flex-wrap items-center gap-2">
  <p className="me-auto text-[13px] text-ink3" data-testid="library-count">
    {categoryId ? `${categoryName(categoryId) ?? "تۈر"}: ` : ""}
    {total} كىتاب
  </p>

  <label className="flex items-center gap-2">  {/* sort select */}
  <div className="flex items-center gap-1" role="group" aria-label="كۆرۈنۈش شەكلى">
    {/* grid / list buttons */}
```

The `me-auto` on the count is what creates the empty gap. The new line goes **into that
gap** — after the count, before the sort control — with the sort and view controls
staying at the far end of the row as they are now.

## What to add

A link with this exact text:

```
يېڭى كىتابلار قوشۇلۇۋاتىدۇ، زىيارەت قىلىپ تۇرۇڭ…
```

Note the single ellipsis character `…`, which is what the rest of this codebase uses
(see `يۈكلىنىۋاتىدۇ…` a few lines below in the same file). Do not use three full stops.

It links to **`/new`** — the discovery page that already exists at `app/new/page.tsx`.
A sentence that announces new books and then does nothing is a wasted invitation; one
tap away from actually seeing them is the point.

## Type and colour

- **Font: change nothing.** UKIJ Ekran is already the primary UI font, self-hosted from
  `public/fonts/ukijekran.woff2` and applied globally. The new line inherits it. Do NOT
  add an `@font-face`, a `font-family` declaration, or a font import — that would be
  duplicate work at best and a licence problem at worst. Confirm in the report that it
  inherits.
- **Size: noticeably larger than the `text-[13px]` count** — this is the owner's explicit
  request. Somewhere around 15–16px reads right; use your judgement, but it must not
  compete with a page heading.
- **Colour: use an existing design token**, not a new hex value. `text-am` (the gold,
  `--am`) suits an invitation and is already used elsewhere in this component's file.
  Do not introduce a new colour.
- Give it a `data-testid` so a test can find it.

---

# Mobile — the hard part, and the reason this prompt exists

The Mobile Rules in `CLAUDE.md` are hard requirements, written because earlier projects
were ruined by hidden controls and trapped scroll. This one row already carries a count,
a `<select>`, and two buttons. Adding a sentence to it at 360 px is exactly how a toolbar
starts overflowing.

- The row is already `flex-wrap`. Keep it wrapping. **Never** introduce horizontal scroll.
- **No horizontal overflow at 360 px width.** Assert it.
- **The sort select and both view buttons must stay visible and tappable** at every
  viewport, before and after scrolling down and back up. If the sentence at full length
  would push a control off-screen or onto a line where it is cramped, then shorten,
  wrap, or hide the *sentence* on narrow screens — never the controls. The controls are
  function; the sentence is decoration.
- Touch targets stay ≥44 px.
- RTL: use logical properties (`ms-*`, `me-*`, `ps-*`, `pe-*`, `start-*`, `end-*`).
  Never physical `left`/`right`.
- If you decide to hide or shorten the sentence below some breakpoint, **say so in the
  report and say at what width** — do not make that trade silently.

## One judgement call to make and report

`library-browser.tsx` renders on the home page **and** on a category-filtered view
(«ھەدىسلەر: 5 كىتاب»). Decide whether the line should appear on the filtered views too,
do it, and give your reasoning in one sentence. Either answer is defensible; an
unexplained one is not.

---

# Constraints that do not move

- **No budget, ever.** Supabase Free, Vercel Hobby. Nothing new that costs anything.
- **Anonymous reading keeps working** with no account. This line must render for a
  signed-out visitor — that is its whole audience.
- RTL Uyghur UI; code, comments and commit messages in English.
- **Do not weaken the CSP. Do not touch RLS, role checks, or `lib/ai/`.**
- **Do not touch `lib/legacy-host.ts`, `proxy.ts`, `lib/seo.ts`, `public/sw.js` or
  `lib/pwa/constants.ts`** — those are the domain migration of 2026-08-29 and are settled.
- **Never edit an applied migration.** No schema change is needed; the string is
  hardcoded in the component. Do not build an admin setting for it — one sentence does
  not justify a settings screen, and the owner can ask for a new prompt to reword it.
- Do not run `git add -A` / `git add .` / `git commit -a`. Stage only the files you
  changed. `git push` deploys to the live library — **ask the owner before pushing.**
- Do NOT fix the two items in `FINDINGS-2026-08-29.md`. They get their own prompt.

---

# Tests

- `npm run typecheck && npm run lint && npm run build` — green.
- Every existing unit and Playwright suite green at **375×667, 390×844 and 1280×800**.
  Four tests in this suite are known to be flaky or pre-existing failures —
  `keyboard.spec.ts:151`, `ai.spec.ts:148`, `ai.spec.ts:261`, `offline.spec.ts:181`,
  `reader-ai.spec.ts:534`. If one of those fails, say so and move on; do not chase it,
  and do not treat it as caused by this change.
- **New tests**, at all three viewports:
  - the line is present on the home page for a signed-out visitor, with the exact text;
  - it links to `/new`;
  - **no horizontal overflow at 360 px**;
  - the sort select and both view buttons are visible and clickable **after scrolling
    down and back up**.

---

# Acceptance criteria

1. The line appears in the gap between the book count and the sort control, in the
   site's own UKIJ Ekran, visibly larger than the count, in an existing colour token.
2. Tapping it opens `/new`.
3. Nothing in the toolbar is hidden, clipped, or unreachable at 360, 375, 390 or 1280 px.
4. No horizontal scroll anywhere on the home page at 360 px.
5. No new font, no new colour, no new dependency, no schema change, no CSP change.
6. Nothing from earlier phases regressed — the domain redirect, the reader, search, the
   Qur'an module and the notebook all still work.

Commit as one logical change with an English conventional message. Report in simple
Uyghur: what you changed, the breakpoint decision and why, the category-view decision and
why, and the test results viewport by viewport.

**If this change cannot be made without pushing a control off-screen on a phone, stop and
say so in Uyghur rather than shipping a toolbar that hides a button. The sentence is worth
less than the buttons.**
