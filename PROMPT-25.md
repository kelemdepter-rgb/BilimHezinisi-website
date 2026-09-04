# PROMPT 25 — سۈنئىي ئىدراك بېتىدىكى ئۈچ ئۇزۇن ئۇقتۇرۇشنى ئۆچۈرۈش

## قانداق ئىشلىتىسىز (يېڭى تۈر ئېچىپ)
1. Claude Code نى ئېچىپ **BilimHezinisi-website** قىسقۇچىنى تاللاڭ.
2. سىزىقتىن تۆۋەنكى تېكىستنى پۈتۈنلەي كۆچۈرۈپ چاپلاڭ.

> **بۇ ئۆچۈرۈش خىزمىتى.** ئۈچ ئۇزۇن يېزىق بۆلىكى ئېلىۋېتىلىدۇ. سۈنئىي ئىدراكنىڭ
> ئىشلەش ئۇسۇلىغا، ئاچقۇچ ساقلاشقا، ياكى باشقا ھېچقايسى ئىقتىدارغا **قول تەگمەيدۇ**.
>
> **دىققەت:** بۇ ئۆزگىرىش `CLAUDE.md` دىكى بىر قائىدىگە قارشى كېلىدۇ، شۇڭا شۇ قائىدىمۇ
> بىللە يېڭىلىنىدۇ — بولمىسا كېيىنكى بىر Claude Code سۆزلىشىشى ئۇنى «خاتالىق» دەپ
> قاراپ قايتا قوشۇپ قويىدۇ.

---

You are continuing an existing, live project. Read `CLAUDE.md` in this folder FIRST, and
use the **bilim-web** skill.

## What this task is

Remove three long explanatory blocks from the AI settings page (`/my/ai`). The owner
finds the page too wordy and has decided, explicitly and after being shown the trade-off,
that all three should go.

**This is a deletion task. Delete exactly these three blocks and nothing else.** Do not
refactor, do not restyle, do not "improve" anything nearby.

## Project context

Next.js 16 (App Router) + TypeScript + Tailwind on Vercel Hobby, Supabase Free. Live at
`https://bilimhezinisi.com`. The AI layer is bring-your-own-key and browser-only: each
signed-in reader supplies their own Gemini key, it stays in their browser, and the
request goes straight from their browser to Google. **None of that changes here.**

---

# The three blocks

## ① `components/my/ai-settings.tsx` — the whole privacy notice section

The `<section>` with `data-testid="ai-privacy-notice"`, headed
«ئېچىشتىن بۇرۇن بۇنى بىلىۋېلىڭ». Roughly lines 57–100.

Remove the entire `<section>`, including:
- its `<h2>` and the shield `<Icon>`,
- the whole `<ul>` of five `<li>` items,
- the `<a data-testid="ai-terms-link">` link to Google's terms that sits inside it.

## ② `components/my/ai-keys.tsx` — the browser-storage honesty note

The paragraph that begins «راستىنى ئېيتقاندا:» and ends
«…ئاچقۇچ ساقلاشقا مۇۋاپىق ئورۇن ئەمەس.» — around line 129.

Remove the whole containing element (the paragraph or box it sits in), not just the
sentence, so no empty wrapper or stray spacing is left behind.

## ③ `components/my/ai-settings.tsx` — the usage-counter caveat

The paragraph immediately above the usage counters, around lines 190–197, containing
«…شۇڭا بىز ئويدۇرما بىر ساننى كۆرسەتمەيمىز؛ ھەققىڭىز توشسا…».

Remove that paragraph. **Keep the counters themselves** — the `<dl data-testid="ai-usage">`
grid and everything inside it stays exactly as it is.

---

# ⚠️ Do NOT remove this — it looks similar and is a different thing

`components/my/ai-settings.tsx` around **line 236** contains another sentence with the
words «ئورتاق ئىشلىتىلىدىغان». It belongs to the **erase / clear-data** section
(`data-testid="ai-erased"` / `ai-erase`), and it explains what the erase button does.

**It is not one of the three. Leave it exactly as it is.** Read the surrounding lines
before deleting anything, and confirm in your report that this sentence is untouched.

---

# Clean up what the deletions orphan

Deleting these blocks will leave unused code that `lint` will reject. Fix it properly,
do not silence it:

- The `URL_TERMS` constant becomes unused if nothing else references it. Check first —
  if another component still uses it, keep it; if not, remove it.
