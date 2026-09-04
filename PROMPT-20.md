# PROMPT 20 — AI جاۋابىنىڭ سۈپىتىنى ئوڭشاش (temperature ۋە thinkingLevel مەسىلىسى)

## قانداق ئىشلىتىسىز (يېڭى تۈر ئېچىپ)
1. Claude Code نى ئېچىپ **BilimHezinisi-website** قىسقۇچىنى تاللاڭ، ھەمدە دېسكتوپ دېتال
   قىسقۇچىنىمۇ قوشۇپ تاللاڭ (`bilim hezinisi pc`) — پەقەت ئوقۇش ئۈچۈن پايدىلىنىش مەنبەسى.
2. سىزىقتىن تۆۋەنكى تېكىستنى پۈتۈنلەي كۆچۈرۈپ چاپلاڭ.

> **مەسىلە:** `gemini-3.5-flash-lite` نىڭ ئۇيغۇرچە جاۋابى سايتتا ناچار — جۈملىلەر
> باغلاشمايدۇ. ئەمما Google نىڭ ئۆز تور بېتىدە **ئوخشاش مودېل** ياخشى ئىشلەيدۇ.
> **مودېل ئالماشتۇرۇلمىغان** — كود توغرا مودېلنى چاقىرىدۇ. سەۋەب: بىز ئەۋەتىۋاتقان
> `generationConfig` Google نىڭ Gemini 3 ئۈچۈن يازغان كۆرسەتمىسىگە زىت.

---

You are continuing an existing, live project. Read `CLAUDE.md` in this folder FIRST —
it is the project instruction and always wins — and use the **bilim-web** skill.

## Project context
`https://bilim-hezinisi-website.vercel.app` — a free public Uyghur digital library.
Next.js App Router + TypeScript + Tailwind on **Vercel Hobby**, Supabase Free. Phases
1–19 are complete and deployed, including the AI layer: `lib/ai/` (browser-only keys,
four slots with automatic failover, strict model selection, SSE streaming), the reader AI
panel and the notebook AI panel.

## Non-negotiable constraints (unchanged)
- **The owner pays nothing.** The reader's own Gemini key, in the reader's own browser,
  going straight to Google. No server-side key, no `GEMINI_API_KEY`, no new vendor
  account, no second transport path.
- **Nothing about AI is logged or stored server-side** — not the key, not a prompt, not a
  response.
- **Strict model selection.** The model the reader picks is the model that is called.
  Failover changes the key, never the model.
- Anonymous browsing, reading and search keep working with no account and no AI.
- RTL Uyghur UI; code, comments and commit messages in English.
- All Mobile Rules in `CLAUDE.md` apply. Do not weaken the CSP.

---

# The diagnosis — verify each point before changing anything

The owner reports that answers from `gemini-3.5-flash-lite` are poor Uyghur: disjointed,
sentences that do not follow one another. The same model in Google AI Studio produces
noticeably better Uyghur. Two findings, in order of certainty.

## Finding 0 — the model is NOT being substituted (confirm, then move on)

`lib/ai/storage.ts` `readModel()` validates the stored value against `SELECTABLE_MODELS`
and falls back to `DEFAULT_MODEL` (`gemini-3.7-flash`) only when it is invalid — a
fallback that would give a *better* model, not a worse one. `lib/ai/client.ts`
`endpoint()` puts that exact ID in the URL, and failover only iterates keys. Confirm this
reading yourself, then stop looking here — the problem is elsewhere.

## Finding 1 — we send a temperature Google explicitly tells us not to send

Google's **Gemini 3 developer guide** states:

> "For all Gemini 3 models, we strongly recommend keeping the temperature parameter at
> its default value of `1.0`."

and

> "Changing the temperature (setting it below 1.0) may lead to unexpected behavior, such
> as looping or degraded performance, particularly in complex mathematical or reasoning
> tasks."

All three models we offer are Gemini 3 family. Every path in this codebase sends a
temperature **below** 1.0:

| Where | Value |
|---|---|
| `lib/ai/client.ts` → `buildBody` default | `0.4` |
| `lib/ai/client.ts` → `chatStream` | `0.7` |
| `lib/ai/client.ts` → `probeKey` | `0.2` |
| `components/notes/ai-panel.tsx` → translate | `0.3` |
| `components/notes/ai-panel.tsx` → proofread | `0.2` |

