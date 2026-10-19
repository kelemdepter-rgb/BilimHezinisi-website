# PROMPT 43 — خاتىرە دەپتىرى، 2-باسقۇچ (9 دىن): يېزىلغان ھېچنەرسە يوقالمىسۇن

**قانداق ئىشلىتىسىز:** `PROMPT-42.md` تاماملىنىپ سايتقا چىققاندىن **كېيىن** ئىشلىتىڭ. Claude Code نى
`BilimHezinisi-website` قىسقۇچىدا **يېڭى تۈر** قىلىپ ئېچىڭ، «---» دىن كېيىنكى پۈتۈن ئىنگلىزچە قىسمىنى
چاپلاڭ. تۈگىگەندىن كېيىن `PROMPT-44.md` غا ئۆتۈڭ.

> **بۇ نېمە ئىش:** تەكشۈرۈشتە يېزىلغان نەرسىنى يوقىتىدىغان تۆت خاتالىق تېپىلدى ۋە سىناقتا
> ئىسپاتلاندى: (1) يازغاندىن كېيىن 1.2 سېكۇنت ئىچىدە «قايتىش» نى ياكى باشقا ئۇلانمىنى باسسىڭىز،
> ئاخىرقى يازغانلىرىڭىز ساقلانمايدۇ؛ (2) ساندان «مەغلۇپ بولدى» دېسە (5-ئۆكتەبىردىكىدەك)، يازغىنىڭىز
> ھېچ يەردە ساقلانمايدۇ، ئۈستىدە «قايتا سىنالماقتا» دېيىلسىمۇ قايتا سىنالمايدۇ؛ (3) ماۋزۇنىڭ ئاخىرقى
> ھەرپى ساقلانمايدۇ، چاپلانغان ماۋزۇ پەقەتلا ساقلانمايدۇ؛ (4) ئىككى ئۈسكۈنە ياكى ئىككى بەتكۈچ
> بىر-بىرىنىڭ يازغىنىنى ئاگاھلاندۇرماي ئۆچۈرىدۇ. بۇ باسقۇچتىن كېيىن ھەر بىر ئۆزگىرىش ئالدى بىلەن
> تېلېفون/كومپيۇتېرىڭىزغا ساقلىنىدۇ، مۇلازىمېتىر قوبۇل قىلغاندىلا ئۆچۈرۈلىدۇ. ئىككى نۇسخا توقۇنۇشسا،
> ئىككىلىسى ساقلىنىدۇ.
>
> **تۈگىگەندىن كېيىن سىناڭ:** (1) خاتىرىگە بىر جۈملە يېزىپ دەرھال «قايتىش» نى بېسىڭ، قايتا ئاچسىڭىز
> جۈملە تۇرۇشى كېرەك. (2) ماۋزۇنى ئۆزگەرتىپ بەتنى يېڭىلاڭ، تولۇق ماۋزۇ كۆرۈنۈشى كېرەك. (3) ئوخشاش
> خاتىرىنى تېلېفون ۋە كومپيۇتېردا ئېچىپ ئىككىلىسىدە يېزىڭ، سايت سىزدىن قايسىنى ساقلاشنى سورىشى كېرەك.

---

You are continuing an existing, live project. Read `CLAUDE.md` in this folder FIRST — it is the
project instruction and always wins — and use the **bilim-web** skill.

This is **stage 2 of 9** of the notebook plan (`PROMPT-42.md` … `PROMPT-50.md`, from
`AUDIT-2026-10-07.md`; N-numbers refer to its findings). **Do only this stage.** Stage 3 adds
per-account quotas and rate limits on top of the save path you build here, and stage 5 adds a
browser-local version history — design the save path so both can plug in without a rewrite (clear
result codes, one place where saving happens, one place where the document is replaced).

## Before you start

1. `git status`, `git log --oneline -20`. Stage 1 (PROMPT-42: line-aware text map, Firefox/WebKit
   notebook projects) must be merged and deployed. If it is not, **stop and tell the owner in
   Uyghur** that PROMPT-42 must be finished first. If there are uncommitted changes you did not make,
   stop and ask.
   Untracked planning files in the root (`PROMPT-*.md`, `AUDIT-*.md`, `HANDOFF-*.md` and the like)
   are the owner's and expected: leave them where they are and do not commit them.
2. Read the *Project context* files in full.

## What is broken (with evidence)

