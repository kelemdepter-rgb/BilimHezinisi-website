# PROMPT 18 — سۈنئىي ئىدراك: ئوقۇغۇچتىكى AI تاختىسى

## قانداق ئىشلىتىسىز (يېڭى تۈر ئېچىپ)
1. Claude Code نى ئېچىپ **BilimHezinisi-website** قىسقۇچىنى تاللاڭ، ھەمدە دېسكتوپ دېتال
   قىسقۇچىنىمۇ قوشۇپ تاللاڭ (`bilim hezinisi pc`) — پەقەت ئوقۇش ئۈچۈن پايدىلىنىش مەنبەسى.
2. سىزىقتىن تۆۋەنكى تېكىستنى پۈتۈنلەي كۆچۈرۈپ چاپلاڭ.

> **بۇ AI باسقۇچىنىڭ 2-قىسمى.** 1-قىسمى (PROMPT 17) ئاچقۇچ، مودېل ۋە ئېقىم
> قۇرۇلمىسىنى ياسىغان. بۇ يەردە دېسكتوپ ئوقۇغۇچىدىكى AI تاختىسى تور بېتىگە
> كۆچۈرۈلىدۇ: خۇلاسىلەش، تەرجىمە، مەركىزىي ئىدىيە، ئاتالغۇ چۈشەندۈرۈش، ئەركىن سوئال.
>
> **prompt لارنى ئۆزىڭىز ئويلاپ چىقارماڭ** — دېسكتوپ `ai.js` دا ئۇلار ئاللىبۇرۇن
> سىنالغان ۋە پىششىقلانغان. شۇلارنى كۆچۈرۈڭ.

---

You are continuing an existing, live project. Read `CLAUDE.md` in this folder FIRST —
it is the project instruction and always wins — and use the **bilim-web** skill.

## Project context (Phases 1–17 are done and deployed)
Live at `https://bilim-hezinisi-website.vercel.app` — a free public Uyghur digital
library. Next.js App Router + TypeScript + Tailwind on **Vercel Hobby**, data in
**Supabase Free**.

Already built — do not rebuild or redesign any of it: the whole library, reader, search,
Qur'an module, notebook with spellcheck and citation insertion, PWA with offline
reading, book download, sharing, discovery pages, the licence/trust work, and — from
PROMPT 17 — the AI foundation in `lib/ai/`: browser-only key storage, backup keys, strict
model selection, streaming with `onChunk`/`onDone`/`onError` and `abort`, timeout, retry,
key failover, Uyghur error messages, and the `/my/ai` settings screen.

## Non-negotiable constraints
- **The owner pays nothing, ever.** The reader's own Gemini key, in the reader's own
  browser, going straight to Google. No server-side key, no `GEMINI_API_KEY`, no new
  vendor account. Use `lib/ai/` exactly as PROMPT 17 built it — **do not add a second
  transport path.**
- **Nothing about AI is logged or stored server-side** — not the key, not a prompt, not a
  response, not the fact that a request happened.
- Anonymous browsing, reading and search must keep working with **no account** and with
  **no AI**. A signed-out visitor must see no AI controls at all, and a signed-in reader
  who has not enabled AI must not be nagged.
- The reader must remain completely usable with AI off. **The AI panel must never cover,
  shrink or interfere with reading.**
- RTL Uyghur UI; code, comments and commit messages in English.
- All Mobile Rules in `CLAUDE.md` apply — this is the screen where they matter most.
- Do not weaken the CSP.

---

# STEP 1 — Read the desktop implementation before writing anything

The desktop's reader AI panel is the specification. Study, and report what you found:

- `src/index.html` — `id="rai-panel"` and everything under it: `rai-scope-row`,
  `rai-type`, `rai-quick`, `rai-tr-menu`, `rai-term-menu`, `rai-question`, `rai-chips`,
  `rai-deep`, `rai-status`, `rai-answer`, `rai-answer-actions`, and the `aiSelChip`
  floating button.
- `ai.js` — `SYSTEM_BASE`, `buildPrompt`, `buildTranslationPrompt`,
  `buildProofreadPrompt`, `buildOcrCleanupPrompt`, and the per-type prompt construction.
- `src/ai-client.js` — `detectType`, `typeLabel`, `MAX_CONTEXT_CHARS`, the example chips.

**Port the prompts verbatim.** They encode a lot of tuning: forcing Uyghur output,
the translation path deliberately bypassing `SYSTEM_BASE` so translating *into* another
language works, and the segmented `⟦N⟧` protocol for proofreading. Rewriting them from
scratch will produce worse answers in Uyghur, and you will not notice.

The one thing you must **not** port is anything OCR-related — `buildOcrCleanupPrompt` and
Gemini OCR are out of scope on the web, permanently.

---

# STEP 2 — Build the panel

## 2.1 Scope
Three choices, as the desktop has: **تاللانغان** (the current text selection),
**بۇ بەت** (the page on screen), **پۈتۈن كىتاب**.

- «تاللانغان» must be selectable by **tap** on a phone. No hover-only affordance.
- «پۈتۈن كىتاب» has a real cost on the web that it does not have on the desktop: the
  whole book must be fetched. Reuse pages already cached by the PWA, fetch the rest
  through the normal reader path, show progress, allow cancelling, and show the reader
  roughly how large the request is before sending it. Respect the desktop's
  `MAX_CONTEXT_CHARS` safety ceiling and degrade with a clear Uyghur message rather than
  a raw API size error.