`buildBody` also sends `topP: 0.9`, below Google's default.

Narrow sampling hurts a low-resource language hardest: the model is less confident in
Uyghur to begin with, and clamping it to the safest tokens is what produces text that
looks locally plausible and does not hold together across sentences. The smallest model
we offer, `gemini-3.5-flash-lite`, has the least margin and therefore suffers most —
exactly what the owner observed.

**Google AI Studio uses the defaults. That is the whole difference.**

## Finding 2 — we run the model at low reasoning

`lib/ai/client.ts` `thinkingConfigFor()` returns `{ thinkingLevel: "low" }` for every
normal request and `"high"` only when «چوڭقۇر مۇلاھىزە» is ticked.

Google's Gemini 3 guide states that `thinking_level` accepts `minimal`, `low`, `medium`
and `high`, and that **when the field is omitted Gemini 3 defaults to `high`** (with
per-model exceptions — Gemini 3.1 Flash-Lite is documented as defaulting to `minimal`).

So AI Studio ran the model at its default level and the site runs it at `low`. On top of
the temperature problem, this is the second half of the quality gap.

## Finding 3 — a truncated answer is presented as a finished one

In `askStream`, when the stream ends with text, `onDone` is called without ever looking at
`result.stopReason`. `emptyAnswerMessage()` in `lib/ai/errors.ts` does handle `MAX_TOKENS`
— but it is only reached when the answer is **completely empty**. An answer that ran to
the `maxOutputTokens` ceiling and stopped mid-sentence is delivered as if complete, with
no warning.

The default ceiling is `4096`, and the file's own comment notes that thinking tokens are
drawn from the same budget. Uyghur in Arabic script is token-expensive, so this ceiling is
reached sooner than it looks. **"Sentences that do not connect" is also what a silently
truncated answer looks like**, so this must be fixed regardless of Findings 1 and 2.

---

# The fix

## Task A — stop overriding Gemini 3's sampling defaults

1. **Remove `temperature` and `topP` from `buildBody` entirely.** Do not send either
   field. Google's default is what AI Studio uses and what the guide tells us to keep.
2. Remove the `temperature` overrides at **all five** call sites listed above.
3. Keep the `temperature` field on `AskOptions` only if something still genuinely needs
   it — and if you keep it, **clamp it so nothing can go below 1.0**, with a comment
   naming the guidance. If nothing needs it, delete the option and simplify the callers.
4. **Do not compensate by making prompts more rigid.** If proofreading or translation
   needs determinism, it comes from the instruction text, not from the sampler. The
   prompts are ports of the desktop's and are not to be rewritten in this task.
5. Re-read Google's Gemini 3 guide yourself at implementation time and quote the current
   wording in your report. If the guidance has changed, follow the current version and
   tell the owner.

## Task B — let each model think at its own default

1. **Omit `thinkingLevel` entirely for a normal request** so each model applies its own
   default, exactly as AI Studio does.
2. «چوڭقۇر مۇلاھىزە» sends `thinkingLevel: "high"` explicitly.
3. **The toggle must do something real.** Check each of the three models' documented
   default level. For a model whose default is already `high`, the toggle changes nothing
   — in that case either hide it for that model or relabel it honestly. **Do not ship a
   control that pretends to do something it does not.** Say in the report what you found
   per model and what you did.
4. Keep the existing knowledge that `thinkingBudget: 0` is rejected by two of these
   models — do not reintroduce it.

## Task C — never present a cut-off answer as complete

1. Capture `finishReason` for the whole stream (`readSseStream` already returns
   `stopReason`) and act on it in `askStream` **even when text was produced**.
2. On `MAX_TOKENS` with a non-empty answer, deliver the text **and** mark it truncated.
   The panel shows a clear Uyghur notice — the answer was cut short, not finished —
   visually distinct from the answer itself.
3. Offer a **«داۋاملاشتۇرۇش»** action that continues from where it stopped, sending the
   text so far as prior context. If you judge that unreliable, say so and instead offer
   «قىسقىراق سوراش» with a clear explanation. Do not leave the reader with a dead end.
4. Handle `SAFETY`, `RECITATION` and any other non-`STOP` reason the same way: if the
   answer is incomplete, the reader is told.
