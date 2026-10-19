# PROMPT 46 — خاتىرە دەپتىرى، 5-باسقۇچ (9 دىن): ئىلگىرىكى نۇسخىلار

---

You are continuing an existing, live project. Read `CLAUDE.md` in this folder FIRST — it is the
project instruction and always wins — and use the **bilim-web** skill.

This is **stage 5 of 9** of the notebook plan (`PROMPT-42.md` … `PROMPT-50.md`, from
`AUDIT-2026-10-07.md`). **Do only this stage.** It adds feature **F1, browser-local version
history**, approved by the owner on 2026-10-07.

## Before you start

1. `git status`, `git log --oneline -20`. Stage 4 (PROMPT-45: structure-safe replace with
   «ھەممىنى يېنىۋېلىش», block-style control, phone toolbar) must be merged and deployed. If not,
   **stop and tell the owner in Uyghur** that PROMPT-45 must be finished first. Uncommitted changes
   you did not make → stop and ask.
   Untracked planning files in the root (`PROMPT-*.md`, `AUDIT-*.md`, `HANDOFF-*.md` and the like)
   are the owner's and expected: leave them where they are and do not commit them.
2. Read the *Project context* files in full.

## Why this design

- Autosave overwrites the note on the server every few seconds. A mistaken deletion, a replace-all,
  an AI proofread the writer regrets, or the «مېنىڭ نۇسخامنى بۇنىڭ ئورنىغا قويۇش» choice from stage 2
  all become permanent once saved. Version history makes each of them reversible.
- **Kept in the browser, not in Supabase:** a server-side history would multiply each note's size
  inside the 500 MB free database. IndexedDB on the writer's own device costs the site nothing, works
  offline, and never leaves the device.

## Project context

