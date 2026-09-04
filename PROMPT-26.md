# PROMPT 26 — ئىزدەش رامكىسىنىڭ ئىچىگە تۈر تاللاش

## قانداق ئىشلىتىسىز (يېڭى تۈر ئېچىپ)
1. Claude Code نى ئېچىپ **BilimHezinisi-website** قىسقۇچىنى تاللاڭ.
2. سىزىقتىن تۆۋەنكى تېكىستنى پۈتۈنلەي كۆچۈرۈپ چاپلاڭ.

> **مەسىلە:** ھازىر باش بەتتىكى ئىزدەش رامكىسى ھەمىشە پۈتۈن كۇتۇپخانىدىن ئىزدەيدۇ.
> تۈر تاللاش پەقەت نەتىجە چىققاندىن كېيىنكى بەتتە پەيدا بولىدۇ، شۇڭا ئوقۇرمەن ئىككى
> قېتىم ئىزدەشكە مەجبۇر.
>
> **قىلىنىدىغىنى:** ئىزدەش رامكىسىنىڭ **ئىچىگە** بىر تاللاش قوشۇلىدۇ. ئۇ ھەمىشە
> «بارلىق كىتابلار» دەپ تۇرىدۇ؛ بېسىلسا ئوڭ يان تەرەپتىكى تۈرلەر تىزىملىكىگە ئوخشاش،
> سىنبەلگىلىك بىر تىزىملىك ئېچىلىدۇ. ھەر تۈرنىڭ يېنىدا كىتاب سانى تۇرىدۇ، كىتابى يوق
> تۈرلەر كۈلرەڭ بولۇپ بېسىلمايدۇ.
>
> **بۇنىڭدىن باشقا ھېچنېمە ئۆزگەرمەيدۇ.** ئىزدەشنىڭ ئۆزى، ئىزدەش قائىدىسى، نەتىجە
> كۆرسىتىش — ھەممىسى ئەينەن قالىدۇ.

---

You are continuing an existing, live project. Read `CLAUDE.md` in this folder FIRST —
it is the project instruction and always wins — and use the **bilim-web** skill.

## What this task is

Add a **category scope control inside the search box**, so a reader can choose which part
of the library to search *before* searching, from any page. Today the only category
filter lives on `/search`, which means it is only reachable after a search has already
run across the whole library.

This came from the owner, who found it himself and chose the design. Three decisions are
already made and are **not** open for re-litigation:

1. The control lives **inside the search box**, not beside it.
2. The panel it opens looks like the **right-hand category sidebar**: the same icons, the
   same row shape, the same colours.
3. **Each row shows how many published books the category holds**, and a category with
   zero books is greyed out and not selectable.

## Project context — what already exists, do not rebuild it

Next.js 16 (App Router) + TypeScript + Tailwind on **Vercel Hobby**, Supabase Free.
GitHub `kelemdepter-rgb/BilimHezinisi-website`. Live at `https://bilimhezinisi.com`;
the old `bilim-hezinisi-website.vercel.app` 308-redirects to it. Phases 1–25 are deployed:
design tokens, RTL shell, auth with `admin`/`uploader`/`reader`, RLS on every table,
`ug_normalize()`, the admin category tree and upload wizard, the library home, the reader,
global search, the Qur'an module, the notebook with spellcheck, PWA offline reading,
sharing, discovery pages, and a browser-only bring-your-own-key Gemini layer.

The pieces this task touches, as they stand today:

- **`components/app-shell.tsx`** — the header. It holds `<form role="search" action="/search" className="sbox mx-2 hidden md:flex">` for `md` and up, and a separate copy inside the `mobileSearchOpen` panel below `md`. Neither form carries a `cat` field. It also holds `SidebarContent`, which renders the category tree (desktop sidebar + mobile drawer) with `CategoryRow`.
- **`components/search/search-field.tsx`** — the input itself, plus the Uyghur keyboard button and the recent-search history dropdown. It deliberately does **not** own the `<form>`; it attaches to whichever form it is inside, so search still works with no JavaScript.
- **`app/search/page.tsx`** — the results page. It already has a plain `<select className="field w-auto" name="cat">` listing `getCategories()` unindented, and it already reads `?cat=` and passes it to `runBookSearch`.
- **`lib/data.ts`** — `getCategories()`, an `unstable_cache` read tagged `CATEGORIES_TAG`, wrapped in `cache()`.
- **`lib/library.ts`** — `listBooks()`, which resolves a category through `categoryWithDescendants()` so browsing a parent shows the children's books too.
- **`supabase/migrations/0020_faster_one_matcher.sql`** — the current `search_books` RPC.
- **`app/globals.css`** — `.sbox`, `.sinput`, `.field`, `.hbtn`, `.ibtn`, `.paper`, `.ic`.

