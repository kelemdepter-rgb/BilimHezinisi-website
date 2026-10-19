# PROMPT 37 — قالغان كىچىك ئۇلىنىشلارنى 44 پىكسېلغا يەتكۈزۈش

> **بۇ نېمە ئىش:** PROMPT-36 ئەڭ ئۈستى ۋە ئەڭ ئاستىدىكى ئۈچ ئۇلىنىشنى 44 پىكسېلغا يەتكۈزدى.
> ئۇنىڭ تەكشۈرۈشى ۋە كېيىنكى كەڭرەك بىر سىيرىش سايتتا يەنە بىر نەچچە كىچىك نەرسە تاپتى:
> باش بەتتىكى «ھەممىسى» ئۇلىنىشى (19 پىكسېل)، كىتاب ۋە ئاپتور بەتلىرىنىڭ ئۈستىدىكى يول
> ئۇلىنىشلىرى («كۇتۇپخانا ‹ …»، 19 پىكسېل)، ئىزدەش كاتەكچىسىنىڭ ئۆزى (43 پىكسېل — كومپيۇتېردا ۋە
> تېلېفوننىڭ ئىزدەش تاختىسىدا)، ھەمدە ئىزدەش نەتىجىسى بېتىدىكى كىتاب ماۋزۇسى (23 پىكسېل) ۋە
> كومپيۇتېردىكى بىر قۇرلۇق نەتىجىلەر (40 پىكسېل). بۇ ئۆزگىرىش ئۇلارنىڭ كۆرۈنۈشىنى
> ئۆزگەرتمەيدۇ، پەقەت بېسىلىدىغان دائىرىسىنى چوڭايتىدۇ. ئۇنىڭدىن كېيىن سايتنىڭ ئوچۇق
> بەتلىرىدە 44 پىكسېلدىن كىچىك ھېچقانداق ئۇلىنىش ياكى كۇنۇپكا قالمايدۇ.

---

You are continuing an existing, live project. Read `CLAUDE.md` in this folder FIRST — it is
the project instruction and always wins — and use the **bilim-web** skill.

## What this task is

PROMPT-36 (commit `3cbaaa0`, live 2026-09-17) made the footer links and the header brand 44 px
tall. Its audit-style sweep, and a wider one run afterwards, name every remaining control on the
public pages that is shorter than the 44 px the Mobile Rules require. Make each of them at least
44 px tall without changing how it looks, and then remove the excuses PROMPT-36's test had to
carry for them — so the sweep guards every control from now on.

## Project context

Next.js 16 + Tailwind, live at `https://bilimhezinisi.com`, phases 1–36 deployed. The pieces this
task touches:

- `components/library/book-strip.tsx` — the sideways shelf on the home page. Only the
  new-books strip passes `moreHref`, which renders the «ھەممىسى» link
  (`data-testid="new-strip-more"`, lines 61–69) at the far end of the heading row. The
  recent-reads strip renders no link. `tests/discovery.spec.ts` («sits centred in the row, and
  drops to its own line on a phone», «never costs the page a control…») pins that row's layout.
- `app/books/[id]/page.tsx` lines 112–125 — the category trail above a book,
  `<nav aria-label="تۈر يولى">`: «كۇتۇپخانا» then one link per category, `‹` between them.
- `app/authors/[author]/page.tsx` lines 61–69 — the same trail shape above an author,
  `<nav aria-label="يول">`: «كۇتۇپخانا» ‹ «ئاپتورلار» (`data-testid="authors-breadcrumb"`).
  The two navs are copies of each other.
- `app/globals.css` lines 257–284 — the header search pill `.sbox` (0.5 px border, `align-items:
  center`) and its input `.sinput` (`padding: 11px 0`, 14 px font → a 21 px line → **43 px**).
  Both header forms use it: the desktop one (`data-testid="header-search"`, `hidden md:flex`)
  and the phone's search panel (`data-testid="header-search-mobile"`, opened by the header
  button `aria-label="ئىزدەش رامكىسىنى ئېچىش"`). The `/search` page's own box is the `.field`
  variant and is already 44 px — leave it alone.