The save logic of `components/notes/note-editor.tsx` (lines 60–238) was copied verbatim into a
React 19 harness in Chromium 141, with `saveNoteAction` replaced by a recorder. Results:

| # | Scenario | What was saved |
|---|---|---|
| A | Title typed «تارىخ» letter by letter, then nothing else | `"تارى"` — the last character is lost (**N4**) |
| B | Title set in one change (`fill`/paste) to «دەرس پىلانى» | `"يېڭى خاتىرە"` — the new title is never saved (**N4**) |
| C | Typed «مۇھىم جۈملە» in the body, tapped the in-app back link 0.5 s later | **0 saves, no local draft** — the text is gone (**N2**) |
| D | Server answered `{ ok: false }`, then the tab was closed (`pagehide`) | state `error`, **no local draft** — the text is gone (**N3**) |

Root causes:

- **N4:** `save` is a `useCallback` closing over `title`; the title input's `onChange` calls the
  `scheduleSave` of the render *before* `setTitle` takes effect, so the timer runs a `save` that
  holds the previous title. The existing test passes only because it types in the body after the
  title (`tests/notes.spec.ts` lines 35–38).
- **N2:** the unmount cleanup (lines 233–238) clears the pending save timer and saves nothing;
  `pagehide` (lines 219–231) never fires on Next.js client navigation (back link, sidebar links,
  browser Back). On phones, switching apps is not handled at all (`visibilitychange`).
- **N3:** the `ok: false` branch (lines 179–183) writes no local copy; `pagehide` only writes one in
  `dirty`/`saving`, not `error`; the label «ساقلانمىدى — قايتا سىنالماقتا» says it is retrying, but
  retry happens only on the `online` event (lines 210–216). On 2026-10-05 a search flood left the
  database unable to answer and pages hanging for minutes (see `docs/search-flood.md`); any save
  made in that window would have taken this path.
- **N5 (P1, from the code; not reproduced):** `saveNoteAction` (`app/notes/actions.ts` lines
  98–102) updates without checking whether the row changed since the writer loaded it, and the
  draft restore (`note-editor.tsx` lines 163–168) uses a local draft even when the server holds a
  newer version. A phone that saved a draft offline, reopened after the note was edited on a PC,
  silently overwrites the PC's version on its next keystroke. Two open tabs overwrite each other.
- **N20 (P3):** drafts live under `bh-note-draft-<id>` with no account scope, and stay after the
  account is deleted.
- **N21 (P3):** the title input has no `maxLength`; the server silently cuts at 200 characters.
- **N2b — found while running stage 1 (2026-10-07), and the reason two tests are parked.** A save
  that is already in flight marks a NEWER edit as saved: the writer types a sentence, the save
  starts, something else is inserted or typed before it resolves, the resolve sets the label to
  «ساقلاندى», and that newer content was never sent — a reload loses it. Stage 1 left two tests
  `test.fixme` for it, each naming this stage:
  - `tests/notes-ai.spec.ts:258` — «streams, cancels cleanly, and inserts at the caret when asked»,
    skipped on Firefox;
  - `tests/notes-sources.spec.ts:86` — the library-citation round trip, skipped on WebKit.
  Both are timing-dependent and can fail on any engine. **Remove both `test.fixme` lines in this
  stage and make the tests pass unmodified on all three engines.** The revision rule in B and the
  `saved` rule in C below are what fix it: a save confirms only the exact content it carried.
- **N23 (P3):** Server Actions accept at most **1 MB** of request body by default (Next.js
  `serverActions.bodySizeLimit`). A heavily styled paste can exceed it; the request then throws, the
  editor shows «ئۇلىنىش يوق», and it can never succeed.

## Project context

Read in full: `components/notes/note-editor.tsx`, `app/notes/actions.ts`, `lib/notes/data.ts`,
`lib/notes/limits.ts`, `app/notes/[id]/page.tsx` and `layout.tsx`, `lib/admin/messages.ts`
(`ActionResult`), `components/notes/ai-panel.tsx` (it rewrites blocks itself and calls
`onDocumentChanged`), `components/notes/find-bar.tsx`, `components/my/delete-account.tsx` and
`app/my/account/actions.ts`, `app/(auth)/login` (does it support a return path?), `lib/supabase/*`
(fetch timeouts from PROMPT-40), `tests/notes.spec.ts`, `tests/notes-sources.spec.ts`,
`playwright.config.ts`. The `updated_at` column is maintained by the trigger
`note_documents_set_updated_at` (`supabase/migrations/0001_init.sql`).

