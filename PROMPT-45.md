# PROMPT 45 — خاتىرە دەپتىرى، 4-باسقۇچ (9 دىن): تەھرىرلەش دېگىنىنى قىلسۇن

**قانداق ئىشلىتىسىز:** `PROMPT-44.md` تاماملىنىپ سايتقا چىققاندىن **كېيىن** ئىشلىتىڭ. Claude Code نى
`BilimHezinisi-website` قىسقۇچىدا **يېڭى تۈر** قىلىپ ئېچىڭ، «---» دىن كېيىنكى پۈتۈن ئىنگلىزچە قىسمىنى
چاپلاڭ. تۈگىگەندىن كېيىن `PROMPT-46.md` غا ئۆتۈڭ.

> **بۇ نېمە ئىش:** (1) «ھەممىنى ئالماشتۇرۇش» خاتىرە ماۋزۇ، نەقىل ياكى تىزىملىك بىلەن باشلانسا
> پۈتۈن خاتىرىنى بۇزىدۇ — مەسىلەن ھەممىسى ماۋزۇغا ياكى نەقىلگە ئايلىنىپ قالىدۇ. (2) ماۋزۇ ياكى
> نەقىلنى ئادەتتىكى تېكىستكە قايتۇرغىلى بولمايدۇ. (3) تېلېفوندا «يېنىۋېلىش» يوشۇرۇن، «قايتىش»
> نىڭ بەلگىسى «يېنىۋېلىش» قا ئوخشايدۇ. (4) iPhone دا ئىملا تەكلىپ تاختىسى بىردىنلا يوقاپ كېتىشى
> مۇمكىن. (5) تېلېفوندا قورال بالدىقى ئېكراندىن بەك كۆپ ئورۇن ئالىدۇ (Claude Code ئاۋۋال ئۆلچەيدۇ). بۇ باسقۇچ بۇلارنىڭ ھەممىسىنى
> ئوڭشايدۇ ۋە Chrome، Firefox، iPhone دا سىنايدۇ.
>
> **تۈگىگەندىن كېيىن سىناڭ:** ماۋزۇ بىلەن باشلانغان خاتىرىدە بىر سۆزنى «ھەممىنى ئالماشتۇرۇش» قىلىڭ —
> خاتىرىنىڭ شەكلى ئۆزگەرمەسلىكى، «ھەممىنى يېنىۋېلىش» بىر بېسىشتا ئەسلىگە قايتۇرۇشى كېرەك. تېلېفوندا
> «يېنىۋېلىش» ۋە «قايتىلاش» كۇنۇپكىلىرى بىرىنچى قۇردا كۆرۈنۈشى كېرەك.

---

You are continuing an existing, live project. Read `CLAUDE.md` in this folder FIRST — it is the
project instruction and always wins — and use the **bilim-web** skill.

This is **stage 4 of 9** of the notebook plan (`PROMPT-42.md` … `PROMPT-50.md`, from
`AUDIT-2026-10-07.md`). **Do only this stage.** Stage 5 (version history) will take a snapshot
before a replace-all and will restore whole documents through the single "replace the whole
document" helper stage 2 created — keep that helper the only place that does it.

## Before you start

1. `git status`, `git log --oneline -20`. Stage 3 (PROMPT-44: note quota migration, rate limits,
   usage line) must be merged, its migration applied by the owner, and deployed. If not, **stop and
   tell the owner in Uyghur** that PROMPT-44 must be finished first. Uncommitted changes you did not
   make → stop and ask.
   Untracked planning files in the root (`PROMPT-*.md`, `AUDIT-*.md`, `HANDOFF-*.md` and the like)
   are the owner's and expected: leave them where they are and do not commit them.
2. Read the *Project context* files in full. Run the notebook specs once on all engines to see the
   starting point, including the `test.fixme` list stage 1 left for this stage.

## What is broken (with evidence)

### N7 (P1) — replace-all rewrites the structure of the whole note

