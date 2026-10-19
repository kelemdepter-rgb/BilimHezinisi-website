# PROMPT 48 — خاتىرە دەپتىرى، 7-باسقۇچ (9 دىن): ئىملا تۈزىتىشنى قولايلىق قىلىش

**قانداق ئىشلىتىسىز:** `PROMPT-47.md` تاماملىنىپ سايتقا چىققاندىن **كېيىن** ئىشلىتىڭ. Claude Code نى
`BilimHezinisi-website` قىسقۇچىدا **يېڭى تۈر** قىلىپ ئېچىڭ، «---» دىن كېيىنكى پۈتۈن ئىنگلىزچە قىسمىنى
چاپلاڭ. تۈگىگەندىن كېيىن `PROMPT-49.md` غا ئۆتۈڭ.

> **بۇ نېمە ئىش (F3 — سىز تەستىقلىغان يېڭى ئىقتىدار):** (1) «كېيىنكى خاتالىق / ئالدىنقى خاتالىق» —
> ئۇزۇن خاتىرىدىكى ئىملا خاتالىقلىرىنى بىر-بىرلەپ كۆرۈپ تۈزىتىش؛ (2) «بۇ خاتىرىدە سەل قارا» — بىر
> سۆزنى پەقەت شۇ خاتىرىدىلا خاتا دېمەسلىك؛ (3) «ئىملا» نى بىر قېتىم ئاچسىڭىز، كېيىن ئېسىدە تۇرىدۇ؛
> (4) **شەخسىي لۇغەت** — قوشقان سۆزلىرىڭىزنى كۆرۈش، ئۆچۈرۈش، ھۆججەت قىلىپ چىقىرىپ باشقا ئۈسكۈنىگە
> كىرگۈزۈش. Enter خاتالىقى سەۋەبىدىن لۇغىتىڭىزگە چاپلىشىپ كىرىپ قالغان سۆزلەر بولسا، شۇ يەردە كۆرسىتىلىدۇ؛
> (5) كىتابتىن ۋە قۇرئاندىن قىستۇرۇلغان مەنبە ئۇلىنىشى ۋە ئايەتلەرنىڭ ئاستىغا ئىملا سىزىقى سىزىلمايدۇ.
>
> **تۈگىگەندىن كېيىن سىناڭ:** «باشقا ئىقتىدارلار» → «شەخسىي لۇغەت» نى ئېچىپ، ئىچىدىكى سۆزلەرگە قاراڭ.

---

You are continuing an existing, live project. Read `CLAUDE.md` in this folder FIRST — it is the
project instruction and always wins — and use the **bilim-web** skill.

This is **stage 7 of 9** of the notebook plan (`PROMPT-42.md` … `PROMPT-50.md`, from
`AUDIT-2026-10-07.md`). **Do only this stage.** It adds feature **F3** (approved 2026-10-07) and
fixes N13 and N14.

## Before you start

1. `git status`, `git log --oneline -20`. Stage 6 (PROMPT-47: notes list search, pin, trash) must be
   merged, its migration applied, and deployed. If not, **stop and tell the owner in Uyghur** that
   PROMPT-47 must be finished first. Uncommitted changes you did not make → stop and ask.
   Untracked planning files in the root (`PROMPT-*.md`, `AUDIT-*.md`, `HANDOFF-*.md` and the like)
   are the owner's and expected: leave them where they are and do not commit them.
2. Read the *Project context* files in full.

## What is wrong or missing

- **N13 (P2):** the personal dictionary (`localStorage["bh-personal-dictionary"]`,
  `components/notes/use-spellcheck.ts` lines 32–48 and 246–260) can only be added to — never seen,
  corrected or moved to another device. Before stage 1, «لۇغەتكە قوش» on a word at a line end stored
  a glued non-word (two words joined across a line break); writers may have some.
- **N14 (P2):** the spellcheck toggle is `useState(false)` (`note-editor.tsx`); it is off every time
  a note opens.
- Missing workflow: in a long note there is no way to step through the errors; the only answer to a
  false positive is adding it to the dictionary for every note.
