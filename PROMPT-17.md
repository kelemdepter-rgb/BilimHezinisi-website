# PROMPT 17 — سۈنئىي ئىدراك: ئۇل قۇرۇلما (ھەر كىم ئۆز ھەقسىز ئاچقۇچى بىلەن)

## قانداق ئىشلىتىسىز (يېڭى تۈر ئېچىپ)
1. Claude Code نى ئېچىپ **BilimHezinisi-website** قىسقۇچىنى تاللاڭ، ھەمدە دېسكتوپ دېتال
   قىسقۇچىنىمۇ قوشۇپ تاللاڭ (`bilim hezinisi pc`) — پەقەت ئوقۇش ئۈچۈن پايدىلىنىش مەنبەسى.
2. سىزىقتىن تۆۋەنكى تېكىستنى پۈتۈنلەي كۆچۈرۈپ چاپلاڭ.

> **بۇ AI باسقۇچىنىڭ 1-قىسمى.** بۇ يەردە پەقەت **ئۇل قۇرۇلما** ياسىلىدۇ: ئاچقۇچ
> تەڭشىكى، مودېل تاللاش، ئېقىم (streaming)، خاتالىق بىر تەرەپ قىلىش. ئوقۇغۇچتىكى
> AI تاختىسى (PROMPT 18) ۋە خاتىرە دەپتىرىدىكى AI (PROMPT 19) ئايرىم كېلىدۇ.
>
> **مۇھىم:** ئاچقۇچ **پەقەت ئىشلەتكۈچىنىڭ ئۆز توركۆرگۈسىدە** تۇرىدۇ. سىزنىڭ
> سېرۋېرىڭىزغا ھېچقاچان كەلمەيدۇ، Supabase غا ساقلانمايدۇ. سىزگە بىر تىيىنمۇ چىقىم
> بولمايدۇ ۋە باشقىلارنىڭ مەخپىي ئاچقۇچىغا مەسئۇل بولمايسىز.

---

You are continuing an existing, live project. Read `CLAUDE.md` in this folder FIRST —
it is the project instruction and always wins — and use the **bilim-web** skill.

## Project context (Phases 1–16 are done and deployed)
Live at `https://bilim-hezinisi-website.vercel.app` — a free public Uyghur digital
library. Next.js App Router + TypeScript + Tailwind on **Vercel Hobby**, data in
**Supabase Free**. GitHub `kelemdepter-rgb/BilimHezinisi-website`.

Already built — do not rebuild or redesign any of it: manuscript design tokens
(light/dark/sepia), RTL shell, Supabase Auth with `admin`/`uploader`/`reader`, RLS on
every table, `ug_normalize()`, admin tools, library home, book detail, reader (lazy
pages, themes, font controls, position restore, bookmarks, notes, in-book search,
download, share), global exact-phrase search, Qur'an module, SEO, rate limiting, the
notebook with spellcheck and library/aya citation, the licence + trust work (PROMPT 13),
PWA + download + share (PROMPT 14), discovery (PROMPT 15), notebook parity (PROMPT 16).

**This is the last planned phase and the only one never started.**

## Non-negotiable constraints
- **The owner pays nothing, ever.** Supabase Free + Vercel Hobby. No paid service, no
  new vendor account, no server-side Gemini key, no `GEMINI_API_KEY` environment
  variable. If a design would put a bill on the owner, it is the wrong design.
- **Bring your own key.** Each signed-in reader supplies their own free Google Gemini
  API key.
- Anonymous browsing, reading and search must keep working with **no account** and with
  **no AI**. AI is strictly optional; the site is fully usable without it and must never
  nag about it.
- RTL Uyghur UI; code, comments and commit messages in English.
- All Mobile Rules in `CLAUDE.md` apply.
- New migrations are NEW files in `supabase/migrations/`; never edit an applied one.

---

# STEP 0 — Two things to settle before you write any feature code

## 0.1 The key never leaves the reader's browser

The decision, made by the owner, is:

> The reader's Gemini key is stored **in their own browser only**, and requests go
> **directly from their browser to Google**. It is never sent to our server, never
> written to Supabase, never logged.

Consequences you must implement and must not quietly reverse:
- No `GEMINI_API_KEY` env var. No `ai_usage` table writes. No server route that receives
  a key.