`components/notes/find-bar.tsx` lines 172–174 write the replaced document back with
`execCommand("selectAll")` + `execCommand("insertHTML", wholeDocument)`. Measured in Chromium 141,
replacing «ئالما» with «ئۆرۈك» (the expected output is `replacedHtml()`'s own result):

| Note starts with | Result |
|---|---|
| a heading `<h2>…</h2><div>…</div><div style="text-align: center;">…</div>` | everything after the first heading nested inside a **second `<h2>`** — the whole note turns into heading text |
| a citation (the shape `lib/notes/insert.ts` inserts: `<blockquote>…</blockquote><p><a>…</a></p><p><br></p>`) | the **whole note nested inside the `<blockquote>`** |
| a list `<ul>…</ul><div>…</div>` | the following paragraph **moved into the list** |
| plain text | correct, but each run wraps the note in another `<div><p>` layer |

Selecting a Range around all children instead of `selectAll`, or deleting first and
`formatBlock("div")` before inserting, still corrupts the list case. Whole-document `insertHTML` is
not a safe primitive in this editor. Ctrl+Z does restore it in one step, but autosave stores the
damage 1.2 s later, and phones have no Ctrl+Z.

What did work, in all four cases: replacing **each hit with `execCommand("insertText")` on its own
Range, from the last hit to the first** (every hit lies inside one text node — `lib/notes/find.ts`
guarantees it). The structure came out byte-identical to `replacedHtml()`. Cost: one native undo
step per hit (3 hits → 3 undos), and raw `execCommand` time on a 60,000-character note of
**26 ms for 50 hits, 177 ms for 300, 707 ms for 1,000** (headless Chromium, before the app's own
input handlers run). Also measured: after a direct `editor.innerHTML = …`, Chromium's `undo` became
a no-op instead of damaging anything — verify the same in Firefox and WebKit before relying on it.

### N9 (P2) — a heading or quote cannot become normal text again

Chromium 141: `formatBlock("<h2>")` twice, then `removeFormat` → still `<h2>`. There is no
"normal text" control (`note-editor.tsx` lines 464–475).

### N11 (P2) — undo is hidden on phones, and "back" looks like "undo"

«يېنىۋېلىش»/«قايتىلاش» live inside «باشقا ئىقتىدارلار» (lines 554–555); phones have no Ctrl+Z,
yet the find bar's notice says «يېنىۋېلىش (Ctrl+Z) بىلەن ئەسلىگە قايتىدۇ» (`find-bar.tsx` line
176). The back link (line 438) uses the same `undo` icon as the undo button, so a writer who wants
to undo can leave the note instead.

### N16 (P2, suspicion — verify in WebKit) — the spell popup closes on any scroll

`use-spellcheck.ts` lines 174–183 close the popup on every `scroll` (capture) and `resize`. On an
iPhone, focusing the editor brings up the keyboard and scrolls the page, which can close the popup
the moment it opens.

### N18 (P3, estimate — measure it) — the toolbar takes too much of a phone screen

At 375 px the second toolbar row holds up to 12 controls of 44 px and wraps, giving a sticky header
of roughly three rows (~160 px). With the on-screen keyboard open, that may leave ~200 px to write
in.

## Project context

Read in full: `components/notes/find-bar.tsx`, `lib/notes/find.ts`, `tests/unit/note-find.test.ts`,
`components/notes/note-editor.tsx` (as changed by stages 1–3, including stage 2's whole-document
helper), `components/notes/use-spellcheck.ts`, `components/notes/spell-popup.tsx`,
`components/notes/ai-panel.tsx` (its own snapshot undo for proofreading),
`components/icons.tsx` and how its sprite is built (`scripts/build-icons.mjs`), `app/globals.css`
(`.ibtn`, `.hbtn`, notebook styles), `tests/notes.spec.ts`, `tests/notes-sources.spec.ts`,
`playwright.config.ts`.

## Non-negotiable constraints (restated from `CLAUDE.md`; they win over anything here)

