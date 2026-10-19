# PROMPT 42B — 1-باسقۇچنىڭ قالدۇقى: ئايرىم قىسقۇچتىكى ئوڭشاشنى ئاساسىي قىسقۇچقا قوشۇش

**قانداق ئىشلىتىسىز:** `PROMPT-42.md` تاماملىنىپ سايتقا چىققاندىن كېيىن (ھازىر شۇنداق: `31f76d6` …
`b3d483c`)، `PROMPT-43.md` غا ئۆتۈشتىن **بۇرۇن** مۇشۇنى ئىشلىتىڭ. Claude Code نى
`BilimHezinisi-website` قىسقۇچىدا **يېڭى تۈر** قىلىپ ئېچىڭ، «---» دىن كېيىنكى پۈتۈن ئىنگلىزچە
قىسمىنى چاپلاڭ. باشقا ھېچقانداق Claude Code تۈرى ئىشلىمەيۋاتقان بولسۇن.

> **بۇ نېمە ئىش:** 1-باسقۇچ ئىشلەۋاتقاندا، Claude Code مۇناسىۋەتسىز يەنە بىر خاتالىق تاپقان:
> ساندان خاتىرىلەرنى ئوقۇيالمىسا، «خاتىرە دەپتىرىم» بېتى «تېخى خاتىرە يوق» دەيدۇ — ئادەم
> خاتىرىلىرىم يوقاپتۇ دەپ ئويلاپ قالىدۇ. سىز «Start with worktree» نى بېسىپ، ئۇنى ئايرىم بىر
> كۆپەيتىلمە قىسقۇچتا ئوڭشىتىپ بولدىڭىز (`256fbd4`). ئوڭشاش **توغرا**، لېكىن تېخى ئاساسىي
> قىسقۇچقا قوشۇلمىغان، شۇڭا سايتتا ئىشلىمەيدۇ. بۇ بۇيرۇق ئۇنى قوشۇپ، سايتقا چىقىرىپ، ئايرىم
> قىسقۇچنى تازىلايدۇ. يەنە كىچىك بىر ئىش: ئايرىم قىسقۇچ ئىشلىتىلسە `npm run lint` ۋە بىر سىناقنىڭ
> بۇزۇلۇشىنى توسىدۇ — شۇنىڭ بىلەن كېيىن يەنە شۇنداق بولسا مەسىلە چىقمايدۇ.
>
> **تۈگىگەندىن كېيىن سىناڭ:** ھېساباتىڭىزغا كىرىپ «خاتىرە دەپتىرىم» نى ئېچىڭ — خاتىرىلىرىڭىز
> كۆرۈنۈشى كېرەك (ھېچنېمە ئۆزگەرمىگەندەك كۆرۈنىدۇ، بۇ توغرا: ئوڭشاش پەقەت ساندان جاۋاب
> بەرمىگەندە كۆرۈنىدۇ).

---

You are continuing an existing, live project. Read `CLAUDE.md` in this folder FIRST — it is the
project instruction and always wins — and use the **bilim-web** skill.

This is the **tail of stage 1** of the notebook plan (`PROMPT-42.md` … `PROMPT-50.md`, from
`AUDIT-2026-10-07.md`). It merges a finished fix that is sitting on a side branch, and hardens the
repo against the side effect that branch's worktree caused. **Do only this.** Do not start
`PROMPT-43.md`.

## Before you start

1. `git status`, `git log --oneline -8`, `git worktree list`. Expected: `main` is at `b3d483c`
   («test(notes): run the notebook in Firefox and WebKit») and equal to `origin/main`; the branch
   `claude/recursing-shannon-b4be2b` is at `256fbd4` with a worktree under
   `.claude/worktrees/recursing-shannon-b4be2b`. If `main` differs from `origin/main`, or the
   working tree holds changes you did not make, **stop and ask the owner in Uyghur**.
   Untracked planning files in the root (`PROMPT-*.md`, `AUDIT-*.md`, `HANDOFF-*.md` and the like)
   are the owner's and expected: leave them where they are and do not commit them.
2. Make sure no other Claude Code session is running tests. Two Playwright runs at once share ports
   and delete each other's `bh-e2e-` test accounts; that is what made earlier runs flaky.
3. Read `git show 256fbd4` in full, plus `lib/notes/data.ts`, `app/notes/error.tsx`, `lib/cache.ts`
   (`throwIfUnavailable`), `lib/supabase/timeouts.ts` and `playwright.config.ts` as they are on
   `main` now.

## What is on the branch (already reviewed — keep it as it is)

`256fbd4` «fix(notes): show the notebook error page when notes cannot be read»:

- `listNotes` and `getNote` pass the read's `error` through `throwIfUnavailable` (the PROMPT-40
  rule: a loader whose read failed throws, so `app/notes/error.tsx` shows the Uyghur error page
  with a retry — never an empty answer that looks real).
- `ownerClient` separates "Auth answered: nobody is signed in" (stays `null`, so the pages still
  redirect to `/login`) from "Auth did not answer" (network failure, timeout, 5xx, 429, or past
  `SESSION_DEADLINE_MS`), which now throws too. As `null` it also turned the writer's own note into
  a 404.
- `app/notes/error.tsx` uses `retry()` instead of `reset()`; `reset` only re-renders what the
  server already sent. (`retry` is stable in Next 16.3 and is what `app/error.tsx` already uses.)