- `CLAUDE.md` currently says the opposite — it describes storing the key per user and
  proxying through server routes, and lists `GEMINI_API_KEY` under environment
  variables. **Update `CLAUDE.md` to describe the browser-only design**, or a future
  session will build the wrong thing. Do this in the first commit.
- If the schema already defines an `ai_usage` table from Phase 1, leave the table alone
  (never edit an applied migration) but write nothing to it, and note in `CLAUDE.md` that
  it is unused.

## 0.2 Verify the transport before building on it — this is a spike, not an assumption

Google's documentation recommends a backend proxy for client-side apps, because normally
the exposed key is the *developer's*. Here the key is the *reader's own*, in their own
browser, so that specific risk does not apply — but you must still confirm the transport
actually works:

1. Confirm empirically whether `https://generativelanguage.googleapis.com` permits a
   cross-origin request from a browser, including the **streaming** endpoint, with the
   key passed the way Google currently documents. Do this first, with a throwaway test
   page, and report the result.
2. If it works: no server route at all. Add
   `https://generativelanguage.googleapis.com` to `connect-src` in the CSP from
   PROMPT 13 — **only that host, only `connect-src`.** Do not relax anything else.
3. If it does **not** work: fall back to a thin Vercel route that forwards the request
   and streams the response back, and which **never stores the key, never logs it, and
   never logs prompt or response content**. State clearly in the report that this
   fallback was used, and that it now consumes the owner's Vercel function allowance.

Do not skip step 1. Report which path you took and why.

---

# STEP 1 — Tell the reader the truth before they turn it on

Google's Gemini API terms say that for the **unpaid tier**, Google uses the content
submitted and the generated responses to provide, improve and develop Google products,
and that **human reviewers may read, annotate and process the input and output**. The
paid tier excludes this.

Every reader of this library must understand that before they enable AI, in Uyghur, in
plain words:

- what they type into AI, and the book text sent with it, goes to Google;
- on the free tier Google may use it to improve its products, and a human may read it;
- the library itself never sees, stores or logs any of it;
- AI is optional and everything else works without it.

Requirements:
- This warning appears **on the settings screen, before the key field**, not hidden
  behind a link, and enabling AI requires an explicit action after it is visible.
- Verify the current wording of Google's terms yourself at implementation time and quote
  the substance accurately. **Do not invent or soften it.** If the terms have changed,
  write what they say now and tell the owner in the report.
- Link to Google's terms page.

---

# STEP 2 — Settings

A new `/my/ai` screen (signed-in only), reachable from the account menu.

Port the shape of the desktop's settings dialog (`src/index.html`, `id="setov"`) and
`ai.js`, adapted to the browser-only design:

## 2.1 Key management — four slots with automatic failover
- An on/off switch. Off is the default for everyone, forever, until they turn it on.
- **Four key fields**, matching the desktop: one primary plus three backups
  (`PREF_API_KEY` and `PREF_BACKUP_KEYS` in `ai.js`). All four are password-type fields.
- A short Uyghur explanation of how to get a free key from Google AI Studio
  («Get API key»), and the note that older keys begin `AIza` and newer ones `AQ.`
  (as the desktop explains). Carry over the desktop's important instruction that each
  backup key should be created under a **different** Google Cloud project, because free
  quota is per project — otherwise failover buys nothing.
- **«باغلىنىشنى سىناش»** per slot: each of the four can be tested individually and shows
  its own result (valid / invalid / quota exhausted / paid-only), so the reader can see
  at a glance which slots actually work.
- **Automatic failover is mandatory.** When a request fails on the current key with a
  quota error (429) or an overload/server error (503/5xx), the app moves to the next
  configured key **by itself**, with no action from the reader and no interruption to the
  answer they are waiting for. It keeps trying down the list until one succeeds or all
  four are exhausted. Only then does it show an error. Failover changes the **key**
  and never the **model** — this is a hard rule.
- Remember which slot last worked and start there next time, so a reader whose first key
  is permanently exhausted does not pay a failed request every time.
- Show, unobtrusively, which slot is currently in use, so the reader understands why
  behaviour changed.
- The keys are stored in the browser only. Display each masked after saving; never render
  one back into the DOM in full.