- Any icon import (`shield`, `link`) that is now unused in that file.
- Any import that only existed for the removed markup.
- Check the surrounding layout: if a removed block was the only child of a wrapper, or if
  `mt-*` / `space-y-*` spacing now leaves an obvious gap or a doubled margin, tidy the
  spacing so the page still looks deliberate. **Spacing only — no restyling.**

---

# Existing tests will break — fix them, do not skip them

There are Playwright and/or unit tests asserting `ai-privacy-notice` and `ai-terms-link`,
and possibly the removed sentences. Find every one of them:

```
grep -rn "ai-privacy-notice\|ai-terms-link" tests/
```

For each: if it existed only to assert the removed content, delete that assertion or that
test. **Never `test.skip()` it and never comment it out** — a skipped test is a lie that
looks green. If a test covers both removed and kept behaviour, keep the part that still
applies.

---

# `CLAUDE.md` must be updated in the same commit — this is not optional

`CLAUDE.md` currently states, under the AI Layer section:

> "Before a reader can enable AI they are shown, in Uyghur, what Google does with
> free-tier data. That notice is not optional and is not behind a link."

After this change that sentence is false, and `CLAUDE.md` always wins — so a future
session reading it would treat the missing notice as a regression and put it back.

Replace that sentence with a dated record of the decision, in the same factual tone as
the rest of the file. State plainly: on **2026-08-31** the owner decided the on-page
notices were too long for readers and had them removed; the AI layer is still
bring-your-own-key and browser-only; a reader obtains their own key from Google and
accepts Google's terms there. Do not editorialise and do not argue the case either way —
just record what was decided and when, so the next session is not confused.

---

# Constraints that do not move

- **Change nothing about how the AI works.** No change to `lib/ai/` — not the transport,
  the four key slots, the failover, the model list, the strict model selection, the
  `finishReason` handling, or the prompts. No `temperature`, no `thinkingLevel`.
- **Do not weaken the CSP.** `lib/security/csp.ts` must still name
  `generativelanguage.googleapis.com` exactly once, in `connect-src`, and nothing else
  may be added or removed.
- **Do not touch** RLS, role checks, `supabase/migrations/`, `proxy.ts`,
  `lib/legacy-host.ts`, `lib/seo.ts`, `public/sw.js` or `lib/pwa/constants.ts`.
- The key still never reaches the server and is never logged. Nothing in this task
  changes where a key lives.
- **No budget.** Supabase Free, Vercel Hobby.
- RTL Uyghur UI; code, comments and commit messages in English.
- Do not run `git add -A` / `git add .` / `git commit -a`. Stage only what you changed.
  **`git push` deploys to the live library — ask the owner first.**
- Do not fix anything in `FINDINGS-2026-08-29.md`. Those get their own prompt.

---

# Tests

- `npm run typecheck && npm run lint && npm run build` — green. Lint must pass **without**
  any new `eslint-disable`.
- Every existing unit and Playwright suite green at **375×667, 390×844 and 1280×800**.
  These are known flaky or pre-existing failures — report them and move on, do not chase
  them: `keyboard.spec.ts:151`, `ai.spec.ts:148`, `ai.spec.ts:261`,
  `offline.spec.ts:181`, `reader-ai.spec.ts:534`.
- Confirm at all three viewports that `/my/ai` still: renders, lets a signed-in reader
  turn AI on and off, accepts and saves a key, shows the model picker, and shows the
  usage counters. **No horizontal overflow at 360 px**, and every control still visible
  and tappable after scrolling down and back up.

---

# Acceptance criteria

1. The three blocks are gone from `/my/ai`.
2. The erase-section sentence at old line ~236 is still there, word for word.
3. The usage counters still render and still count.
4. Enabling AI, saving a key, choosing a model and asking a question all still work.
5. No unused import, constant or wrapper is left behind; lint is clean with no new
   disables.
6. No test was skipped or commented out to make the suite pass.
7. `CLAUDE.md` records the decision with its date.
8. `lib/ai/`, the CSP, RLS and the domain-migration files are byte-identical to before.

Commit as one logical change with an English conventional message. Report in simple
Uyghur: what you removed, what you deliberately kept, which tests you changed and why,
and the results viewport by viewport.

**If removing one of these blocks would break a feature, or if you find that one of them
is load-bearing in a way this prompt did not anticipate, stop and explain it to the owner
in Uyghur rather than working around it.**