5. **Raise `maxOutputTokens`.** The current 4096 is shared with thinking tokens, and
   thinking is about to go up as a result of Task B. Check the actual output limit of each
   of the three models and pick a ceiling with real headroom; keep the notebook's larger
   `LONG_OUTPUT_TOKENS` proportionally larger. Report the numbers you found and chose.

## Task D — make "which model answered" provable, not just documented

Gemini's response carries a **`modelVersion`** field. `GeminiResponse` in
`lib/ai/client.ts` does not declare it and the code discards it.

1. Add `modelVersion` to the response type and capture it from the stream and from
   `generateOnce`.
2. Pass it through `onDone` and show it, small and unobtrusive, under a finished answer:
   the reader can always see which model actually replied.
3. If `modelVersion` does not match the model that was requested, that is a real problem
   the owner needs to know about — surface it plainly rather than hiding it.
4. Add a unit test asserting the requested model ID appears in the request URL and that a
   mismatched `modelVersion` in a mocked response is surfaced, not swallowed.

## Task E — a real check against a real key, done once, written down

Claude Code's own closing report to the owner said it plainly: every AI test in this
project runs against a fake Google, so the plumbing is proven and the answers are not.
This task exists because of that gap. CI must still never spend anyone's quota — so
instead:

1. Write `docs/ai-manual-check.md`: a short, numbered checklist **in Uyghur** the owner
   runs by hand with a real key after any change to `lib/ai/`. It must cover, for **each
   of the three models** separately:
   - a Uyghur → Arabic translation (the output must be in Arabic, not Uyghur);
   - a summary of a long book passage (must be coherent Uyghur and must not stop
     mid-sentence);
   - proofreading a note containing a Qur'an verse (the verse comes back untouched and
     the panel says a quoted block was skipped);
   - applying a correction and undoing it (the document returns exactly as it was);
   - the `modelVersion` shown under the answer matches the model that was picked.
2. Each step says what a **good** result looks like, so the owner can judge it without
   guessing.
3. Keep every existing mocked test green. Add mocked tests proving the new behaviour:
   no `temperature` or `topP` in the request body; no `thinkingLevel` unless deep
   reasoning is on; `MAX_TOKENS` with text produces a truncation notice.

---

# Tests and reporting (mandatory)

- `npm run typecheck && npm run lint && npm run build` all pass.
- Every existing unit and Playwright suite stays green at **375×667, 390×844 and
  1280×800**.
- New tests, all against a **mocked** Google:
  - the request body contains **no** `temperature` and **no** `topP` on any path —
    reader panel, notebook chat, translate, proofread, and the key probe;
  - `thinkingLevel` is absent on a normal request and `"high"` when deep reasoning is on;
  - a stream that ends with `finishReason: "MAX_TOKENS"` and text produces the answer
    **plus** a truncation notice, and the continue (or shorten) action is offered;
  - the requested model ID appears in the request URL for all three models;
  - a response whose `modelVersion` disagrees with the requested model is surfaced.
- Final report in **simple Uyghur**, answering the owner's question directly:
  1. was a different or lower model ever being called — yes or no, with the evidence;
  2. what actually caused the poor Uyghur, in plain words;
  3. what changed;
  4. the current Google wording you verified for temperature and `thinking_level`;
  5. per model, what its default thinking level is and what the deep-reasoning toggle now
     does;
  6. the new output-token ceilings and why;
  7. the numbered manual check the owner should now run, and what a good result looks
     like.

# Acceptance criteria
- No request from this site sets `temperature` or `topP`; Gemini 3's own defaults apply,
  the same defaults AI Studio uses.
- A normal request omits `thinkingLevel`; the deep-reasoning toggle either changes the
  level for real or is not shown.
- A truncated answer is never presented as a finished one, and the reader always has a way
  forward.
- The model that answered is visible under every answer, and a mismatch is reported.
- `docs/ai-manual-check.md` exists, in Uyghur, and is short enough that the owner will
  actually run it.
- Strict model selection, browser-only keys, four-slot failover, the no-logging rule and
  everything from Phases 1–19 are unchanged.
- No paid service, no new vendor account, no second transport path, no weakened CSP.

Commit per logical step with English conventional messages. **If removing the temperature
overrides makes any behaviour worse rather than better, stop and tell the owner in Uyghur
what you saw before changing the prompts to compensate — the prompts are a proven port
from the desktop and are not the suspect here.**