## Non-negotiable constraints (restated from `CLAUDE.md`; they win over anything here)

- **No budget, ever.** Supabase Free + Vercel Hobby; no paid service, no new vendor, no runtime CDN.
  Do **not** raise `serverActions.bodySizeLimit`.
- **Anonymous reading always works.** RTL Uyghur UI; code, comments and commits in English.
- **Mobile Rules are hard:** `100dvh` never `100vh`; safe-area padding; ≥ 44 px targets; nothing
  hover-only; no horizontal scroll at 360 px; every control visible and tappable after scrolling down
  and back up; `overscroll-contain`; logical properties only.
- **A note is private.** RLS stays owner-only; every Server Action re-reads the session and filters
  by `user_id`; HTML is sanitized server-side on every write (`lib/notes/sanitize-server.ts`). A user
  id passed from the page is only a **storage namespace** in the browser, never an authorization.
  Never log, print or commit note content; test fixtures use invented text.
- **No native dialogs** (`alert`, `confirm`, `prompt`) in anything you add.
- Editor stays an uncontrolled `contentEditable` + `execCommand`; marks stay painted with the Custom
  Highlight API. AI stays BYOK, browser-only.
- Never edit an applied migration (this stage needs none); RLS on every table; do not weaken the CSP.
- **Never load-test production.** Specs against the real project create at most a handful of notes
  with `bh-e2e-` accounts and delete them.

## What to do

### A. Write-ahead local copy (fixes N2, N3, N20)

Every change to the body or title is first written to `localStorage`, and removed only when the
server has confirmed **that exact content**:

- Record `{ v: 2, userId, noteId, title, html, baseUpdatedAt, revision, writtenAt }` under
  `bh-note-draft-v2:<userId>:<noteId>`. Pass the signed-in user's id from the server page into the
  editor (extend what the page already loads; do not trust it for anything but the key).
- Write it debounced (≤ 300 ms) on every change, and **synchronously** on `pagehide`, on
  `visibilitychange` → `hidden`, and when the editor unmounts.
- `revision` increases on every change. When a save resolves `ok`, remove the draft only if no
  change happened while it was in flight (the saved revision equals the current one); otherwise keep
  it and save again.
- Read the legacy key `bh-note-draft-<noteId>` (a raw HTML string) once, treat it per E below, then
  delete it.
- Catch every storage error (private mode, quota). If the copy cannot be written, show once:
  «بۇ ئۈسكۈنىنىڭ ساقلىغۇچى تولغان — ئۇلىنىش ئۈزۈلسە يازغانلىرىڭىز ساقلانماسلىقى مۇمكىن.»
- After the account is deleted (`delete-account.tsx` flow, once the server confirms), remove every
  `bh-note-draft-v2:<thatUserId>:*` key and every legacy `bh-note-draft-*` key. **Sign-out does not
  remove drafts** — an unsaved draft is unsaved work; the account namespace keeps another account on
  the same browser from ever seeing it in the app. In your final report, propose (do not apply) one
  Uyghur sentence for `/privacy` saying that unsaved note drafts are kept in this browser until they
  are saved; the owner edits that page's wording himself.

### B. One save loop (fixes N2, N4, N23)

Extract the save logic into a small, framework-free module (a state machine with injected clock and
transport) so it can be unit-tested with fake timers, and drive it from the editor:

- At most one save in flight. Debounce 1.2 s after the last change. **At least 3 s between two
  server saves** (stage 3 adds a server-side rate limit; this keeps a normal writer far below it).
- **Flush immediately** on `visibilitychange` → `hidden` and on unmount (client navigation): write
  the draft synchronously, then start the save. The promise may resolve after unmount — guard every
  state update. Never block or delay navigation, and never show a "leave page?" dialog.
- Read the title from a ref at the moment of saving (fixes N4). Give the title input
  `maxLength={200}` — the same limit the server applies (N21).
- Before sending, measure the UTF-8 byte size of title + HTML. Above **900 KB** do not send; go to
  the `too_large` state below (N23).

### C. Honest results, honest labels, real retries (fixes N3)

`saveNoteAction` stays "never throws" (`guarded`) and returns a discriminated result:
`{ ok: true, updatedAt }` or `{ ok: false, code, error, serverUpdatedAt? }` with `code` one of
`needs_account | not_found | too_long | too_large | conflict | failed`. (Stage 3 will add `quota`
and `rate`; make adding a code a one-line change in one place.) `error` is the Uyghur sentence.

