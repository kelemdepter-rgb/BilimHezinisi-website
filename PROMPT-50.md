# PROMPT 50 — خاتىرە دەپتىرى، 9-باسقۇچ (9 دىن): Word، PDF، Markdown، تېكىست قىلىپ چىقىرىش

**قانداق ئىشلىتىسىز:** `PROMPT-49.md` تاماملىنىپ سايتقا چىققاندىن **كېيىن** ئىشلىتىڭ. Claude Code نى
`BilimHezinisi-website` قىسقۇچىدا **يېڭى تۈر** قىلىپ ئېچىڭ، «---» دىن كېيىنكى پۈتۈن ئىنگلىزچە قىسمىنى
چاپلاڭ. ئاخىرىدا Claude Code سىزدىن بىر Word ھۆججىتىنى ئېچىپ رەسىمىنى ئەۋەتىشنى سورايدۇ. بۇ
خاتىرە دەپتىرى پىلانىنىڭ ئاخىرقى باسقۇچى.

> **بۇ نېمە ئىش (F5 — سىز تەستىقلىغان يېڭى ئىقتىدار، N12 خاتالىقى بىلەن):** ھازىرقى Word غا چىقىرىش
> شەكىلنى يوقىتىدۇ: Shift+Enter قۇرلىرى چاپلىشىدۇ، نەقىلدىكى بىر نەچچە قۇر بىر قۇرغا ئايلىنىدۇ،
> ئىچكى تىزىملىكنىڭ تېكىستى ئىككى قېتىم چىقىدۇ، جەدۋەل بۇزۇلىدۇ، سىز تاللىغان خەت نۇسخىسى ۋە
> چوڭلۇقى چىقمايدۇ. بۇ باسقۇچ ئۇلارنى ئوڭشايدۇ ۋە «چىقىرىش» تىزىملىكى قوشىدۇ: **Word**،
> **PDF / بېسىپ چىقىرىش**، **Markdown**، **تېكىست**. Word دا مەنبەلەرنى خالىسىڭىز **ئاستى ئىزاھات
> (footnote)** قىلىپ چىقارغىلى بولىدۇ — ئىلمىي ماقالىگە ماس.
>
> **تۈگىگەندىن كېيىن سىناڭ:** ماۋزۇ، تىزىملىك ۋە مەنبە بار بىر خاتىرىنى Word قىلىپ چىقىرىپ
> كومپيۇتېرىڭىزدا ئېچىڭ.

---

You are continuing an existing, live project. Read `CLAUDE.md` in this folder FIRST — it is the
project instruction and always wins — and use the **bilim-web** skill.

This is **stage 9 of 9**, the last of the notebook plan (`PROMPT-42.md` … `PROMPT-50.md`, from
`AUDIT-2026-10-07.md`). **Do only this stage.** It adds feature **F5** (approved 2026-10-07) and fixes
N12.

## Before you start

1. `git status`, `git log --oneline -20`. Stage 8 (PROMPT-49: link popover, outline, format painter)
   must be merged and deployed. If not, **stop and tell the owner in Uyghur** that PROMPT-49 must be
   finished first. Uncommitted changes you did not make → stop and ask.
   Untracked planning files in the root (`PROMPT-*.md`, `AUDIT-*.md`, `HANDOFF-*.md` and the like)
   are the owner's and expected: leave them where they are and do not commit them.
2. Read the *Project context* files in full.

## What is wrong (N12, P2 — from the code; confirm each with a failing test first)

`lib/notes/export-docx.ts`:

- `runsFrom` has no case for `<br>`: lines typed with Shift+Enter (and `<br>`s in pasted text) are
  glued together in Word.
- `paragraphsFrom` only splits the editor's **top-level** children: a block that contains blocks
  (a quote holding several lines, a `div` wrapping paragraphs, list items holding paragraphs) becomes
  **one** paragraph.
- Lists: `element.querySelectorAll("li")` includes nested items, and `runsFrom(item)` of a parent
  item includes its nested items' text again — nested items appear twice; every item is level 0.
- Tables (allowed by the note sanitizer) are flattened into one paragraph.
- No document default font, size or line spacing: the notebook's chosen typography (font, size,
  line height — `lib/notes/typography*.ts`, kept per user in `localStorage`) is lost, and Word renders
  Uyghur in its own default face.