- `components/search/book-results.tsx` — a result group: the book title link
  (`data-testid="search-book-title"`, lines 102–108, inside an `h2` with `items-baseline` and the
  author beside it), the preview rows (`data-testid="search-result"`, lines 115–124, `flex gap-2
  … px-2 py-1.5`, snippet `leading-7`), the «بۇ كىتابتىكى بارلىق ئورۇنلارنى كۆرۈش» expander
  (`.hbtn`, already 44 px) and the expanded rows (`data-testid="expanded-match"`, lines 171–180,
  the same row shape). `PageChip` (lines 32–41) has no fixed height.
- `tests/trust.spec.ts` — «the shell's tap targets» (from line 545): for `/`, `/about`, `/search`
  and the seeded book page, at the project viewport and again at 360×640, it asserts the three
  PROMPT-36 targets, the 64 px header row, no overflow, and runs `shortControls()`, the sweep. The
  constant `SHORT_ELSEWHERE` (line 562) excuses three selectors — `[data-testid="new-strip-more"]`,
  `nav[aria-label="تۈر يولى"] a`, `[data-testid="header-search"]` — because PROMPT-36 was told to
  report them, not fix them. This task is the fix, so that list goes.
- The Playwright setup project (`tests/auth.setup.ts`, «seed a published test book») inserts the
  seeded book WITHOUT a `category_id`, so the seeded book's page renders no trail; its author is
  «سىناق ئاپتور», so `/authors/<that, URL-encoded>` exists for as long as the seed does.
  `SEED_NEEDLE` in `tests/env.ts` is a word that returns results for the seeded book on `/search`
  (`tests/search-library.spec.ts` shows how).

## The finding — measured on the live site, 2026-09-17

Headless Chromium through Playwright, anonymous, `serviceWorkers: "block"`, at 375×667 and
1280×800, over sixteen public pages (`/`, `/?cat=17`, `/new`, `/authors`, an author page, `/quran`,
`/quran/1`, `/search`, `/search?q=ناماز`, `/books/466`, `/books/466/read`, `/login`, `/register`,
`/forgot-password`, `/about`, `/privacy`, `/offline`), plus the home page with the phone's search
panel open and with the drawer open. Every visible `a`, `button`, `input` and `select` outside
running text (`p`, `td`) that is under 44 px tall:

| Element | Where | Size | Seen at |
|---|---|---|---|
| «ھەممىسى» at the end of the new-books heading row | `/` — `book-strip.tsx:62` | 42 × 19 px | every width |
| trail on a book page: «كۇتۇپخانا», then the category (here «تەۋھىد ۋە ئەقىدە») | `/books/466` — `app/books/[id]/page.tsx:113` | 41 × 19, 73 × 19 px | every width |
| trail on an author page: «كۇتۇپخانا», «ئاپتورلار» | `/authors/<name>` — `app/authors/[author]/page.tsx:61` | 41 × 19, 36 × 19 px | every width |
| the header search input (`header-search`) | every page with the shell — `.sinput` | 315 × 43 px, inside a 46 px pill | ≥ 768 px (md) |
| the phone search panel's input (`header-search-mobile`) | any page, panel open — `.sinput` | 126 × 43 px, inside a 46 px pill | phones |
| search results: the book title above each group | `/search?q=…` — `book-results.tsx:102` | 146 × 22.5 px | every width |
| search results: a one-line preview row | `book-results.tsx:115` (`py-1.5` + a 28 px line = 40) | 898 × 40 px | 1280 only — on a phone the snippet wraps and rows are 68–124 px |
| search results: a one-line expanded row (same shape) | `book-results.tsx:171` | 40 px by the same arithmetic | 1280, after expanding |

Nothing else on those pages is short: the reader's toolbar, the mushaf, the drawer, the auth
forms, the Qur'an index and `/new` all pass. The 2026-09-11 audit missed the trails and the
results page because it swept `/authors` (the index) and `/search` (empty), and the search input
because it counted the 46 px pill rather than the 43 px input.

---

# What to do