- A clear way to remove all four keys and every trace of AI state from the browser in one
  action, also linked from `/my/account`.
- Be honest in the UI about what browser storage means: anything stored in a browser is
  readable by anything that can run script on the page. The site has a strict CSP and
  sanitizes all rendered HTML, but say plainly that a shared or public computer is not a
  good place to save a key.

## 2.2 Model selection — exactly these three, strict, never silent

Offer exactly these three models, in this order. The free/paid status below was
**verified against Google's official pricing page on 2026-08-19** — do not change it from
memory:

| Model ID | Free tier | Paid price (per 1M tokens) |
|---|---|---|
| `gemini-3.7-flash` | **available** | $0.75 in / $3.75 out through 31 Dec 2026, then $1.50 / $7.50 |
| `gemini-3.5-flash-lite` | **available** | $0.30 in / $2.50 out |
| `gemini-3.1-pro-preview` | **not available — paid key required** | $2.00 / $12.00 ≤200k tokens; $4.00 / $18.00 above |

Uyghur labels in the picker — port the desktop's `aiModelDesc` wording and update it to
these three:

```
gemini-3.7-flash       — تەۋسىيە · ئۈنۈمى ياخشى · سۈرئىتى تېز · (ھەقسىز)
gemini-3.5-flash-lite  — ئۈنۈمى ئادەتتىكىدەك · سۈرئىتى ئەڭ تېز · ئىنتايىن ئەرزان · (ھەقسىز)
gemini-3.1-pro-preview — ئۈنۈمى ناھايىتى سۈپەتلىك · سۈرئىتى ئاستا · (پۇللۇق · سېتىۋېلىشىڭىز كېرەك)
```

Rules:
- **Do not carry over `gemini-3.5-flash` or `gemini-3.1-flash-lite`** from the desktop's
  `SELECTABLE_MODELS`. They are replaced by the two above.
- The **(ھەقسىز)** / **(پۇللۇق)** marker must be visible both in the closed picker and in
  the open list — a reader must never discover a model is paid only by hitting an error.
- **All three must work properly on their own terms.** Some readers will paste a free
  key, others a key with billing enabled. Neither is a second-class case.
- If a reader whose key has no billing selects `gemini-3.1-pro-preview`, the failure must
  be a specific Uyghur message naming the model and explaining that it needs a paid key,
  with a link to Google's billing page — **never a generic error, and never a silent
  switch to a cheaper model.** Automatic key failover must also not disguise this: if
  every configured key lacks billing, say so plainly rather than cycling silently.
- **The selected model is used exactly as chosen.** This is inherited from the desktop
  and is not negotiable.
- Model IDs move. **Re-verify the live list against Google's models endpoint at
  implementation time**; if any of the three IDs no longer resolves, tell me in the report
  rather than guessing or substituting.
- Prices change too. Do not hardcode price numbers into the UI beyond the free/paid
  badge — link to Google's pricing page for the figures.

## 2.3 Usage
- Show the reader their own usage for today: requests, and input/output tokens when the
  API returns them. Stored in their browser, like everything else here.
- Google's free-tier limits are per key and change over time. **Do not hardcode a quota
  number you have not verified.** Show what the API actually reports, and when a quota
  error comes back, translate it into a clear Uyghur explanation with the reset
  expectation Google states.

---

# STEP 3 — The transport layer

One well-tested module under `lib/ai/`, used by PROMPTs 18 and 19. Port the logic from
the desktop's `ai.js` and `src/ai-client.js` — the prompts and behaviour are already
proven there; do not redesign them.

Required:
- **Streaming.** Text appears as it arrives. Match the desktop's callback contract
  (`onChunk` / `onDone` / `onError`, returning an `abort`) so the ported feature code
  fits without rewriting — see `preload.js` `AIBridge.askStream`.
- **Cancel.** A running request can always be stopped, and cancelling leaves no
  half-rendered answer and no dangling listener.
- **Timeout.** The desktop uses a 60-second watchdog because `fetch` has none. Do the
  same.
- **Retry and backoff** for transient errors, and **automatic failover across all four
  key slots** on 429 and on 503/5xx — the v3.1.0 desktop release specifically extended
  failover to 5xx "model is overloaded" errors. Failover is silent to the reader, walks
  the slots in order, and changes the *key*, **never the *model***. If the stream had
  already started emitting text when the failure hit, restart cleanly on the next key
  rather than splicing two answers together.