- New Playwright projects `notes-unavailable-*` against the fake Supabase on :3300, plus
  `tests/unit/notes-data.test.ts` and `answerTable` in `tests/fixtures/supabase-mock.ts`.

Do not redesign any of it. If you believe something in it is wrong, **stop and ask the owner in
Uyghur** before changing it.

## Non-negotiable constraints (restated from `CLAUDE.md`; they win over anything here)

- **No budget, ever.** Supabase Free + Vercel Hobby; no paid service, no new vendor, no runtime CDN.
- **Anonymous reading always works.** RTL Uyghur UI; code, comments and commits in English.
- Mobile Rules are hard; a note is private (invented text in tests, nothing real in logs or
  commits); RLS on every table; never edit an applied migration; do not weaken the CSP.
- **Never load-test production.** Do not create more than a handful of notes against the real
  project.
- The two `test.fixme` lines stage 1 left — `tests/notes-ai.spec.ts:258` (Firefox) and
  `tests/notes-sources.spec.ts:86` (WebKit), both labelled N2 — **stay as they are**.
  `PROMPT-43.md` removes them. Do not try to fix that save race here.

## What to do

### A. Merge the branch into `main`

Merge `claude/recursing-shannon-b4be2b` into `main`, keeping its commit message.

`playwright.config.ts` is the one file both sides changed and will probably conflict: stage 1 added
the Firefox and WebKit notebook projects, the branch added the `notes-unavailable-*` projects.
**Keep both**, in a sensible order, with both comment blocks intact. Nothing else should conflict
(the branch touched `app/notes/error.tsx`, `docs/search-flood.md`, `lib/notes/data.ts`,
`playwright.config.ts`, `tests/fixtures/supabase-mock.ts`, `tests/notes-unavailable.spec.ts`,
`tests/unit/notes-data.test.ts`; stage 1 touched the spellchecker, the notebook specs and
`playwright.config.ts`). If anything else conflicts, read both sides fully before resolving, and
say in your report what you chose and why.

### B. Keep a worktree from breaking lint and the unit tests

A worktree created under `.claude/worktrees/` is a second copy of the repo **inside** the repo, and
nothing excludes it:

- `eslint.config.mjs`'s `globalIgnores` has no `.claude/**`, so `npm run lint` lints that copy and
  its build output;
- `tests/unit/ai-contract.test.ts`'s `skip` set has no `.claude` (nor `.next-mock` / `.next-flood`),
  so its source walk reads that copy's files; `tests/unit/feature-removal.test.ts` and
  `tests/unit/test-account-hygiene.test.ts` skip only `node_modules` and `.auth`.

Add `.claude/**` to the eslint `globalIgnores` (with a one-line comment saying why), add `.claude`
to those unit tests' skipped directories, and while you are in `ai-contract.test.ts` add the
`.next-mock` and `.next-flood` build outputs its `skip` set is missing. Check whether any other
source-walking test under `tests/unit/` has the same gap and fix it the same way. Change nothing
about what those tests actually assert.

This is a small, separate commit from the merge.

### C. Check, push, clean up

1. `npm run typecheck`, `npm run lint`, `npm run build`, `npm run test:unit`.
2. Playwright: the `notes-*` projects (which include `notes-unavailable-*` and the Firefox/WebKit
   notebook projects). Everything must pass except the two parked `fixme` tests. If something else
   fails, re-run that spec alone before reporting it, and say whether it fails on `main` without
   this merge too.
3. Push `main`. After Vercel reports the deployment, open `https://bilimhezinisi.com/notes` — signed
   out is enough: it must redirect to `/login`, not show an error.
4. Remove the worktree with `git worktree remove` (it is at
   `.claude/worktrees/recursing-shannon-b4be2b`; use `--force` only if it refuses because of
   generated files, never with uncommitted source changes in it) and delete the merged local branch
   `claude/recursing-shannon-b4be2b`. Confirm with `git worktree list` and `git branch` that both
   are gone, and that `.claude/worktrees/` is empty or absent.

## Acceptance criteria

1. `main` contains `256fbd4`'s change; `lib/notes/data.ts` passes read errors to
   `throwIfUnavailable`, and `app/notes/error.tsx` uses `retry()`.
2. `playwright.config.ts` holds both sets of projects, and `npx playwright test --list` shows the
   Firefox, WebKit and `notes-unavailable-*` notebook projects together.
3. `npm run lint` and `npm run test:unit` pass with a worktree present under `.claude/worktrees/`
   (prove it: create a throwaway worktree there, run both, then remove it) and after it is gone.
4. The two parked `fixme` tests are untouched.
5. typecheck, lint, build, unit and the `notes-*` Playwright projects green; `main` pushed and
   deployed; the worktree and the branch removed.

Commit per logical step with English conventional messages (the merge keeps its own message; the
hardening as something like `test(repo): keep a worktree out of lint and the source walks`). Finish
with a short report **in simple Uyghur** for the owner: what was merged, what the conflict was and
how you resolved it, the test result, and that the side copy is now cleaned up.

If anything here conflicts with `CLAUDE.md`, or you would have to trade away correctness, privacy,
mobile quality or the free-tier limits to finish it, **stop and ask the owner in Uyghur** — never
make that trade silently.