---

# The work

## 1. The scope control

**Where it goes.** At the **inline-end** of the `.sbox` pill — the side the owner circled
in his screenshot, which in RTL is the left. Order inside the box becomes:

```
[🔍 icon]  [ the input, flex-1 ]  [⌨ keyboard button]  │  [بارلىق كىتابلار ▾]
```

Separate it from the keyboard button with a hairline divider using a **logical** property
(`border-inline-start`, i.e. Tailwind `border-s`), never `border-l`.

**What it shows.** The name of the current scope plus a chevron. Default text:
`بارلىق كىتابلار`. When a category is chosen, that category's name, truncated — the input
must never be squeezed below a usable width. Give it a `data-testid`.

**Space.** The `.sbox` is `flex: 1; max-width: 540px`. At `md` (768 px) the header is
already carrying the menu button, the brand, four end controls and this box, so there is
roughly 350 px for the whole pill. Decide a breakpoint below which the button collapses
to **icon + chevron only** (with an `aria-label` carrying the full name), and **say in
your report what breakpoint you chose and why**. Do not let the placeholder text
disappear entirely, and do not let the row overflow.

**The panel.** A popover anchored to the box, built to look like `SidebarContent`'s
category list:

- `.paper` surface with `shadow-[var(--shadow-2)]`, the same radius tokens.
- First row: **`ھەممە كىتابلار`** with the `layers` icon in `text-am` — exactly like the
  existing `data-testid="category-all"` row. It is the default and is selected when no
  category is active.
- Then one row per category, `<Icon name={(category.icon || "folder")} className="text-am" />`,
  `min-h-11`, `rounded-[var(--radius)]`, `hover:bg-bg2 hover:text-ink`, name truncated.
- Nested categories indent the way the sidebar does (`ms-4 … border-s border-bd ps-2`).
  The tree is flat today; it will not always be.
- **Book count** at the row's inline-end in `text-ink3`, small.
- A category with **0 books** is `opacity-50`, `aria-disabled="true"`, and does nothing
  when tapped. Do not hide it — the owner wants to see that it exists and is empty.
- The currently chosen row is marked (a check icon or the `on` treatment already used by
  `.hbtn.on`), and carries `aria-selected` / `aria-checked` correctly.
- The panel scrolls when it is taller than the space available: `max-h-…`,
  `overflow-y-auto`, **`overscroll-contain`**. It must never lock or trap the body scroll.
- Closes on: choosing a row, tapping outside, `Escape`, and navigation. `search-field.tsx`
  already implements exactly this pattern for the history dropdown — copy it rather than
  inventing a second one.
- Keyboard: reachable by Tab, arrow keys move between rows, `Enter` chooses.

**What choosing a row does.** It sets the scope and **does not** navigate on its own. The
reader then types and submits as usual, and lands on `/search?q=…&cat=N`.

## 2. It must still work with JavaScript off

The whole search box is deliberately a plain `<form action="/search">` that submits
without JavaScript. Do not break that.

Pick one of these and **state which you chose and why**:

- a real `<select name="cat">` as the base, with the custom panel as a progressive
  enhancement layered over it; or
- a `<input type="hidden" name="cat">` that the control writes to — in which case, with
  JavaScript off, the box still submits and still searches **all** books.

Either is acceptable. Silently shipping a search box that submits nothing is not.

## 3. Where the control appears

- The header form at `md` and up.
- The header's **mobile** search panel (`mobileSearchOpen`), where the box is full width
  and there is room for the label.
