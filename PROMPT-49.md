# PROMPT 49 — خاتىرە دەپتىرى، 8-باسقۇچ (9 دىن): مەنبە ئۇلىنىشى، مۇندەرىجە، فورمات سۈپۈرگىسى

**قانداق ئىشلىتىسىز:** `PROMPT-48.md` تاماملىنىپ سايتقا چىققاندىن **كېيىن** ئىشلىتىڭ. Claude Code نى
`BilimHezinisi-website` قىسقۇچىدا **يېڭى تۈر** قىلىپ ئېچىڭ، «---» دىن كېيىنكى پۈتۈن ئىنگلىزچە قىسمىنى
چاپلاڭ. تۈگىگەندىن كېيىن `PROMPT-50.md` غا ئۆتۈڭ.

> **بۇ نېمە ئىش (F4 — سىز تەستىقلىغان يېڭى ئىقتىدار):** (1) خاتىرىگە قىستۇرۇلغان مەنبە ئۇلىنىشىنى
> باسسىڭىز، كىچىك تاختا چىقىدۇ: «ئېچىش» (كىتابنىڭ شۇ بېتىنى يېڭى بەتكۈچتە ئاچىدۇ) ۋە «ئۇلىنىشنى
> ئېلىۋېتىش». ھازىر بۇ ئۇلىنىشلارنى خاتىرە ئىچىدە ئاچقىلى بولمايدۇ. (2) **مۇندەرىجە** — ئۇزۇن
> خاتىرىدىكى ماۋزۇلارنىڭ تىزىملىكى، بىرىنى باسسىڭىز شۇ يەرگە بارىدۇ. (3) **فورمات سۈپۈرگىسى** —
> دېتالدىكىدەك: بىر يەردىكى فورماتنى (توم، يانتۇ، ئاستى سىزىق، رەڭ) ئېلىپ، باشقا يەرگە بېرىش.
>
> **تۈگىگەندىن كېيىن سىناڭ:** كىتابتىن مەنبە قىستۇرۇپ، ئاستىدىكى ئۇلىنىشنى بېسىڭ → «ئېچىش».

---

You are continuing an existing, live project. Read `CLAUDE.md` in this folder FIRST — it is the
project instruction and always wins — and use the **bilim-web** skill.

This is **stage 8 of 9** of the notebook plan (`PROMPT-42.md` … `PROMPT-50.md`, from
`AUDIT-2026-10-07.md`). **Do only this stage.** It adds feature **F4** (approved 2026-10-07) and
fixes N10 and N24.

## Before you start

1. `git status`, `git log --oneline -20`. Stage 7 (PROMPT-48: spellcheck stepping, ignore list,
   dictionary panel) must be merged and deployed. If not, **stop and tell the owner in Uyghur** that
   PROMPT-48 must be finished first. Uncommitted changes you did not make → stop and ask.
   Untracked planning files in the root (`PROMPT-*.md`, `AUDIT-*.md`, `HANDOFF-*.md` and the like)
   are the owner's and expected: leave them where they are and do not commit them.
2. Read the *Project context* files in full.

## What is wrong or missing

- **N10 (P2):** a citation inserted from the library or the Qur'an ends with a link back to the exact
  page (`lib/notes/insert.ts` — "a note is worth nothing if the passage cannot be found again"). Inside
  the editor that link cannot be followed: in Chromium 141 both a click and a Ctrl+click on it in the
  `contentEditable` did nothing (no navigation, no new tab). It only works after exporting to Word.
- Long notes have headings but no way to jump between them.
- **N24 (P3):** the desktop notebook has a format painter (`TEQQASLASH.md` §3.3); the web does not.

## Project context

Read in full: `lib/notes/insert.ts` (citation and verse markup, `readerHref`, `ayaHref`),
`lib/notes/sanitize.ts` and `sanitize-server.ts` (`safeHref`: which schemes survive),
`components/notes/note-editor.tsx` (toolbar, overflow, `exec`, stage 4's block-style control and
batch API), `components/notes/use-spellcheck.ts` and `spell-popup.tsx` (the popover pattern and its
stage-4 positioning rules — reuse them), stage 5's panel component (reuse it for the outline),
`components/icons.tsx` and the icon pipeline, `tests/notes-sources.spec.ts`. If the desktop reference
is reachable at `../bilim hezinisi/bilim hezinisi pc/src/notes.js`, read its format painter
(**read only — never modify anything there**) and match its behaviour where it makes sense on a
touch screen.

## Non-negotiable constraints (restated from `CLAUDE.md`; they win over anything here)

- **No budget, ever.** No paid service, vendor or runtime CDN; nothing new in Supabase.
- **Anonymous reading always works.** RTL Uyghur UI; code, comments and commits in English.
- **Mobile Rules are hard:** `100dvh`; safe areas; ≥ 44 px targets; nothing hover-only (a link
  popover opens on tap, never on hover); no horizontal scroll at 360 px; controls visible after
  scroll down/up; `overscroll-contain`; logical properties only; the phone header target from stage 4
  still holds in the default state.
- Editor stays uncontrolled `contentEditable` + `execCommand`; no `selectAll` + `insertHTML`; marks
  painted with the Custom Highlight API.