Six changes, each small. The rule for all of them, as in PROMPT-36: the **box** grows, the type,
colour, order and hover behaviour do not, and no two tap boxes may overlap.

1. **«ھەممىسى»** (`book-strip.tsx`): give the link `inline-flex min-h-11 items-center`, keeping
   `ms-auto text-[12.5px] font-semibold text-am hover:underline`. The heading row is
   `flex flex-wrap items-center`, so the heading centres against the taller link and the row
   grows by about 25 px; accept that. The centring rules `tests/discovery.spec.ts` asserts — the
   hint centred in the gap on a wide screen, dropped under both on a phone — must still hold.
2. **The two trails** (`app/books/[id]/page.tsx`, `app/authors/[author]/page.tsx`): give every
   trail link `inline-flex min-h-11 items-center`, keeping `hover:text-ink` and the `‹`
   separators. The nav grows from 19 to 44 px; trim its `mb-4` to `mb-2` so the title beneath
   does not drift far. Do NOT use negative margins to keep the nav's height: a long trail wraps
   on a phone (`flex-wrap`), and wrapped bleeds would overlap. Preferably move the trail into one
   component — e.g. `components/library/trail.tsx`, taking the crumbs as `{ href, label,
   testId? }[]` — used by both pages, so the two copies cannot drift again; if you keep them
   separate, change both identically.
3. **The search input** (`app/globals.css`, `.sinput`, inside `@layer components`): give it
   `min-height: 44px`. The pill is already 46 px tall (its scope button is 44 px), so nothing
   else moves — the header row stays 64 px and the phone panel's height changes by at most a
   pixel. Both header forms pick it up because they share the class. Leave `.field` alone.
4. **The result title** (`book-results.tsx`, `search-book-title`): `inline-flex min-h-11
   items-center`, keeping `text-[15px] font-bold text-ink hover:underline`. The `h2` aligns the
   author's name on the title's baseline (`items-baseline`) — an inline-flex item's baseline is
   its text's, so that should survive; check it in the screenshot. The group grows by about
   21 px; accept that. Not a negative margin here: the row above and the row below are tap
   targets and would overlap.
5. **The result rows** (`search-result` and `expanded-match`): change `py-1.5` to `py-2`. One
   28 px line plus 16 px of padding is exactly 44; a wrapped row on a phone gets 4 px taller.
   Do NOT put `min-h-11` on the row: `PageChip` has no fixed height and would stretch to fill it.
6. **The test's excuses** (`tests/trust.spec.ts`): delete every entry of `SHORT_ELSEWHERE`, and
   the constant and the `excused` parameter of `shortControls()` with it — the sweep must guard
   every control with no exceptions. Then widen what it walks (see Tests).

Nothing else changes: no new colour, font or icon; no change to `/search`'s own box, the reader,
the mushaf, the drawer or the header row; nothing outside the six files above and the tests.

---

# Constraints — restated, because they are not negotiable

