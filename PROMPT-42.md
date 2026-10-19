# PROMPT 42 — خاتىرە دەپتىرى، 1-باسقۇچ (9 دىن): ئىملا تەكشۈرگۈچ قۇرلارنى چاپلاشتۇرمىسۇن


You are continuing an existing, live project. Read `CLAUDE.md` in this folder FIRST — it is the
project instruction and always wins — and use the **bilim-web** skill.

This is **stage 1 of 9** of the notebook plan (`PROMPT-42.md` … `PROMPT-50.md`), which comes from the
audit `AUDIT-2026-10-07.md` (Uyghur; finding numbers N1–N24 below refer to it). **Do only this
stage.** Later stages depend on what you build here, so build it cleanly and leave the code ready
for them; do not start their work.

## Before you start

1. `git status` and `git log --oneline -15`. If the working tree has uncommitted changes you did not
   make, or local commits that are not on `origin/main`, **stop and ask the owner in Uyghur** what
   to do with them before touching anything.
   Untracked planning files in the root (`PROMPT-*.md`, `AUDIT-*.md`, `HANDOFF-*.md` and the like)
   are the owner's and expected: leave them where they are and do not commit them.
2. Read the files listed under *Project context* in full before writing code.

## What is broken (with evidence)

### N1 (P0) — the spellchecker glues the last word of a line to the first word of the next

Reported by the owner on 2026-10-07 with screenshots: he typed a misspelled word at the end of a
line, pressed Enter, and typed on the new line. The spell popup's title showed one glued word,
«سىلىشتۇرسۇكىشىلەر». Picking a suggestion deleted the first word of the new line **and** the line
break.

Reproduced in Chromium 141 with the exact algorithms of `lib/spellcheck/marks.ts` (`readTextMap`,
`locate`, `rangeFor`), `lib/spellcheck/dictionary.ts` (`tokenize`, `WORD_PATTERN`) and
`components/notes/use-spellcheck.ts` (`applySuggestion`):

| Step | Result |
|---|---|
| Typed `ئۇسۇلى بىلەن سىلىشتۇرسۇ`, Enter, `كىشىلەر ياخشى` | HTML `ئۇسۇلى بىلەن سىلىشتۇرسۇ<div>كىشىلەر ياخشى</div>` |
| `readTextMap(editor).text` | `"ئۇسۇلى بىلەن سىلىشتۇرسۇكىشىلەر ياخشى"` — no separator between the two blocks |
| `tokenize(text)` | `ئۇسۇلى · بىلەن · سىلىشتۇرسۇكىشىلەر · ياخشى` |
| `applySuggestion(mark, "سېلىشتۇر")` | HTML `ئۇسۇلى بىلەن سېلىشتۇر ياخشى` — «كىشىلەر» and the line break are gone |
| Same with Shift+Enter (`<br>`) | Same glued token; after the replacement `ئۇسۇلى بىلەن سېلىشتۇر&nbsp;ياخشى` |

**Root cause:** `readTextMap` concatenates every text node with nothing between them, so text in
different blocks (and on either side of a `<br>`) reads as one word. `applySuggestion` then builds a
Range from the glued token's start (in block 1) to its end (in block 2) and `insertText` replaces
everything inside it, the block boundary included.

**Side effects of the same cause:** two correct words at every paragraph/heading/list-item boundary
are underlined as one wrong word (false positives); «لۇغەتكە قوش» stores the glued non-word in the
personal dictionary.

### N8 (P2) — a tap right after typing can replace the wrong letters

Marks and the text map are refreshed only by `runCheck`, 450 ms after typing stops
(`RECHECK_MS`, `use-spellcheck.ts` lines 22 and 106–136). A tap on an underlined word inside that
window hit-tests against stale offsets; `applySuggestion` never checks that the Range it builds
still contains the word the popup shows. `shiftMarks` (`marks.ts` line 174) was written for exactly
this but is never called.

### N17 (P3) — dead code