- Alignment is read only from top-level blocks.

## Project context

Read in full: `lib/notes/export-docx.ts`, `tests/unit/docx-export.test.ts`, `tests/unit/docx-props.test.ts`,
`tests/fixtures/docx.ts`, `lib/notes/insert.ts` (citation and verse shapes), `lib/notes/attribution.ts`
(`QURAN_ATTRIBUTION`, `UTHMANIC_MARKER` — the credit must travel with every format),
`lib/notes/typography.ts`, `lib/reader/settings.ts` (`FONT_STACKS`), `lib/spellcheck/marks.ts`
(stage 1's line-aware text map and block set), `lib/books/markdown.ts` (`createTurndown`),
`components/notes/note-editor.tsx` (the «Word» button in «باشقا ئىقتىدارلار»), `app/globals.css`
(`@media print`), `node_modules/docx/dist/index.d.ts` (docx 9.7.1: `FootnoteReferenceRun`,
the `footnotes` document option, `Table`, `IFontAttributesProperties`, `sizeComplexScript`,
`styles.default`). Bold/italic/size in docx 9.7.1 already emit the complex-script variants (`w:bCs`,
`w:iCs`, `w:szCs`) — verify, do not assume.

## Non-negotiable constraints (restated from `CLAUDE.md`; they win over anything here)

- **No budget, ever.** All export happens **in the browser**, as today — never send a note to a
  server route to convert it. No paid service, vendor or runtime CDN; no new runtime dependency
  unless unavoidable (and then MIT/BSD/Apache, lazy-loaded, and named in your report).
- **Anonymous reading always works.** RTL Uyghur UI; code, comments and commits in English.
- **Mobile Rules are hard:** `100dvh`; safe areas; ≥ 44 px targets; nothing hover-only; no
  horizontal scroll at 360 px; controls visible after scroll down/up; `overscroll-contain`;
  logical properties only; the phone header target from stage 4 still holds.
- Exporters are **lazy-loaded** when used. The note page's first-load JavaScript must not grow by
  more than 2 KB (compare `next build` output before and after; put both numbers in the report).
- **A note is private:** generated files contain only the note (no e-mail, no account name, no
  device data); invented text in tests and samples; never commit a generated sample.
- Fonts are **not embedded** in the Word file (licence and size); name them so Word uses them when
  installed.
- **No native dialogs.** Never edit an applied migration (none needed); do not weaken the CSP.

## What to do

### A. One export menu

Replace the «Word» button in «باشقا ئىقتىدارلار» with «چىقىرىش» opening a small menu (≥ 44 px
items): «Word (.docx)», «PDF / بېسىپ چىقىرىش», «Markdown (.md)», «تېكىست (.txt)», and for Word a
remembered switch «مەنبەلەرنى ئاستى ئىزاھات قىلىش». Update the `/notes` subtitle to
«Word، PDF، Markdown ياكى تېكىست قىلىپ چىقىرالايسىز.» File names: the title, sanitized as today.

### B. Word that keeps the note's shape (N12)

- A **recursive block walk** using stage 1's block set: every block becomes its own paragraph; inline
  content between blocks becomes a paragraph; blocks nested inside blocks never merge; an empty block
  (`<div><br></div>`) stays an empty paragraph.
- `<br>` → a line break inside the paragraph.
- Lists: one paragraph per `li`, its **level** = nesting depth; bullets for `ul`, numbering for `ol`;
  numbering restarts for each separate list; a parent item never repeats its children's text.
- Tables → a real Word table, right-to-left (`visuallyRightToLeft`), with bidirectional paragraphs
  in each cell; `colspan`/`rowspan` honoured where the sanitizer allowed them.
- Headings, quotes (indented), bold/italic/underline/colour, links (absolute URLs) as today.
- Alignment from any block. Decide the correct `w:jc` value for a right-to-left paragraph aligned
  right, centred, left and justified by checking the OOXML rule (and LibreOffice/Word behaviour), and
  pin it in a test with a comment citing what you checked.
- **Typography:** the document's default run font is the notebook's chosen face — the first family
  of `NOTE_FONT_STACKS[font]` (for example `UKIJ Ekran`) — set for ascii, hAnsi, cs and eastAsia;
  default size from the notebook's px size (× 0.75 pt) including the complex-script size; line
  spacing from its line height. The title uses the same face, larger. Inserted verses keep their
  Uthmani face.
- **Footnotes (when the switch is on):** a citation paragraph (the shape `lib/notes/insert.ts`
  produces — export one helper `isCitationParagraph` from there and use it) becomes a footnote:
  the reference mark goes at the end of the quoted passage or verse right before it, the footnote
  text is the citation label plus its absolute URL, and the citation paragraph is not repeated in
  the body. With the switch off, citations stay inline links, as today.
- The Qur'an attribution is appended when a verse is present (as today).

### C. PDF / print

«PDF / بېسىپ چىقىرىش» calls `window.print()`. Add notebook print styles: hide the sticky header,
panels, notices, counts and banners; print the note's title as a heading (a print-only element);
keep the note's typography and the Uthmani face; paper colours; the existing `@page` margins; the
Qur'an attribution (already print-only). The phone browser's own "Save as PDF" then produces the
PDF — nothing is generated on a server.

### D. Markdown and plain text

- **Markdown:** lazy-load `createTurndown()` (do not change its rules for the upload pipeline; wrap
  it if notes need something different). `# title` first; links absolute; citations as links (or as
  `[^n]` footnotes when the Word switch is on — your choice, consistent and tested); the Qur'an
  attribution at the end.
- **Text:** from stage 1's line-aware text map — a line end at every block end, a blank line between
  paragraphs, the title as the first line, the attribution at the end; UTF-8 with a BOM (older
  Windows editors need it to show Uyghur).

## Tests

- `npm run typecheck`, `npm run lint`, `npm run build`, `npm run test:unit`, full Playwright suite
  green (Chromium 375×667, 390×844, 1280×800 and the Firefox/WebKit notebook projects).
- **Unit (JSZip, as `docx-export.test.ts` does):** write failing tests first for each N12 item, then
  make them pass: `<w:br/>` for `<br>`; separate `<w:p>` for nested blocks; `w:ilvl` levels for
  nested lists with no duplicated text; numbering restarts; `<w:tbl>` with `w:bidiVisual`;
  `styles.xml` default `w:rFonts` (including `w:cs`) and `w:szCs`; line spacing; the alignment
  mapping; `footnotes.xml` holds the citation and the body does not repeat it; the attribution is
  present when a verse is. Markdown and text outputs for the same invented fixture (exact expected
  strings).
- **Playwright:** each menu item at every viewport and engine — Word, Markdown and text produce a
  download with the right file name and non-empty content; PDF/print: with
  `page.emulateMedia({ media: "print" })` the header, notices and panels are hidden and the title
  heading is visible. The menu: no horizontal overflow at 360/375 px, items visible and tappable
  after scrolling down and back up.
- **Owner check:** generate one sample `.docx` from an invented note containing a heading, a nested
  list, a multi-line quote, a table, a library citation as a footnote and a Qur'an verse, into
  `test-results/` (not committed). Ask the owner, in simple Uyghur, to open it in Word on his
  computer and send a screenshot; fix anything that looks wrong before you finish.

## Acceptance criteria

1. Everything in the N12 list is fixed and pinned by a test.
2. Word files use the notebook's chosen font, size and line spacing; right-to-left alignment is
   correct; citations can become footnotes.
3. PDF/print, Markdown and text export work on every engine and viewport, entirely in the browser.
4. The note page's first-load JavaScript grows by no more than 2 KB (numbers in the report).
5. The owner has seen the sample in Word.
6. typecheck, lint, build, unit and all Playwright projects green.

Commit per logical step (`fix(notes): keep lines, nested blocks, lists and tables in Word`,
`feat(notes): the notebook's font and spacing in Word`, `feat(notes): citations as footnotes`,
`feat(notes): print, Markdown and text export`). Push, check `https://bilimhezinisi.com/notes` with a
test account, and finish with a short report **in simple Uyghur**: what changed, the bundle numbers,
and what to try on his phone and in Word. This closes the notebook plan; list anything you saw that
still deserves work, without starting it.

If anything here conflicts with `CLAUDE.md`, or you would have to trade away privacy, mobile quality
or the free-tier limits to finish it, **stop and ask the owner in Uyghur** — never make that trade
silently.