## 2.2 Text type
The desktop's list, with the same per-type prompt behaviour: ھەدىس · تەپسىر · فىقھ ·
شېئىر · سىياسىي · ئەدەبىي · تەرجىمە · چۈشەندۈرۈش · ئادەتتىكى. Auto-detect with
`detectType` and let the reader override, exactly as the desktop does.

## 2.3 Quick actions
- **خۇلاسىلەش** — summary
- **تەرجىمە** — the desktop's six directions (uy↔ar, uy↔en, uy↔tr)
- **مەركىزىي ئىدىيەسى** — central idea
- **ئاتالغۇ چۈشەندۈرۈش** — both the desktop's modes: type a term manually, or automatic

## 2.4 Free question
A question box with the desktop's suggestion chips (`rai-chips`, regenerated per text
type) and the **چوڭقۇر مۇلاھىزە** toggle.

## 2.5 The answer
- Streams in as it arrives, in Uyghur, right-to-left, in the site's own fonts, rendered
  through the existing sanitizer — never with raw HTML injection.
- **كۆچۈرۈش** copies it.
- **خاتىرىگە ساقلاش** saves it into the notebook built in PROMPTs 8 and 16, with a
  reference back to the book and page it came from.
- A cancel control is available for as long as the stream is running.
- The answer area is scrollable on its own without trapping body scroll.

---

# STEP 3 — Mobile behaviour (hard requirements)

On the desktop the AI panel is a third column next to the text. On a phone that is
impossible, and getting this wrong would ruin the reader — which is exactly the failure
mode `CLAUDE.md` was written to prevent.

- On a phone the panel is a **bottom sheet or full-screen drawer**, never a squeezed
  column.
- It uses `100dvh` / `min-h-dvh`, respects `env(safe-area-inset-*)`, and has
  `overscroll-contain`.
- Opening it must not lose the reading position; closing it must return the reader to
  exactly where they were, with their scroll position intact.
- The keyboard opening for the question box must not push the send button off-screen or
  behind a fixed bar.
- Every control is at least 44 px and reachable by tap.
- No horizontal scroll at 360 px width.
- After scrolling down and back up, every reader control and every AI control is still
  visible and tappable.

---

# STEP 4 — Honesty in the interface

- The panel exists only for a signed-in reader who has enabled AI at `/my/ai`. Everyone
  else sees nothing — not a disabled button, not a teaser.
- The first time the panel is opened in a session, remind the reader briefly and
  truthfully that the selected text is sent to Google, with a link to the fuller
  explanation on `/my/ai`. It should be dismissible and must not appear on every open.
- Answers must be presented as what they are. Add a short, permanent, unobtrusive Uyghur
  note that AI answers can be wrong and should be checked against the book itself —
  particularly relevant here, where readers will ask about religious and historical
  texts.
- Never present an AI answer in a way that could be mistaken for the book's own text: it
  must be visually distinct from the reading surface.

---

# Tests and reporting (mandatory)

- `npm run typecheck && npm run lint && npm run build` all pass.
- Existing unit and Playwright suites stay green at **375×667, 390×844 and 1280×800**.
- New Playwright coverage at all three viewports, against a **mocked** Gemini endpoint
  (never spend real quota in CI):
  - a signed-out visitor sees no AI control anywhere in the reader;
  - a signed-in reader with AI disabled sees no AI control and no prompt to enable it;
  - with AI enabled: each scope works, each quick action fires the right prompt, the
    answer streams and can be cancelled cleanly;
  - «خاتىرىگە ساقلاش» produces a note containing the answer and a working link back to
    the source page;
  - on a phone the panel opens as a sheet, never covers the reader's own controls, does
    not trap body scroll, and closing it restores the exact reading position;
  - opening the on-screen keyboard for the question box keeps the send button visible;
  - a quota error and an unavailable-model error both render as readable Uyghur, and the
    model is never silently substituted.
- Unit tests proving the ported prompts are byte-identical in substance to the desktop's
  for at least the translation, summary and term-explanation paths — including that
  translation bypasses `SYSTEM_BASE`.
- A test proving no AI request or response is cached by the service worker.
- Final report in **simple Uyghur**: what was ported, what was deliberately left out,
  the measured cost in bytes of a «پۈتۈن كىتاب» request on your largest test book, and a
  numbered list of what I must do myself.

# Acceptance criteria
- The desktop's reader AI panel now exists on the web, with the same prompts, the same
  text types and the same quick actions.
- On a 375 px phone the panel never covers or degrades reading, and the reading position
  survives opening and closing it.
- Nothing about AI reaches the owner's server, logs or database, and the owner pays
  nothing.
- Readers are told plainly, before use, where their text goes and that answers can be
  wrong.
- Nothing from Phases 1–17 regressed; no second AI transport path was added; the CSP was
  not weakened.
- Do NOT build the notebook AI — that is PROMPT 19.

Commit per logical step with English conventional messages. **If porting a desktop
behaviour faithfully would break a mobile rule, stop and explain the conflict to me in
Uyghur rather than choosing silently — the mobile rules win, but I want to know what was
given up.**