`shiftMarks` is exported and unused. `CLAUDE.md` forbids dead code.

### N15 (P2) — the notebook is tested in Chromium only

Every Playwright project is `browserName: "chromium"`. The owner writes in **Firefox**; iPhone
readers use **WebKit**. `contentEditable` + `execCommand` behave differently in each engine, so the
notebook needs all three. Playwright's Firefox and WebKit builds are free.

## Project context

Next.js 16 (read the relevant guide in `node_modules/next/dist/docs/` before using any Next API you
are unsure of — this version has breaking changes) + Supabase Free + Vercel Hobby, live at
`https://bilimhezinisi.com`. Read in full:

- `lib/spellcheck/marks.ts` — `readTextMap`, `locate`, `rangeFor`, `offsetOf`, `wordAtOffset`,
  `hitTest`, `shiftMarks`, and the long comment explaining why marks are painted with the CSS Custom
  Highlight API instead of being inserted as elements. That decision stays.
- `components/notes/use-spellcheck.ts`, `components/notes/spell-popup.tsx`,
  `lib/spellcheck/client.ts`, `lib/spellcheck/dictionary.ts` (`tokenize`, `WORD_PATTERN`,
  `isCheckable`).
- `lib/notes/find.ts` and `components/notes/find-bar.tsx` — they reuse `readTextMap` and `rangeFor`.
  Find computes hits **per text node** and offsets them by `map.starts`; that must keep working
  unchanged after your change. (Replace-all has its own bug, N7, fixed in stage 4 — leave it alone
  here.)
- `lib/ai/note-blocks.ts` — the AI proofreader already splits a note into blocks and `<br>` lines
  correctly (`BLOCK_SELECTOR`). It is the model for what a "block" is. Do not change its behaviour.
- `lib/notes/sanitize.ts` / `lib/notes/sanitize-server.ts` — the closed list of tags a note can
  contain.
- `components/notes/note-editor.tsx` — how the editor calls the spellchecker.
- `tests/notes.spec.ts`, `tests/notes-sources.spec.ts`, `tests/notes-ai.spec.ts`,
  `tests/unit/note-find.test.ts`, `tests/unit/spellcheck.test.ts`, `playwright.config.ts`,
  `vitest.config.mts`.

## Non-negotiable constraints (restated from `CLAUDE.md`; they win over anything here)

- **No budget, ever.** Supabase Free + Vercel Hobby; no paid service, no new vendor account, no
  runtime CDN or third-party script.
- **Anonymous reading always works.** RTL Uyghur UI; code, comments and commits in English; Uyghur
  only in UI strings.
- **Mobile Rules are hard:** `100dvh`/`min-h-dvh` (never `100vh`); safe-area padding on fixed/sticky
  bars; touch targets ≥ 44 px; nothing hover-only; no horizontal scroll at 360 px; every control
  visible and tappable after scrolling down and back up; popovers/drawers use `overscroll-contain`
  and never trap body scroll; logical properties only (`ps-*`, `pe-*`, `start-*`, `end-*`,
  `text-start`).
- **A note is the writer's private work.** RLS stays owner-only; never log, print, screenshot into
  `docs/`, or commit real note content or a reader's words. Test fixtures use invented text.
- **The editor stays an uncontrolled `contentEditable` with `execCommand`.** Do not introduce an
  editor library. Spellcheck and find keep painting with the CSS Custom Highlight API — never insert
  elements into the note to mark text, and never split a text node to do so.
- **AI stays bring-your-own-key and browser-only.** Do not touch `lib/ai/` except where named.
- Never edit an applied migration; RLS on every table; do not weaken the CSP.
- **Never load-test production.** Specs that use the real project create at most a handful of notes
  with the `bh-e2e-` test accounts and delete them, exactly as the existing specs do.
- The desktop repo is a read-only reference.

## What to do

### A. A text map that knows where lines end (fixes N1)

Change `readTextMap` so that the flattened `text` has a **virtual separator `"\n"`** wherever the
reader sees a line end:

- between two text nodes whose nearest **block** ancestor (inside the editor root) differs;
- at every `<br>` and `<hr>`;
- never twice in a row, and never at the very start.

A block is one of the block-level tags a note can contain: `p, div, h1–h6, ul, ol, li, blockquote,
pre, table, thead, tbody, tr, th, td, hr` (the same notion as `BLOCK_SELECTOR` in
`lib/ai/note-blocks.ts`). Put this set in one exported constant and use it from `marks.ts`; if
`note-blocks.ts` can use the same constant without any change in its behaviour, do so, otherwise
leave it. **Inline elements** (`span, b, strong, i, em, u, s, sub, sup, code, a, font`) must never
create a separator: a word half in bold is still one word.

Separators belong to no text node. Keep `TextMap`'s contract working with these gaps:

- `nodes[i]` still starts at `starts[i]`;
- `locate()` of an offset that falls on a separator resolves to the **end of the preceding node**;
- `rangeFor`, `offsetOf`, `wordAtOffset`, `hitTest` stay correct;
- `findInEditor` still produces the same hits, in the same order, as before for every existing
  fixture (it searches per node, so it should — prove it with the existing tests plus new ones).

A prototype of exactly this rule, run in Chromium 141, produced:

| Editor HTML | Flattened text | Tokens |
|---|---|---|
| `ئۇسۇلى بىلەن سىلىشتۇرسۇ<div>كىشىلەر ياخشى</div>` | `…سىلىشتۇرسۇ\nكىشىلەر ياخشى` | ئۇسۇلى · بىلەن · سىلىشتۇرسۇ · كىشىلەر · ياخشى |
| `سىلىشتۇرسۇ<br>كىشىلەر` | `سىلىشتۇرسۇ\nكىشىلەر` | سىلىشتۇرسۇ · كىشىلەر |
| `<h2>كىرىش سۆز</h2><div>بىرىنچى</div>` | `كىرىش سۆز\nبىرىنچى` | كىرىش · سۆز · بىرىنچى |
| `<div>سى<b>لىش</b>تۇر</div>` | `سىلىشتۇر` | سىلىشتۇر (one word) |
| `<ul><li>بىر</li><li>ئىككى<ul><li>ئۈچ</li></ul></li></ul>تۆت` | `بىر\nئىككى\nئۈچ\nتۆت` | four words |
| `<div>ئالما</div>ئۆرۈك` | `ئالما\nئۆرۈك` | two words |

Rewrite the explanatory comment at the top of `marks.ts` so it states the boundary rule and why.

### B. Replace only the word that was shown (fixes N1's damage path and N8)

In `applySuggestion`:

1. Re-read a fresh map and rebuild the Range for the mark.
2. **Refuse** — change nothing in the document — unless the Range's text equals `mark.word`
   exactly **and** the Range contains no separator (its start and end are in the same block).
3. On refusal, close the popup and re-run the check, so the underline and popup reflect the
   current text. Do not show an error; the writer simply taps the word again.
4. Keep `execCommand("insertText")` so the correction is one step in the browser's own undo stack.

In `addToPersonal`: only ever store a string that is exactly one `WORD_PATTERN` token (defensive;
after A it always will be).

### C. Never hit-test against stale marks (fixes N8, N17)

Track "the document changed since the last completed check". When the writer taps the editor while
that is true, cancel the pending debounce, **await a fresh check**, and only then hit-test and open
the popup. The popup must never show a word that is not at the tapped position now. Delete
`shiftMarks` (and any test of it) — it is dead code, and the fresh check replaces what it was meant
to do.

### D. Test the notebook in Firefox and WebKit too (fixes N15)

