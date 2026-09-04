# PROMPT 19 — سۈنئىي ئىدراك: خاتىرە دەپتىرىدىكى AI (ئاخىرقى باسقۇچ)

## قانداق ئىشلىتىسىز (يېڭى تۈر ئېچىپ)
1. Claude Code نى ئېچىپ **BilimHezinisi-website** قىسقۇچىنى تاللاڭ، ھەمدە دېسكتوپ دېتال
   قىسقۇچىنىمۇ قوشۇپ تاللاڭ (`bilim hezinisi pc`) — پەقەت ئوقۇش ئۈچۈن پايدىلىنىش مەنبەسى.
2. سىزىقتىن تۆۋەنكى تېكىستنى پۈتۈنلەي كۆچۈرۈپ چاپلاڭ.

> **بۇ AI باسقۇچىنىڭ 3-قىسمى ۋە پۈتۈن پىلاننىڭ ئاخىرقى بۆلىكى.** خاتىرە دەپتىرىدە
> ئەركىن سۆزلىشىش، تىنىش بەلگىسى/ئىملا توغرىلاش، خۇلاسىلەش، تەرجىمە.
>
> **دىققەت:** يەرلىك (تورسىز) ئىملا تەكشۈرگۈچ ئۆزگەرمەيدۇ. AI بىلەن تۈزىتىش ئۇنىڭ
> ئورنىنى ئالمايدۇ — دېسكتوپتىكىدەك، ئىككىسى ئايرىم ۋە يەرلىكى ھامان ئاساسىي.

---

You are continuing an existing, live project. Read `CLAUDE.md` in this folder FIRST —
it is the project instruction and always wins — and use the **bilim-web** skill.

## Project context (Phases 1–18 are done and deployed)
Live at `https://bilim-hezinisi-website.vercel.app` — a free public Uyghur digital
library. Next.js App Router + TypeScript + Tailwind on **Vercel Hobby**, data in
**Supabase Free**.

Already built — do not rebuild or redesign any of it: the whole library, reader, search,
Qur'an module, PWA with offline reading, book download, sharing, discovery pages, the
licence/trust work, the notebook at `/notes` (rich text, autosave with offline recovery,
DOCX export, library and aya citation insertion, find & replace), the offline Uyghur
spellchecker in `lib/spellcheck/`, the AI foundation in `lib/ai/` from PROMPT 17, and the
reader AI panel from PROMPT 18.

## Non-negotiable constraints
- **The owner pays nothing, ever.** The reader's own Gemini key, in the reader's own
  browser, going straight to Google. No server-side key, no `GEMINI_API_KEY`, no new
  vendor account. Use `lib/ai/` exactly as it exists — **do not add a second transport
  path.**
- **Nothing about AI is logged or stored server-side** — not the key, not a prompt, not a
  response. Note content is the most private thing on this site; treat it accordingly.
- The notebook must remain fully usable with AI off, offline, and for a reader who never
  enables it.
- **Do not reopen the offline spellchecker.** It is finished (PROMPTs 10–12) and it
  already handles inflected forms that shipped Uyghur checkers get wrong. AI proofreading
  is an *additional*, clearly-labelled online option — exactly as the desktop separates
  «ئىملانى تەكشۈرۈش (تورسىز)» from the Gemini correction.
- RTL Uyghur UI; code, comments and commit messages in English.
- All Mobile Rules in `CLAUDE.md` apply.
- Note HTML is sanitized before storage and on render — anything AI produces goes through
  the same sanitizer. Never bypass it.
- Do not weaken the CSP.

---

# STEP 1 — Read the desktop implementation first

- `src/notes.js` — the AI workspace: «سۈنئىي ئىدراكتىن سوراش»,
  «تىنىش بەلگىلىرى ۋە ئىملانى توغرىلاش», «خۇلاسىلەش», «تەرجىمە قىلىش»,
  «كۆرۈنمە بەت ھەققىدە سوئال سوراش», and how results are inserted or replaced.
- `ai.js` — `buildProofreadPrompt` and its **segmented `⟦N⟧` protocol**, which is what
  makes it safe to correct a long document without the model quietly rewriting or
  dropping paragraphs. Port it exactly.
- `main.js` — `ai-chat-stream` (~line 1291) and `preload.js` — `AIBridge.chatStream`, for
  the free-form chat contract.

**Port the prompts verbatim.** They are tuned for Uyghur and force Uyghur output.

---

# STEP 2 — Build it

## 2.1 Free-form chat
- A panel in the notebook (a drawer on a phone) where the writer can ask anything, with
  the message history kept for the session.
- Streaming, cancellable, using the existing `lib/ai/` contract.
- Insert an answer into the note at the cursor, or copy it — the writer chooses; nothing
  is inserted automatically.