- **Links:** open only `http:`/`https:` URLs and same-origin relative paths, always with
  `noopener,noreferrer`; anything else is shown as text and never opened.
- **No native dialogs.** A note is private: invented text in tests. Never edit an applied migration
  (none needed); do not weaken the CSP.

## What to do

### A. A tap on a link (N10)

- A tap or click on an `a[href]` inside the editor, with no text selected, opens a small popover
  anchored to the link (stage 4's positioning: stays while visible, repositions on scroll and
  `visualViewport` changes, closes on outside tap, Escape or an edit). The spell popup never opens
  for the same tap.
- Contents: the link's text; where it goes, in words — «كىتاب: «ماۋزۇ» — 3-بەت» for
  `/books/<id>/read?page=…` (use the citation label already in the note), «قۇرئان: 2:255» for
  `/quran/<sura>?aya=<aya>`, otherwise the host name; buttons «ئېچىش» (new tab, absolute URL,
  `noopener,noreferrer`) and «ئۇلىنىشنى ئېلىۋېتىش» (selects the link and runs
  `execCommand("unlink")` — the text stays, one undo step); «تاقاش». All ≥ 44 px.
- On desktop, Ctrl+click (Cmd+click on macOS) opens the link directly.

### B. Outline «مۇندەرىجە»

- «باشقا ئىقتىدارلار» → «مۇندەرىجە» (icon `list`) opens the panel (sheet on phones, side panel from
  1024 px). It lists the note's `h1`–`h4` in order, indented by level, each row ≥ 44 px; it updates
  when the document changes (debounced).
- Tapping a heading scrolls it to just below the sticky header and puts the caret at its start.
- Empty: «بۇ خاتىرىدە ماۋزۇ يوق — «ماۋزۇ» نى تاللاپ قوشۇڭ.»

### C. Format painter (N24)

- «فورمات سۈپۈرگىسى» in «باشقا ئىقتىدارلار», with an icon distinct from the colour button's `brush`
  (add one through the icon pipeline if none fits).
- With text selected, the first tap **takes** the formatting at the start of the selection: bold,
  italic, underline, and an explicit text colour if there is one. The button shows its pressed state
  (`aria-pressed`), and the notice area says «ئەمدى فورمات بېرىدىغان تېكىستنى تاللاپ،
  «فورماتنى بېرىش» نى بېسىڭ.» with a «فورماتنى بېرىش» button and «بىكار قىلىش» (both ≥ 44 px —
  a second tap is needed because a phone cannot paint while selecting).
- «فورماتنى بېرىش» makes the selection's bold/italic/underline match the source, and applies the
  source's colour only if the source had an explicit one (never bake the theme's default text colour
  into the note — it would break dark and sepia modes). Run it through stage 4's batch API so side
  effects run once. Then the painter turns off.
- With nothing selected, the first tap explains: «ئاۋۋال فورماتى ئېلىنىدىغان تېكىستنى تاللاڭ.»
- Undo: «يېنىۋېلىش» reverts the paint (one press per property changed is acceptable; state the
  number in a test).

## Tests

- `npm run typecheck`, `npm run lint`, `npm run build`, `npm run test:unit`, full Playwright suite
  green (Chromium 375×667, 390×844, 1280×800 and the Firefox/WebKit notebook projects).
- **Unit:** link description for book, Qur'an and external URLs; unsafe or odd hrefs are never
  opened; outline extraction from nested markup; painter capture (bold/italic/underline/explicit
  colour vs no colour).
- **Playwright** (invented text, the seeded test book for citations):
  1. Insert a library citation → tap its link → popover with the book and page → «ئېچىش» opens a new
     page at `/books/<id>/read?page=…` (assert the URL; close it).
  2. «ئۇلىنىشنى ئېلىۋېتىش» → the text remains without `<a>`; one «يېنىۋېلىش» restores the link.
  3. A Qur'an verse citation → popover says «قۇرئان: …».
  4. A note with three headings → outline lists them in order with levels → tapping the third
     scrolls it into view below the header.
  5. Painter: bold + coloured source → plain target becomes bold with that colour; a source without
     colour leaves the target's colour alone.
  6. No horizontal overflow at 360/375 px; popover, outline and painter controls visible and
     tappable after scrolling down and back up; the outline list scrolls inside its panel.

## Acceptance criteria

1. Every citation link in a note can be opened from inside the note, on every engine and viewport,
   and only safe destinations open.
2. Links can be removed without losing their text, undoably.
3. The outline lists headings and jumps to them.
4. The format painter copies bold, italic, underline and explicit colour, never the theme colour.
5. The phone header target from stage 4 still holds.
6. typecheck, lint, build, unit and all Playwright projects green.

Commit per logical step (`feat(notes): open and unlink citations from the note`,
`feat(notes): an outline of the note's headings`, `feat(notes): format painter`). Push, check
`https://bilimhezinisi.com/notes` with a test account, and finish with a short report **in simple
Uyghur**: what changed and what to try on his phone.

If anything here conflicts with `CLAUDE.md`, or you would have to trade away privacy, mobile quality
or the free-tier limits to finish it, **stop and ask the owner in Uyghur** — never make that trade
silently.