- **No budget, ever.** No paid service, no new vendor, no runtime CDN.
- **Anonymous reading always works.** RTL Uyghur UI; code, comments and commits in English.
- **Mobile Rules are hard:** `100dvh` never `100vh`; safe-area padding on sticky bars; ≥ 44 px
  targets; nothing hover-only; **no horizontal scroll at 360 px**; every control visible and
  tappable after scrolling down and back up; **no auto-hiding toolbar**; `overscroll-contain` on
  popovers and menus; logical properties only.
- Editor stays an uncontrolled `contentEditable` + `execCommand`; no editor library; marks stay
  painted with the Custom Highlight API. AI stays BYOK, browser-only.
- **No native dialogs.** Keep existing `data-testid`s stable (update specs only where a control
  legitimately moved into «باشقا ئىقتىدارلار»).
- A note is private: invented text in tests; nothing real in logs, `docs/` or commits.
- Never edit an applied migration (none needed here); RLS on every table; do not weaken the CSP.
- **Never load-test production.**

## What to do

### A. Replace without touching structure (N7)

- **Replace one:** select the current hit's Range and `execCommand("insertText", replacement)` —
  one native undo step.
- **Replace all:** apply the same per-hit `insertText` from the last hit to the first, inside a
  **batch**: the editor exposes a way for the find bar to run several commands while its `onInput`
  side effects (autosave scheduling, recount, revision bump, spellcheck scheduling, stage 2's
  draft write) are suppressed, then runs them **once** at the end. The page must not jump; leave the
  caret at the current hit.
- Before the batch, keep the document's HTML as a snapshot. After it, the find bar's notice shows
  «{n} ئورۇن ئالماشتۇرۇلدى.» and a button «ھەممىنى يېنىۋېلىش» (≥ 44 px). It runs exactly `n`
  native `undo` commands (as one batch), then checks that the editor's HTML equals the snapshot;
  if it does not (browsers cap the undo stack; engines differ), it writes the snapshot back through
  stage 2's whole-document helper. The button disappears on the next edit of any kind, on closing
  the find bar, or after it is used.
- Remove `replacedHtml` and its tests if nothing uses it any more (no dead code); keep and extend the
  tests that prove structure is preserved.
- Add a guard unit test that fails if `execCommand("selectAll"` (or a whole-document `insertHTML`)
  appears anywhere under `components/notes/` or `lib/notes/`.
- Performance: on a generated 60,000-character note, replace-all of **300 hits completes within
  1 s** at 1280×800 in Chromium, and **within 3 s with 4× CPU throttling** (Chrome DevTools Protocol
  `Emulation.setCPUThrottlingRate`). If you cannot meet that, stop and ask with your numbers.

### B. A block-style control with "normal text" (N9)

Replace the separate «ماۋزۇ» and «نەقىل» buttons with one block-style control (a small menu, tap
only, ≥ 44 px items, `overscroll-contain`) offering «ئادەتتىكى تېكىست», «ماۋزۇ» (`h2`), «نەقىل»
(`blockquote`), showing which one the caret is in. «ئادەتتىكى تېكىست» must turn back into the
editor's normal block (whatever Enter produces in that engine — check; `div` in Chromium) for: a
heading, a quote, a quote holding several lines, and a heading that is the first block of the
note. Each change is one native undo step. Verify on Chromium, Firefox and WebKit; if an engine
cannot do this through `execCommand`, **stop and report that engine's exact behaviour** before
inventing a custom undo layer.

### C. Undo/redo in reach; back is not undo (N11)

- «يېنىۋېلىش» and «قايتىلاش» are in the first tool row on every viewport.
- The back link gets its own icon — an arrow pointing to the start side (right, in RTL). The sprite
  has none (`chevron-up/down` only); add one symbol in the same stroke style through the existing
  icon pipeline. Keep its label «خاتىرىلەر تىزىملىكى».
- No UI text may tell the writer to press Ctrl+Z; name the button instead.

### D. The spell popup stays while its word is visible (N16)

Replace "close on any scroll/resize" with: reposition on `scroll`, `resize` and
`visualViewport` `resize`/`scroll` (one `requestAnimationFrame` per frame at most); close only
when the word leaves the visible area, on an outside tap, on Escape, or on an edit. Verify on WebKit
at 390×844 (mobile) that tapping a word opens a popup that stays open.