- **`/search`** — replace the existing plain `<select name="cat">` with the same
  component, so there is one control and one design, not two.

**Default state (owner's decision):** always `بارلىق كىتابلار`, on every page — including
while the reader is browsing inside a category at `/?cat=N`. The only exception is
`/search` itself, where it reflects the active `?cat=` so the reader can see and change
what is filtering the results they are looking at.

## 4. Book counts

The picker and **the sidebar/drawer category list** both need a per-category count of
**published** books.

- Add one cached read — not a query per category, and not a query per request. A single
  `select category_id from books where status = 'published'` grouped in JavaScript is
  fine at this size (42 books today; a few hundred later) and costs one round trip.
- Cache it with `unstable_cache` tagged **`BOOKS_TAG`** so the admin's own writes drop it,
  with the same `CACHE_SECONDS` revalidate as the category tree, and wrap it in `cache()`
  so the header, the picker and the page share one call per render.
- A count must be **tree-aware**: a parent's number includes its descendants, matching
  what `listBooks` actually shows when that parent is opened. Reuse
  `categoryWithDescendants` from `lib/library-types.ts`; do not write a second walker.
- Note in your report that a book written straight into Postgres (the migration script,
  the SQL editor) will not drop this tag, so a count can be up to `CACHE_SECONDS` stale.
  That is acceptable for a count. Do **not** "fix" it by uncaching.
- The sidebar gets the same numbers and the same greying-out — this is the owner's
  explicit request, not an extra.

## 5. Fix the subcategory bug while you are here

This is part of making the picker honest, so it belongs in this change and nowhere else.

**The bug.** Browsing and searching disagree about what a category means:

- `lib/library.ts` → `listBooks()` resolves a category through `categoryWithDescendants()`,
  so opening a parent shows the children's books.
- `supabase/migrations/0020_faster_one_matcher.sql` → `search_books` filters
  `b.category_id = search_books.category_id` — the exact category only.

So the moment the owner creates a subcategory, browsing «تارىخ» will show a book that
searching «تارىخ» cannot find. The tree is flat today (17 categories, no nesting), which
is the only reason nobody has hit it.

**The fix.** Add a **new** migration — `supabase/migrations/0023_search_category_tree.sql`
(check the folder for the highest number and continue from it; **never edit an applied
migration**). `create or replace function public.search_books(...)` with the identical
signature and identical ranking, snippets, title boost, 301-candidate cap and `capped`
flag as 0020, changing **only** the two category predicates so that `category_id` means
"this category and everything beneath it" — a recursive CTE over `public.categories`,
computed once and joined, not a correlated subquery per row.

Do not change anything else in that function. Re-read 0020's comments before you touch it:
the `as materialized` CTE and the `strpos`-after-match snippet are load-bearing
performance work, and undoing either would cost about 270 ms and 55 ms per call
respectively. Keep `security definer`, `set search_path = ''` and the `grant execute … to
anon, authenticated`.

Measure `search_books` before and after with a common word (`ناماز` is a good one — it
currently returns in about 0.42 s) and **report both numbers**. If the recursive CTE costs
more than about 50 ms on the flat tree we have, stop and say so instead of shipping it.

---

# Constraints that do not move

- **No budget, ever.** Supabase Free (500 MB database / 1 GB storage / 5 GB egress /
  50,000 MAU / paused after a week idle) and Vercel Hobby (cron minimum once a day, and
  that slot is already used by `/api/health`; single function region; non-commercial
  personal use). No paid service, no new vendor account, no new npm dependency for a
  dropdown — build it with what is already here.
- **Anonymous reading always works.** The picker must work fully for a signed-out
  visitor; that is most of the audience.
- **RTL Uyghur UI.** Logical properties only — `ps-*`, `pe-*`, `ms-*`, `me-*`, `start-*`,
  `end-*`, `text-start`, `border-s`, `border-e`. Never physical `left`/`right`. Code,
  comments and commit messages in English; Uyghur only in UI strings.
- **Mobile Rules in `CLAUDE.md` are hard requirements.** `100dvh` never `100vh`, safe-area
  padding on fixed/sticky bars, touch targets ≥ 44 px, no hover-only affordances, no
  horizontal scroll at 360 px, no trapped body scroll, and every control still visible and
  tappable after scrolling down and back up.
- **Search operators stay removed.** No quoted phrases, no `OR`, no `-exclusion`. Typed
  text is one literal phrase. A category filter is a filter, not an operator.
- **Do not weaken the CSP** and add no third-party script or CDN. The panel is your own
  markup and your own CSS.
- **Do not touch RLS, the role checks, or `lib/ai/`.**
- **Do not touch `lib/legacy-host.ts`, `proxy.ts`, `lib/seo.ts`, `public/sw.js` or
  `lib/pwa/constants.ts`** — the 2026-08-29 domain migration is settled.
- **Never edit an applied migration.** New file only.
- Do not run `git add -A` / `git add .` / `git commit -a`. Stage only the files you
  changed. `git push` deploys to the live library — **ask the owner in Uyghur before
  pushing.**
- Do not fix anything from `AUDIT-2026-09-02.md` other than what this prompt names.
  `PROMPT-27.md` and `PROMPT-28.md` own the rest.

---

# Tests

- `npm run typecheck && npm run lint && npm run build` — green.
- Every existing unit and Playwright suite green. Five tests are known to be flaky or
  pre-existing failures — `keyboard.spec.ts:151`, `ai.spec.ts:148`, `ai.spec.ts:261`,
  `offline.spec.ts:181`, `reader-ai.spec.ts:534`. If one of those fails, say so and move
  on; do not chase it and do not treat it as caused by this change.
- `tests/unit/sql-parity.test.ts` must still hold the SQL matcher to the client matcher.
  If your migration changes what matches — it must not — that test will tell you.
- **New tests, at 375×667, 390×844 and 1280×800:**
  - the scope control is present in the header search box and reads `بارلىق كىتابلار` by
    default, for a signed-out visitor, on `/`, `/?cat=15` and `/quran`;
  - tapping it opens the panel; the panel shows every category with its book count and the
    `ھەممە كىتابلار` row at the top;
  - a category with 0 books is not selectable;
  - choosing a category and submitting lands on `/search?q=…&cat=N` and the results page
    shows that category selected;
  - the panel closes on outside tap and on `Escape`;
  - **no horizontal overflow at 360 px** on `/`, `/search` and `/quran`;
  - the panel scrolls inside itself and does not lock body scroll — after opening and
    closing it, the page still scrolls;
  - every control in the header is still visible and tappable after scrolling down and
    back up;
  - on mobile, the control is reachable inside the search panel that the magnifier opens.
- **A migration test:** searching a parent category returns a book that lives in a child
  category. Seed the fixture tree for this — do not test it against production data, and
  do not create anything in the live project.

---

# Acceptance criteria

1. From the home page, with no account, a reader can choose a category and then search,
   in one pass, and the results are limited to that category.
2. The default is `بارلىق كىتابلار` on every page except `/search`, where it mirrors
   `?cat=`.
3. The panel looks like the right-hand sidebar: same icons, same row height, same colours,
   same tokens. No new colour, no new font, no new dependency.
4. Every category row shows its published-book count; the seven empty categories are
   greyed out and cannot be chosen; the sidebar and drawer show the same numbers.
5. Searching a parent category also finds books in its subcategories, and `search_books`
   is no slower than it was — with both measurements in the report.
6. Nothing overflows, hides a control, or traps scroll at 360, 375, 390 or 1280 px.
7. With JavaScript disabled the search box still submits and still returns results.
8. No CSP change, no RLS change, no edited migration, nothing from earlier phases
   regressed — the domain redirect, the reader, the Qur'an module, the notebook and the
   AI layer all still work.

Commit as one logical change with an English conventional message. Report in **simple
Uyghur**: what you added, the breakpoint decision and why, the no-JavaScript decision and
why, the two `search_books` timings, and the test results viewport by viewport.

**If the scope control cannot be fitted inside the search box at 360 px without squeezing
the input below a usable width or pushing a header control off screen, stop and ask the
owner in Uyghur.** He would rather choose between a smaller label and a control outside
the box than receive a header that is broken on a phone.