- Quoted material is underlined: a citation link's label and a Qur'an verse are not the writer's
  spelling to fix. `lib/ai/note-blocks.ts` already defines what quoted material is
  (`QUOTED_SELECTOR`: `a[href]` and the Uthmani verse face) and never sends it for correction.

## Project context

Read in full: `components/notes/use-spellcheck.ts`, `components/notes/spell-popup.tsx`,
`lib/spellcheck/marks.ts` (stage 1's line-aware map), `lib/spellcheck/client.ts`,
`lib/spellcheck/worker.ts`, `lib/spellcheck/protocol.ts`, `lib/spellcheck/dictionary.ts`
(`WORD_PATTERN`, `isCheckable`), `lib/ai/note-blocks.ts` (`QUOTED_SELECTOR`),
`components/notes/note-editor.tsx` (toolbar, overflow, the find bar's header row — the pattern for a
row that appears on demand), stage 5's panel component (reuse it for the dictionary panel),
`components/my/delete-account.tsx` (stage 2/5 cleanup), `tests/notes.spec.ts`,
`tests/unit/spellcheck.test.ts`.

## Non-negotiable constraints (restated from `CLAUDE.md`; they win over anything here)

- **No budget, ever.** Nothing new in Supabase — the personal dictionary and the per-note ignore
  lists stay in the browser (an earlier decision, documented in `use-spellcheck.ts`; export/import
  is the way to move them). No paid service, vendor or runtime CDN.
- **Anonymous reading always works.** RTL Uyghur UI; code, comments and commits in English.
- **Mobile Rules are hard:** `100dvh`; safe areas; ≥ 44 px targets; nothing hover-only; no
  horizontal scroll at 360 px; controls visible after scroll down/up; `overscroll-contain`;
  logical properties only. Stage 4's phone header target (title row + one tool row, ≤ 112 px, with
  overflow and find closed) must still hold in the default state.
- Marks stay painted with the Custom Highlight API; nothing is inserted into the note.
- **A note is private:** never log words or notes; invented text in tests. Imported files are
  untrusted input — validate everything, render nothing as HTML.
- **No native dialogs.** Never edit an applied migration (none needed); do not weaken the CSP.

## What to do

### A. Step through the errors

- An on-demand row in the sticky header, like the find bar: «ئالدىنقى» · counter `3 / 12`
  (`data-testid="spell-nav-count"`) · «كېيىنكى» · «تاقاش». It opens from a «بىر-بىرلەپ كۆرۈش» button
  in the spell summary under the note and from «باشقا ئىقتىدارلار» → «خاتالىقلارنى بىر-بىرلەپ
  كۆرۈش». It is never open by default. Do not bind F7 (Chrome and Firefox use it for caret
  browsing and show their own dialog).
- «كېيىنكى» goes to the first mark after the caret (wrapping), scrolls it to the middle of the visible
  area below the sticky header, and opens its popup; after a suggestion is applied or the word is
  ignored, the counter updates and «كېيىنكى» continues from there.
- When there are no errors: «ئىملا خاتالىقى قالمىدى.» and the row closes itself after 2 s.

### B. Ignore in this note

- A popup button «بۇ خاتىرىدە سەل قارا» under the suggestions (≥ 44 px).
- Stored in `localStorage` under `bh-spell-ignore:<userId>:<noteId>` (at most 500 words per note);
  treated as correct only in that note; removed on account deletion with the other per-user keys.

### C. Remember the toggle (N14)

`localStorage["bh-spell-on"]` (`"1"`/`"0"`). If on when a note opens, the dictionary loads as it does
today and the summary appears when ready.

### D. Personal dictionary panel (N13)