Editor states and the exact label in `data-testid="save-state"`:

| State | When | Label |
|---|---|---|
| `saved` | confirmed, **and** the document has not changed since that save was sent | «ساقلاندى» |
| `dirty` | changed, waiting | «ئۆزگەردى…» |
| `saving` | in flight | «ساقلىنىۋاتىدۇ…» |
| `offline` | request threw / `navigator.onLine` false | «ئۇلىنىش يوق — بۇ ئۈسكۈنىدە ساقلاندى» |
| `retrying` | `failed` | «ساقلانمىدى — بۇ ئۈسكۈنىدە ساقلاندى، قايتا سىنايدۇ» |
| `blocked` | `too_long`, `too_large`, `not_found`, `needs_account` | the specific message below |
| `conflict` | `conflict` | the banner in E |

- **A confirmed save never claims newer work (N2b).** Each save carries the revision it was built
  from. When it resolves `ok`, compare that revision with the current one: equal → `saved` and the
  draft is cleared; newer → the state goes back to `dirty` and the next save is scheduled at once.
  The label must never say «ساقلاندى» while something unsent is in the editor.
- `offline` and `retrying` retry by themselves after **5 s, 15 s, 45 s, then every 60 s** while the
  page is visible, and immediately on `online` and on becoming visible. Both show a
  «ھازىر قايتا سىناش» button (≥ 44 px) in the notice area under the toolbar — not in the title
  row, which has no room for it on a 360 px phone.
- `blocked` does not retry by itself; the next edit tries again. Messages:
  - `too_long`: the existing `MSG.tooLong`.
  - `too_large`: «خاتىرىدىكى فورمات بەك كۆپ، ساقلىغىلى بولمىدى. بىر قىسمىنى «فورماتنى تازىلاش» بىلەن ئاددىيلاشتۇرۇڭ ياكى ئىككىگە بۆلۈڭ. يازغانلىرىڭىز بۇ ئۈسكۈنىدە ساقلاندى.»
  - `needs_account`: «ھېساباتىڭىزدىن چىقىپ كېتىپسىز. يازغانلىرىڭىز بۇ ئۈسكۈنىدە ساقلاندى — قايتا كىرسىڭىز ساقلىنىدۇ.» with a «كىرىش» link to `/login` (returning to this note if the login page already supports a return path; do not add an open redirect).
  - `not_found`: «بۇ خاتىرە تېپىلمىدى. يازغانلىرىڭىز بۇ ئۈسكۈنىدە ساقلاندى.» with a button
    «يېڭى خاتىرە قىلىپ ساقلاش» (creates a new note with this content, see E).
- Messages live in the existing notice area (`role="status"` / `role="alert"`), not in a dialog.

### D. Server side of the save

- `saveNoteAction({ id, title, html, baseUpdatedAt })`: sanitize as today; then
  `update … where id = $id and user_id = $me and updated_at = $base` returning `updated_at`
  (`.select("updated_at").maybeSingle()`). No row → read the row's `updated_at` (owner-filtered):
  missing → `not_found`; present → `conflict` with `serverUpdatedAt`. Pass the timestamp exactly as
  PostgREST returned it (microseconds) and add a test proving the round trip.
- `createNoteAction` accepts optional `{ title, html }` (sanitized, same length checks) and returns
  `{ id, updatedAt }`, so "save my version as a new note" is one request.
- A tiny owner-filtered action `noteVersionAction(id)` returning only `updated_at`, used in E below.
- Keep `revalidatePath("/notes")` behaviour; do not add new Supabase calls per keystroke.

### E. Two versions never silently overwrite each other (fixes N5)

- The editor keeps `baseUpdatedAt`: the value the page loaded, then the value returned by each
  successful save.
- On `conflict`: pause autosave (keep writing the local draft), keep editing allowed, and show a
  banner (`role="alert"`, ≥ 44 px buttons, not a native dialog):
  «بۇ خاتىرە باشقا يەردە (باشقا بەتكۈچ ياكى ئۈسكۈنىدە) ئۆزگەرتىلدى. يازغانلىرىڭىز يوقالمىدى.»
  - «ئىككى خاتىرە قىلىپ ساقلاش» (first, recommended): the writer's version is saved as a **new**
    note titled `<title> (بۇ ئۈسكۈنىدىكى نۇسخا)`; this note then loads the server's version; the
    notice says where the copy is, with a link to it.
  - «مېنىڭ نۇسخامنى بۇنىڭ ئورنىغا قويۇش»: save again with `baseUpdatedAt = serverUpdatedAt`.
  Replacing the editor's whole content here (loading the server version) is a **direct, sanitized
  write** of `innerHTML` and the title, done in one helper that stage 5 will also call — never
  `selectAll` + `insertHTML` (that corrupts notes that start with a heading, quote or list; see
  stage 4).