Read in full: `components/notes/note-editor.tsx` and the save module and whole-document helper
stage 2 created, `components/notes/find-bar.tsx` (stage 4's replace-all snapshot),
`components/notes/ai-panel.tsx` (`applyProofread` / `undoProofread`), `lib/notes/sanitize.ts`,
`lib/notes/typography*.ts`, `components/app-shell.tsx` (the sign-out form),
`components/my/delete-account.tsx`, `components/my/offline-storage.tsx` and `app/my/account/page.tsx`
(the "what this site keeps on this device" card), `lib/pwa/storage.ts`, `app/privacy/page.tsx`
(read only), `tests/notes.spec.ts`, `playwright.config.ts`, `vitest.config.mts`.

## Non-negotiable constraints (restated from `CLAUDE.md`; they win over anything here)

- **No budget, ever.** Nothing new is stored in Supabase by this stage; no paid service or vendor;
  no runtime CDN. No new runtime dependency is needed for IndexedDB — write a small typed wrapper. A
  dev-only test dependency such as `fake-indexeddb` (MIT) is acceptable.
- **Anonymous reading always works.** RTL Uyghur UI; code, comments and commits in English.
- **Mobile Rules are hard:** `100dvh` never `100vh`; safe-area padding; ≥ 44 px targets; nothing
  hover-only; no horizontal scroll at 360 px; controls visible after scroll down/up; the panel uses
  `overscroll-contain` and never traps body scroll; logical properties only.
- **A note is private.** Versions stay on the device; never sent anywhere, never logged; rendered
  only through `sanitizeNoteHtml`. Invented text in tests.
- Editor stays uncontrolled `contentEditable` + `execCommand`; **never** `selectAll` + `insertHTML`;
  a whole-document replacement goes only through stage 2's helper.
- **No native dialogs.** Never edit an applied migration (none needed); do not weaken the CSP.

## What to do

### A. The store

A module (for example `lib/notes/history.ts`) over IndexedDB database `bh-notebook`, object store
`versions`:

- Record: `{ id, userId, noteId, at, title, html, chars, reason }`, with an index on
  `[userId, noteId, at]`. `reason` is one of `open | auto | before-replace-all | before-ai |
  before-restore | before-conflict`.
- Never store a version identical (title and HTML) to the newest one already stored for that note.
- Keep at most **30 versions per note**, and at most **20 MB for the whole store** (estimate as
  2 × (title + html) characters). When over, evict the oldest `auto` versions first, then the oldest
  of any reason, never the newest version of a note.
- Every operation fails soft: if IndexedDB is missing, blocked or throws (private windows, storage
  full), the editor keeps working and the history panel says so. Nothing in the save path may wait
  on the history store.
- `clearAll()` removes the whole store.

### B. When a version is taken

- `open` — when a note opens (the server version, or the restored draft), if it differs from the
  newest stored version.
- `auto` — after a save is **confirmed**, if the newest `auto` version of this note is at least
  **5 minutes** old and the content differs.
- `before-replace-all` — the snapshot stage 4 already takes.
- `before-ai` — add a prop to `NotesAiPanel` that it calls right before `applyProofread` writes.
- `before-restore` — the current content, right before a restore (C).
- `before-conflict` — in stage 2's conflict choices: before «ئىككى خاتىرە قىلىپ ساقلاش» loads the
  server version, keep the local version; before «مېنىڭ نۇسخامنى بۇنىڭ ئورنىغا قويۇش» overwrites the
  server, fetch the server's current title and HTML (owner-filtered, one request) and keep them —
  so neither choice destroys anything.

### C. The panel

- «ئىلگىرىكى نۇسخىلار» (icon `clock`) inside «باشقا ئىقتىدارلار». It opens a panel: a sheet from the
  bottom on phones (`max-h-[85dvh]`, safe-area padding), a side panel from 1024 px up.
- Top line: «بۇ نۇسخىلار پەقەت مۇشۇ ئۈسكۈنىدە ساقلىنىدۇ.»
- One row per version (≥ 44 px): local time («بۈگۈن 15:40», «تۈنۈگۈن 09:12», otherwise
  `2026-10-07 15:40`), relative time («5 مىنۇت ئىلگىرى», «2 سائەت ئىلگىرى»), the reason
  («ئاپتوماتىك», «ئېچىلغاندا», «ئالماشتۇرۇشتىن بۇرۇن», «AI تۈزىتىشتىن بۇرۇن»,
  «ئەسلىگە قايتۇرۇشتىن بۇرۇن», «زىددىيەتتىن بۇرۇن») and its length («1,234 ھەرپ»). Newest first.
- Tapping a row shows a read-only preview rendered with `sanitizeNoteHtml` in the note's typography,
  with «بۇ نۇسخىغا قايتۇرۇش» and «قايتىش».
- Empty: «تېخى نۇسخا يوق. يازغانسېرى بۇ يەردە ئۆزلۈكىدىن پەيدا بولىدۇ.»
  Unavailable: «بۇ تور كۆرگۈچتە ئىلگىرىكى نۇسخىلارنى ساقلىغىلى بولمايدۇ (مەسىلەن، يوشۇرۇن كۆزنەكتە).»
- Restoring: take `before-restore`, write the version's title and HTML through stage 2's
  whole-document helper, then go through the normal save path (stage 2's conflict protection still
  applies). Notice: «ئەسلىگە قايتۇرۇلدى. ئالدىنقى ھالىتى «ئىلگىرىكى نۇسخىلار» دا ساقلاندى.»

### D. Privacy and cleanup

- **Sign-out** clears the version store before the sign-out action runs (wait at most 1 s; never
  block or fail sign-out because of it). Unsaved drafts from stage 2 are **not** touched.
- **Account deletion** clears the version store after the server confirms.
- On `/my/account`, in the card about what this site keeps on this device, show the history's size
  and a «تازىلاش» button with an inline two-step confirmation (no native dialog).
- In your final report, propose (do not apply) one Uyghur sentence for `/privacy` saying that
  earlier versions of notes are kept only in the writer's own browser and cleared on sign-out.

## Tests

- `npm run typecheck`, `npm run lint`, `npm run build`, `npm run test:unit`, full Playwright suite
  green — Chromium 375×667, 390×844, 1280×800 and the Firefox/WebKit notebook projects.
- **Unit (fake IndexedDB):** dedupe; 30 per note; 20 MB eviction order; the newest of a note is
  never evicted; user/note scoping; `clearAll`; every failure path resolves without throwing; the
  5-minute `auto` rule with fake timers.
- **Playwright:**
  1. Type, wait for «ساقلاندى», delete a paragraph, save → open the panel → restore the earlier
     version → the paragraph is back, saved, and the pre-restore state is listed as
     «ئەسلىگە قايتۇرۇشتىن بۇرۇن».
  2. Replace-all → a «ئالماشتۇرۇشتىن بۇرۇن» version exists and restores the note exactly.
  3. With IndexedDB made to throw (`page.addInitScript`), the editor still saves and the panel shows
     the unavailable message.
  4. Sign-out empties the store (check after signing in again); unsaved drafts survive.
  5. Panel: no horizontal overflow at 360/375 px; its list scrolls inside the sheet without
     scrolling the page behind it; every button visible and tappable after scrolling down and back
     up.

## Acceptance criteria

1. Every destructive action in the notebook (replace-all, AI apply, restore, both conflict choices)
   can be undone from «ئىلگىرىكى نۇسخىلار».
2. Nothing new is stored in Supabase; the history lives only on the device and is cleared on
   sign-out and account deletion.
3. Saving never waits on, or fails because of, the history store.
4. The panel meets the Mobile Rules on all three viewports and all three engines.
5. typecheck, lint, build, unit and all Playwright projects green.

Commit per logical step (`feat(notes): keep earlier versions on this device`,
`feat(notes): restore an earlier version`, `feat(my): show and clear note history`). Push, check
`https://bilimhezinisi.com/notes` with a test account, and finish with a short report **in simple
Uyghur**: what changed, what to try on his phone, and the proposed `/privacy` sentence.

If anything here conflicts with `CLAUDE.md`, or you would have to trade away the writer's text,
privacy, mobile quality or the free-tier limits to finish it, **stop and ask the owner in Uyghur** —
never make that trade silently.