- **Errors the reader can act on**, in Uyghur: no key, bad key, quota exhausted, model
  unavailable, network down, request too large, blocked by safety settings. Never show a
  raw English API error.
- **Nothing is logged anywhere.** No key, no prompt, no response, on the client or on the
  server. If you add the fallback proxy from Step 0.2, prove with a test that it logs
  neither.
- Works with the PWA from PROMPT 14: with the network off, AI fails with a clear Uyghur
  message and never blocks reading. No AI request is ever cached.

---

# STEP 4 — One end-to-end proof, and nothing more

To prove the foundation works, add exactly one minimal use: a small "ask" box on
`/my/ai` that sends a question and streams the answer back. It exists to demonstrate the
plumbing.

**Do not build the reader AI panel or the notebook AI in this prompt.** They are
PROMPT 18 and PROMPT 19, and building them here will make this too large to review.

---

# Tests and reporting (mandatory)

- `npm run typecheck && npm run lint && npm run build` all pass.
- Existing unit and Playwright suites stay green at **375×667, 390×844 and 1280×800**.
- New Playwright coverage at all three viewports, against a **mocked** Gemini endpoint
  (never spend the owner's or my real quota in CI):
  - a signed-out visitor can read, search and use the whole site with no sign of AI;
  - a signed-in reader with no key sees AI off and is not nagged;
  - the privacy warning is visible before the key field and enabling requires an explicit
    action;
  - saving a key, testing the connection, streaming an answer, and cancelling mid-stream
    all work and leave no partial UI;
  - **all four key slots** save, test individually, and report their own status;
  - a 429 on slot 1 fails over automatically to slot 2, then 3, then 4, **without
    changing the model** and without the reader doing anything; only when all four fail
    does an error appear;
  - a 503/5xx also triggers failover, not just a 429;
  - the last working slot is remembered and tried first on the next request;
  - each of the three models can be selected and used successfully with a suitable key;
  - selecting `gemini-3.1-pro-preview` with a key that has no billing produces the
    specific Uyghur "this model needs a paid key" message — not a generic error, and the
    model is never silently changed;
  - the (ھەقسىز) / (پۇللۇق) badges render correctly in the closed picker and the open
    list at 375 px without overflow;
  - "remove everything" clears all four keys and all AI state from the browser.
- A unit test asserting the key never appears in any request to our own origin and never
  in any storage other than the intended browser store.
- Verify by hand, and report, that the key does not appear in: the network tab against
  our origin, Vercel logs, or the Supabase database.
- Final report in **simple Uyghur**: whether the browser-direct transport worked or the
  fallback proxy was needed, exactly what Google's current terms say about free-tier data
  use, which models are actually available today, and a numbered step-by-step guide for
  how *I* get a free Gemini key from Google AI Studio and enter it — with exact button
  names.

# Acceptance criteria
- The owner pays nothing: no server-side key, no `GEMINI_API_KEY`, no new vendor account,
  and (unless the fallback proxy was required) no new server function on the request path.
- A reader's key exists only in their own browser and can be erased completely.
- Nobody can enable AI without first seeing an honest Uyghur explanation of what Google
  does with free-tier data.
- Exactly three models are offered — `gemini-3.7-flash`, `gemini-3.5-flash-lite`,
  `gemini-3.1-pro-preview` — each clearly marked (ھەقسىز) or (پۇللۇق), and each works
  correctly with an appropriate key.
- Four key slots, with automatic failover down the list on quota and overload errors,
  requiring nothing from the reader.
- The selected model is always the model used; failover changes keys, never models.
- Streaming, cancelling and every error path behave correctly on a 375 px phone.
- `CLAUDE.md` now describes the browser-only design, so the next session cannot rebuild
  the server-key version by accident.
- Nothing from Phases 1–16 regressed; the CSP gained exactly one host in `connect-src`
  and nothing else.

Commit per logical step with English conventional messages. **If the browser-direct
transport turns out not to work, or if any part of this would put a cost on the owner or
require storing another person's secret, stop and explain the trade-off to me in Uyghur
rather than choosing silently.**