- On open, if a draft exists:
  - draft `baseUpdatedAt` equals the server's `updated_at` → restore it (keep the existing notice
    «ئۇلىنىش ئۈزۈلگەندە ساقلانغان نۇسخا ئەسلىگە كەلتۈرۈلدى.») and **save it right away**;
  - server is newer → open straight into the conflict state with the same two choices;
  - legacy draft (no base): identical to the server HTML → delete silently; otherwise → conflict
    state.
- When the tab becomes visible after being hidden ≥ 60 s, call `noteVersionAction`. Newer on the
  server and nothing unsaved here → load it and say «باشقا يەردە ئۆزگەرتىلگەن يېڭى نۇسخا ئېچىلدى.»;
  newer and unsaved changes here → conflict state.

## Tests

- `npm run typecheck`, `npm run lint`, `npm run build`, `npm run test:unit`, full Playwright suite
  green — Chromium at 375×667, 390×844, 1280×800 **and** the Firefox and WebKit notebook projects
  from stage 1.
- **Unit (fake timers):** debounce; 3 s throttle; one in flight; flush on hidden/unmount; retry
  schedule 5/15/45/60 s and on `online`; draft removed only when the saved revision is current;
  title read at save time (scenarios A and B above as tests); `too_large` at 900 KB; every result
  code → state → label; legacy draft migration; conflict transitions; account-deletion cleanup of
  only that user's keys.
- **Playwright** (simulate failures by routing the Server Action POST — requests to the page URL
  carrying a `Next-Action` header — and aborting them; never by breaking the real project):
  1. Type a sentence, tap `notes-back` within 300 ms, reopen → the sentence is there and the label
     reaches «ساقلاندى».
  2. Rename by typing, wait for «ساقلاندى», reload → full title. Same with `fill` (one change).
  3. Abort saves → label «ئۇلىنىش يوق — بۇ ئۈسكۈنىدە ساقلاندى»; close the page; open the note in a
     new page with saves allowed → restored and saved.
  4. Abort saves, then allow them → the retry happens by itself (no typing) within the schedule;
     also the «ھازىر قايتا سىناش» button works.
  5. Two pages on the same note: save in page A, then type in stale page B → B shows the conflict
     banner; «ئىككى خاتىرە قىلىپ ساقلاش» → two notes, both texts intact; delete both.
  6. Dispatch `visibilitychange` with `document.visibilityState` overridden to `hidden` → a save
     request leaves before the 1.2 s debounce would have fired.
  7. Banner, labels and the retry button: no horizontal overflow at 360/375 px; visible and tappable
     after scrolling down and back up.

## Acceptance criteria

1. Scenarios A–D from the table above, re-run against the new code, all keep the writer's text
   (A and B save the full title), and both tests stage 1 parked for N2b — `notes-ai.spec.ts:258` and
   `notes-sources.spec.ts:86` — pass unmodified on all three engines with their `test.fixme` lines
   removed.
2. A note edited on two devices or tabs is never silently overwritten; the writer chooses, and the
   recommended choice keeps both.
3. Every label tells the truth; `offline`/`retrying` really retry on the stated schedule.
4. A payload over 900 KB is never sent and the writer is told why; nothing is lost.
5. Drafts are namespaced per account and removed on account deletion; sign-out leaves unsaved work.
6. typecheck, lint, build, unit and all Playwright projects green.

Commit per logical step (`fix(notes): keep a local copy until the server confirms it`,
`fix(notes): save the title the writer typed`, `feat(notes): never overwrite a newer version`, …),
push, and confirm on `https://bilimhezinisi.com` with a test account that a note still opens and
saves. Finish with a short report **in simple Uyghur**: what changed, the three things to try on his
phone (in this file's header), and the proposed `/privacy` sentence.

If anything here conflicts with `CLAUDE.md`, or you would have to trade away the writer's text,
privacy, mobile quality or the free-tier limits to finish it, **stop and ask the owner in Uyghur** —
never make that trade silently.