- «باشقا ئىقتىدارلار» → «شەخسىي لۇغەت» opens a panel (stage 5's sheet/side panel pattern):
  - line: «بۇ لۇغەت پەقەت مۇشۇ تور كۆرگۈچتە ساقلىنىدۇ. باشقا ئۈسكۈنىگە يۆتكىمەكچى بولسىڭىز، بۇ يەردىن چىقىرىپ، ئۇ يەردە كىرگۈزۈڭ.»
  - the count; a filter box; the words in Uyghur order (`Intl.Collator("ug")`, falling back to
    code-point order), each with a delete button (≥ 44 px);
  - «ھەممىنى ئۆچۈرۈش» with an inline two-step confirmation;
  - «چىقىرىش» — downloads `bilim-hezinisi-lughet.json`, a JSON array of strings;
  - «كىرگۈزۈش» — reads a `.json` file chosen by the writer: it must be an array of strings; each
    must be exactly one `WORD_PATTERN` token, 2–64 characters; at most 5,000 words in total after
    merging; duplicates dropped. Report «N سۆز قوشۇلدى، M سۆز رەت قىلىندى.» Never execute, eval or
    render the file's contents as HTML.
  - Every change takes effect immediately in the running checker (update the worker's personal set
    and drop the affected cached verdicts, then re-check).
- **Possibly glued entries:** mark (do not delete) entries of 8 letters or more that are not in the
  main dictionary but split into two dictionary words of at least 3 letters each, with
  «بەلكىم ئىككى سۆز چاپلىشىپ قالغان — تەكشۈرۈپ بېقىڭ». Run this check in the worker. Uyghur
  compounds exist, so this is a hint only; never remove anything automatically.

### E. Leave quoted material alone

Export `QUOTED_SELECTOR` from one place and use it in both `lib/ai/note-blocks.ts` (unchanged
behaviour) and the spellchecker: no mark is created for a token whose text lies inside a quoted
element. The unquoted text around a citation is still checked.

## Tests

- `npm run typecheck`, `npm run lint`, `npm run build`, `npm run test:unit`, full Playwright suite
  green (Chromium 375×667, 390×844, 1280×800 and the Firefox/WebKit notebook projects).
- **Unit:** import validation (non-array, non-strings, multi-word strings, HTML, over-long words,
  over 5,000, duplicates); the glued-entry hint on invented examples, including a real compound that
  must not be flagged if the dictionary contains it; ignore-list scoping per user and note; quoted
  tokens excluded.
- **Playwright** (invented text):
  1. A note with three misspellings: open «بىر-بىرلەپ كۆرۈش» → counter `1 / 3`; «كېيىنكى» moves and
     opens each popup; fixing one updates the counter to `… / 2`.
  2. «بۇ خاتىرىدە سەل قارا» removes the mark in this note and keeps it in another note.
  3. Spellcheck on → reload → still on.
  4. Dictionary panel: add a word from the popup → it is listed; delete it → its mark returns;
     export → file content is the JSON array; import a prepared file with valid and invalid entries
     → the counts are right.
  5. A citation inserted from the library and a Qur'an verse: no marks inside them.
  6. No horizontal overflow at 360/375 px; the stepping row and the panel are visible and tappable
     after scrolling down and back up; the panel's list scrolls inside itself; in the default state
     the phone header is still ≤ 112 px.

## Acceptance criteria

1. A writer can step through every error of a long note on a phone with one thumb.
2. A false positive can be silenced for one note without touching the personal dictionary.
3. The personal dictionary is visible, editable, exportable and importable; glued entries are
   pointed out, never removed automatically.
4. The spellcheck choice survives a reload; quoted material is never underlined.
5. Nothing new is stored on the server.
6. typecheck, lint, build, unit and all Playwright projects green.

Commit per logical step (`feat(spellcheck): step through the errors`,
`feat(spellcheck): ignore a word in one note`, `feat(spellcheck): manage the personal
dictionary`, `fix(spellcheck): remember the toggle and skip quotations`). Push, check
`https://bilimhezinisi.com/notes` with a test account, and finish with a short report **in simple
Uyghur**: what changed and what to try on his phone.

If anything here conflicts with `CLAUDE.md`, or you would have to trade away privacy, mobile quality
or the free-tier limits to finish it, **stop and ask the owner in Uyghur** — never make that trade
silently.