- **No budget, ever.** Supabase Free (500 MB database / 1 GB storage / 5 GB egress / 50,000 MAU /
  paused after a week idle) and Vercel Hobby (cron minimum once a day, and that one slot is
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
- **Search operators stay removed.** Typed text is one literal phrase. This task touches how
  results are laid out, never how they are found: no change under `lib/search/`, no change to
  any SQL, no new migration.
- **AI is bring-your-own-key and browser-only.** Do not touch `lib/ai/`.
- **The desktop repo is a read-only reference.** Never modify anything there.
- **RLS stays on every table**; `/admin` and every mutating Server Action re-verify the role
  server-side — do not touch `lib/admin/guards.ts` or any policy.
- **Never edit an applied migration** — always a new file in `supabase/migrations/` (none is
  needed here).
- **Do not weaken the CSP**; no third-party runtime script or CDN.
- Ported CSS lives in `@layer components` (unlayered CSS beats Tailwind utilities).
- No `git add -A` / `git add .` / `git commit -a`. One commit:
  `fix(mobile): make every remaining control at least 44 px tall`. **Ask the owner before
  pushing.**

---

# Tests

- Record the before sizes first, on the dev server, with the same sweep the trust spec uses:
  the eight rows of the table above, at 360×640, 375×667, 390×844 and 1280×800.
- `npm run typecheck && npm run lint && npm run build` — green.
- **`tests/trust.spec.ts` «the shell's tap targets»**, with `SHORT_ELSEWHERE` gone, extended to
  walk, at the project viewport and at 360×640:
  - `/`, `/about`, `/search` and the seeded book page, as today;
  - the seeded author's page, `/authors/` + `encodeURIComponent("سىناق ئاپتور")` — its trail
    links (`authors-breadcrumb` and the «كۇتۇپخانا» before it) are ≥ 44 px;
  - `/search?q=` + `encodeURIComponent(SEED_NEEDLE)`: `search-book-title` and every
    `search-result` ≥ 44 px, then after tapping `expand-book-matches` and waiting for the first
    `expanded-match`, every `expanded-match` ≥ 44 px and the sweep still clean;
  - on the phone viewports, the home page with the search panel open (tap the button
    `aria-label="ئىزدەش رامكىسىنى ئېچىش"`): `header-search-mobile` ≥ 44 px, the panel not
    covering the row beneath it, and the sweep clean; on the desktop viewport `header-search`
    ≥ 44 px and the header row still 64 px.
  - A book page WITH a trail: give the seeded book a `category_id` in `tests/auth.setup.ts` —
    the first row of `categories` by `sort_order`, read with the service-role client the setup
    already holds; skip that one assertion, with a message, if the library has no categories.
    Then assert the trail's links on the seeded book page are ≥ 44 px. If another spec objects
    to the seeded book belonging to a category (a count, a shelf, a JSON-LD genre), say so in
    the report and fall back to measuring the trail on the author page only — the two share one
    component after step 2, so that still proves the shape.
  - The sweep must find **nothing** under 44 px on any of those pages, with no exception list.
- Every existing suite green — in particular `discovery.spec.ts` (the strip's heading row and
  the authors breadcrumb), `search-library.spec.ts` and `search-expander.spec.ts` (they click
  rows and measure the expander), `search-scope.spec.ts` and `keyboard.spec.ts` (the search
  pill), and the whole of `trust.spec.ts`. Known flaky, on any tree: `keyboard.spec.ts:151`,
  `notes-ai.spec.ts:249`, `reader-ai.spec.ts:498`, `reader-ai.spec.ts:534`,
  `offline.spec.ts:181`, `navigation.spec.ts:331`, `upload-wizard.spec.ts:342`. A failure
  elsewhere is yours until it passes three times alone.
- Prove the new assertions bite: run them once against the unchanged component files
  (`git stash push -- <the six files>`, run, `git stash pop`) and confirm they fail there.
- Screenshots at 360×640 and 390×844, before and after, and look at them: the new-books heading
  row, a book page's trail, the home page with the search panel open, and a results page with
  one group expanded — same text, order and colours, only more room around the links. Byte-compare
  the header row before and after: it must be identical.

---

# Acceptance criteria

1. On `/`, `/about`, `/search`, a search WITH results (before and after expanding a group), a book
   page with a trail, an author page, and the home page with the phone's search panel open, no
   visible `a`, `button`, `input` or `select` outside running text is under 44 px tall — at 360,
   375, 390 and 1280 px. `SHORT_ELSEWHERE` no longer exists.
2. Everything looks the same at a glance: same text, order, colours and hover; the header row is
   still 64 px; the strip's heading row still obeys the discovery spec's centring rules; nothing
   scrolls sideways at 360 px; no two tap boxes overlap.
3. Typecheck, lint, build and all suites green, with the known-flaky list above as the only
   allowance.

---

# The report

Report in **simple Uyghur**: a before/after table for all eight rows of the finding (size at
each width), how much taller each affected area became, the verdict on the four screenshot pairs,
and whether the seeded book could be given a category or the author-page fallback was used.

**If any of these cannot reach 44 px without something visibly moving — the title on a book page
jumping more than about 25 px, the results page changing its rhythm, the search pill growing past
46 px, or the strip's centring rules breaking — stop and ask the owner in Uyghur** before choosing
for him.