- Install the engines once on this machine: `npx playwright install firefox webkit` (free).
- Add Playwright projects that run the notebook specs (`notes.spec.ts`, `notes-sources.spec.ts`,
  `notes-ai.spec.ts`) in:
  - **Firefox** at 1280×800 and at 390×844 (Playwright's Firefox does not support `isMobile`; use
    the viewport only);
  - **WebKit** at 390×844 with `isMobile` and `hasTouch` (the closest Playwright gets to iPhone
    Safari) and at 1280×800.
  Same `dependencies` and `storageState` as the existing Chromium notebook projects. Do not add the
  other specs to these engines.
- If an **existing** notebook test fails on Firefox or WebKit for a reason this stage does not fix
  (for example replace-all, N7, which stage 4 fixes), mark only that test `test.fixme` for that
  engine with a comment naming the finding and the stage that will fix it, and list it in your
  report. Never weaken an assertion to make a test pass.
- If an engine's build lacks the CSS Custom Highlight API, skip only the paint assertions there
  (with an explicit reason in the test) and still assert the behaviour: the popup's word, and what
  the replacement does to the document.

## Tests

- `npm run typecheck`, `npm run lint`, `npm run build`, `npm run test:unit` and the full Playwright
  suite are green.
- **Unit (vitest, jsdom like `tests/unit/note-find.test.ts`):** every row of the table in A; a
  table cell boundary (`<td>`); empty blocks (`<div><br></div>`); a word split across inline tags
  stays one token; `rangeFor`/`offsetOf` round-trips across separators; `findInEditor` returns the
  same hits as before for all existing fixtures and a phrase still never crosses a line.
- **Playwright** — Chromium at 375×667, 390×844, 1280×800, plus the new Firefox and WebKit
  projects. Use invented text. For each case assert the resulting `note-body` HTML structure, not
  only its text:
  1. A misspelled word at the end of a line, **Enter**, a correct word on the next line; turn the
     spellcheck on; tap the misspelled word → the popup's word is exactly the misspelled word; pick
     the first suggestion → the first line is corrected, the second line's word is still there, and
     the number of lines/blocks is unchanged.
  2. The same with **Shift+Enter**.
  3. Two correct dictionary words separated only by Enter (and, separately, a heading followed by a
     paragraph) → no underline, and `spell-summary` reports no errors. Pick words you first prove
     are individually correct.
  4. Stale tap: after the check has run, type two letters elsewhere in the same line and tap the
     underlined word within 200 ms → the popup shows the right word, and the replacement changes
     only that word.
  5. After Enter, «لۇغەتكە قوش» on the misspelled word stores exactly that one word (read
     `localStorage["bh-personal-dictionary"]`).
  6. No horizontal overflow at 360/375 px; the toolbar controls and the popup's buttons are visible
     and tappable after scrolling down and back up.

## Acceptance criteria

1. In all five browser/viewport configurations, the owner's exact scenario (misspelled word, Enter,
   word on the next line, tap, pick a suggestion) leaves the next line's word and the line break
   intact.
2. No spellcheck mark ever spans a block boundary or a `<br>`; words split by inline formatting are
   still checked as one word.
3. A suggestion is applied only when the document still contains the shown word at that place;
   otherwise nothing in the document changes.
4. Find results are identical to before for every existing test fixture.
5. `shiftMarks` is gone; no other dead code is introduced.
6. Firefox and WebKit notebook projects exist and pass, with any `fixme` listed by finding and stage.
7. typecheck, lint, build, unit and Playwright suites green.

Commit per logical step with English conventional messages (for example
`fix(spellcheck): treat line ends as word boundaries`,
`fix(spellcheck): only replace the word the popup shows`,
`test(notes): run the notebook in Firefox and WebKit`). Push, let Vercel deploy, and check
`https://bilimhezinisi.com/notes` loads for a signed-in test account. Finish with a short report
**in simple Uyghur** for the owner: what changed, what to try on his phone (the scenario in the
header), and the list of `fixme` tests with the stage that fixes each.

If anything here conflicts with `CLAUDE.md`, or you would have to trade away correctness, privacy,
mobile quality or the free-tier limits to finish it, **stop and ask the owner in Uyghur** — never
make that trade silently.