### E. A phone toolbar that leaves room to write (N18)

First **measure and record** in your report the sticky header's height at 360×740, 375×667, 390×844
and 1280×800 (overflow closed, find bar closed; then with the find bar open).

Target on phones (< 640 px wide), overflow and find bar closed: **a title row plus one tool row,
header ≤ 112 px**. Suggested placement by how often a writer needs it:

- Title row: back · title · save state · spellcheck toggle · AI (only when available) — the title
  shrinks and truncates.
- Tool row: «يېنىۋېلىش» · «قايتىلاش» · «توم» · block style · list (bulleted/numbered as a small
  menu) · «مەنبە قىستۇرۇش» · «باشقا ئىقتىدارلار».
- Inside «باشقا ئىقتىدارلار»: find and replace, italic, underline, alignment, colour, clear
  formatting, Word export, typography — everything still one extra tap away, nothing hover-only.

From 640 px up, lay controls out as space allows (one or two rows). Seven 44 px controls plus their
gaps must fit inside 360 px with no horizontal scroll and no target under 44 px. If this does not
fit, or if moving something into the overflow would hide a control writers need constantly, **stop
and ask with screenshots at 360, 375 and 390 px**.

## Tests

- `npm run typecheck`, `npm run lint`, `npm run build`, `npm run test:unit`, full Playwright suite
  green — Chromium 375×667, 390×844, 1280×800 and the Firefox/WebKit notebook projects. Remove every
  `test.fixme` stage 1 left for N7, N9, N11 or N16 and make those tests pass.
- **Unit (jsdom):** find/replace fixtures for notes starting with a heading, a citation, a list and
  plain text — structure identical after replace-one and replace-all; the guard test from A.
- **Playwright on every engine:**
  1. The four fixtures above: replace-all → `note-body` HTML equals the expected HTML exactly;
     «ھەممىنى يېنىۋېلىش» → equals the original exactly; the button is gone after the next keystroke.
  2. Replace-one changes only the current hit; one tap on «يېنىۋېلىش» reverts it.
  3. Performance check from A (Chromium only), with the numbers printed in the test output.
  4. Block style: heading → normal, quote → normal, multi-line quote → normal, first-block heading →
     normal; each reverted by one «يېنىۋېلىش».
  5. Back link and undo look different (different icon) and both work.
  6. WebKit mobile: tap a misspelled word → popup opens and stays open for 2 s without interaction;
     scroll the word off screen → popup closes.
  7. Header height ≤ 112 px at 360/375/390 px with overflow and find closed; no horizontal overflow
     at 360 px; every toolbar control (including those inside «باشقا ئىقتىدارلار») visible and
     tappable after scrolling down and back up.

## Acceptance criteria

1. Replace-one and replace-all never change a note's structure, on any engine, whatever the note
   starts with; «ھەممىنى يېنىۋېلىش» restores the note exactly in one tap.
2. No code path replaces the whole document with `selectAll` + `insertHTML`.
3. Any heading or quote can be made normal text again, in one undoable step.
4. Undo and redo are visible in the first tool row on phones; back and undo are visually distinct;
   no text mentions Ctrl+Z.
5. The spell popup stays open while its word is visible, on WebKit mobile too.
6. On phones the header is ≤ 112 px with overflow and find closed; measurements are in the report.
7. typecheck, lint, build, unit and all Playwright projects green, with no `fixme` left for these
   findings.

Commit per logical step (`fix(notes): replace without rewriting the whole note`,
`feat(notes): block style with normal text`, `fix(notes): keep undo in reach on phones`,
`fix(spellcheck): keep the popup while its word is visible`, `feat(notes): a one-row phone
toolbar`). Push, check `https://bilimhezinisi.com/notes` with a test account, and finish with a
short report **in simple Uyghur**: what changed, the header measurements, and what to try on his
phone.

If anything here conflicts with `CLAUDE.md`, or you would have to trade away the writer's text,
mobile quality or the free-tier limits to finish it, **stop and ask the owner in Uyghur** — never
make that trade silently.