## 2.2 Proofreading and punctuation
- Works on the selection, or on the whole note.
- Uses the segmented `⟦N⟧` protocol from `buildProofreadPrompt` so nothing is silently
  reworded or lost.
- **Show a diff before applying.** The writer sees exactly what will change and accepts
  or rejects — accepting must be undoable in one step. A proofreader that silently
  rewrites someone's work is a bug, not a feature.
- Labelled clearly as the **online** option, next to and separate from the offline
  spellchecker. Both must keep working independently.

## 2.3 Summarise and translate
- Summarise the selection or the whole note.
- Translate in the desktop's six directions (uy↔ar, uy↔en, uy↔tr), using the translation
  prompt path that deliberately bypasses `SYSTEM_BASE`.
- Results go into the panel first; inserting or replacing is always the writer's explicit
  choice.

## 2.4 Cost and size discipline
- A long note can exceed what one request should carry. Respect the desktop's
  `MAX_CONTEXT_CHARS` ceiling, tell the writer in Uyghur when a document is too large,
  and offer to work on the selection instead — never silently truncate their document and
  return a partial result as if it were complete.
- Show a size estimate before a whole-document operation.

---

# STEP 3 — Mobile behaviour (hard requirements)

The notebook is where the on-screen keyboard, a scrollable editor and a panel all collide.
This is the highest-risk screen in the project for the failures `CLAUDE.md` was written
to prevent.

- The AI panel is a bottom sheet or full-screen drawer on a phone, never a squeezed
  column.
- `100dvh` / `min-h-dvh`, `env(safe-area-inset-*)`, `overscroll-contain`.
- Opening the panel must not lose unsaved note content, must not move the caret, and must
  not break autosave or the offline recovery buffer.
- With the software keyboard open, the send button and the editor's own toolbar must both
  remain visible and tappable.
- Every control at least 44 px; no horizontal scroll at 360 px; everything still reachable
  after scrolling down and back up.

---

# STEP 4 — Honesty

- Nothing AI-related is visible unless the writer has enabled AI at `/my/ai`.
- Before the first use in a session, remind them briefly and truthfully that the text sent
  goes to Google, and — on the free tier — that Google may use it and a human may read
  it. Link to the fuller explanation. Dismissible; not repeated on every open.
- Notes are private. Make it unmistakable in the interface **which** text is being sent:
  the selection or the whole document, highlighted before sending. A writer must never
  send their whole private notebook to Google by accident.
- A short permanent note that AI output can be wrong and should be checked.

---

# Tests and reporting (mandatory)

- `npm run typecheck && npm run lint && npm run build` all pass.
- Existing unit and Playwright suites stay green at **375×667, 390×844 and 1280×800**,
  including the entire spellcheck suite, unchanged.
- New Playwright coverage at all three viewports, against a **mocked** Gemini endpoint
  (never spend real quota in CI):
  - a writer with AI disabled sees no AI control in the notebook and is not nagged;
  - chat streams, cancels cleanly, and inserting an answer lands at the cursor;
  - proofreading shows a diff, applying it is undoable in one step, and rejecting it
    leaves the document byte-identical;
  - the offline spellchecker still underlines and still suggests, with AI both on and off;
  - a document over the size ceiling produces a clear Uyghur message and an offer to work
    on the selection — never a silent truncation;
  - on a phone: the panel does not trap body scroll, does not cover the editor toolbar
    with the keyboard open, and does not disturb autosave or offline recovery;
  - what is about to be sent is visibly indicated before sending.
- Unit tests for the segmented `⟦N⟧` proofreading protocol, including a response with a
  missing or reordered segment — which must be rejected rather than applied.
- A test proving no AI request or response is cached by the service worker or written to
  Supabase.
- Final report in **simple Uyghur**: what was ported, what was left out, how a long
  document is handled, and a numbered list of what I must do myself.

# Acceptance criteria
- The desktop notebook's AI workspace now exists on the web, with the same prompts.
- Proofreading never changes a document without showing the writer first, and is always
  undoable in one step.
- The offline spellchecker is untouched and all its tests pass unchanged.
- A writer can always see which text is about to be sent to Google, and can never send
  the whole notebook by accident.
- The notebook remains fully usable offline and with AI off.
- Nothing about AI reaches the owner's server, logs or database, and the owner pays
  nothing.
- Nothing from Phases 1–18 regressed; no second AI transport path; the CSP was not
  weakened.

**This completes the planned build.** In the final report, list honestly what is still
weak or unfinished across the whole project, so I know where to look next.

Commit per logical step with English conventional messages. **If porting a desktop
behaviour faithfully would break a mobile rule or risk a writer's note content, stop and
explain the conflict to me in Uyghur rather than choosing silently.**
