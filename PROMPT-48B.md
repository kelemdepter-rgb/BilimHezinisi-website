# PROMPT 48B — 7-باسقۇچنىڭ قالدۇقى: ئىشنى سايتقا چىقىرىش ۋە قىسقۇچنى ئەسلىگە كەلتۈرۈش

**قانداق ئىشلىتىسىز:** Claude Code نى `BilimHezinisi-website` قىسقۇچىدا **يېڭى تۈر** قىلىپ ئېچىڭ،
«---» دىن كېيىنكى پۈتۈن ئىنگلىزچە قىسمىنى چاپلاڭ. باشقا ھېچقانداق Claude Code تۈرى
ئىشلىمەيۋاتقان بولسۇن. بۇ تۈگىمىگۈچە `PROMPT-49.md` نى **باشلىماڭ**.

> **بۇ نېمە ئىش:** 14-ئۆكتەبىردە `PROMPT-48.md` ئىشىنى تولۇق تۈگەتكەن — ئىملا قۇلايلىقى ۋە
> شەخسىي لۇغەت يېزىلىپ، سىناقتىن ئۆتۈپ، 6 قېتىم ساقلانغان. ئەمما ئەڭ ئاخىرىدا ئۇ بىر مەغلۇب
> سىناقنىڭ سەۋەبىنى تەكشۈرۈش ئۈچۈن قىسقۇچنى **كونا نۇسخىغا** ئۆتكۈزگەن، ئاندىن ئەسلىگە
> قايتۇرماي توختاپ قالغان. شۇڭا: (1) ئىش **تېخى سايتقا چىقمىغان**؛ (2) قىسقۇچ ئۈچ كۈندىن بېرى
> كونا نۇسخىدا تۇرۇۋاتىدۇ. **ھېچنېمە يوقالمىغان** — ھەممىسى ساقلانغان، پەقەت يوللانمىغان.
> بۇ بۇيرۇق قىسقۇچنى ئەسلىگە قايتۇرۇپ، ئىشنى سايتقا چىقىرىدۇ. يەنە بىر كىچىك ئىش: ھېلىقى
> مەغلۇب سىناقنىڭ ئۆزىدە خاتالىق بار ئىكەن، شۇنى تۈزىتىدۇ.
>
> **تۈگىگەندىن كېيىن سىناڭ:** خاتىرە دەپتىرىدە «باشقا ئىقتىدارلار» → «شەخسىي لۇغەت» ئېچىلسۇن.

---

You are continuing an existing, live project. Read `CLAUDE.md` in this folder FIRST — it is the
project instruction and always wins — and use the **bilim-web** skill.

This is the **tail of stage 7** of the notebook plan (`PROMPT-42.md` … `PROMPT-50.md`, from
`AUDIT-2026-10-07.md`). Stage 7's work is already written, committed and tested; it was never
pushed, and the working tree was left on a detached HEAD. **Do only this.** Do not start
`PROMPT-49.md`.

## The state you will find (checked 2026-10-17)

- `main` holds stage 7's six commits, none of them pushed:
  `fe5aadf` step through the errors · `0cef492` ignore a word in one note · `0293754` manage the
  personal dictionary · `06d74eb` remember the toggle and skip quotations · `59b8f94` step back
  without `Array.prototype.findLast` · `3f5dc3a` docs.
- **HEAD is detached at `ebc9596`** («docs: record the list's readiness and the dev logging rule»,
  the last commit of stage 6). The tree is otherwise clean — no uncommitted source changes, no merge
  or rebase in progress. The detached checkout was made on 2026-10-14 13:18 UTC to re-run one test
  against the pre-change code, and the session stopped before switching back.
- There is an unrelated stash from 2026-08-19 (`stash@{0}`, one binary file `public/brand.png`).
  **Leave it alone** and mention it in your report; it is not yours to drop.
- The last run's verdict, from the session's own log: full suite **1,748 passed, 11 failed,
  34 skipped**; re-running the 11 left **2 failures at 1280×800** — a known flaky navigation test,
  and `tests/auth-traffic.spec.ts:145` «still adds, lists and deletes a bookmark and a note», which
  the session proved fails identically on `ebc9596`, i.e. before stage 7. All new spellcheck tests
  passed.

## Before you start

1. `git status -sb`, `git log --oneline -8 main`, `git stash list`. Confirm the picture above. If the
   tree holds uncommitted source changes you did not make, or `main` does not hold those six
   commits, **stop and ask the owner in Uyghur** — do not improvise a recovery.
   Untracked planning files in the root (`PROMPT-*.md`, `AUDIT-*.md`, `PROJECT-INSTRUCTIONS.md`,
   `bilim-hezinisi-web-maintenance (skill)/`) are the owner's and expected: leave them, never commit
   them.
2. Make sure no other Claude Code session is running tests.

## Non-negotiable constraints (restated from `CLAUDE.md`; they win over anything here)

- **No budget, ever.** Supabase Free + Vercel Hobby; no paid service, no new vendor, no runtime CDN.
- **Anonymous reading always works.** RTL Uyghur UI; code, comments and commits in English.
- Mobile Rules are hard; a note is private (invented text in tests, nothing real in logs or commits);
  RLS on every table; never edit an applied migration; do not weaken the CSP.
- **Never load-test production.** Never leave test data behind in the real project: a run that is cut
  short skips `tests/auth.teardown.ts`, and the seeded book is created with `status: "published"`,
  so it would be visible to real readers until the next teardown.
- Do not change what any test asserts in order to make it pass.

## What to do

### A. Put the working tree back on `main`

`git checkout main`, then confirm with `git status -sb` that HEAD is on `main`, the tree is clean,
and `git log --oneline -1` shows `3f5dc3a`.

### B. Re-verify, then push

1. `npm run typecheck`, `npm run lint`, `npm run build`, `npm run test:unit`.
2. Playwright: the notebook projects — `--project "notes-*"` (all three viewports and the Firefox and
   WebKit projects). They must be green.
3. Push `main`. Wait for Vercel, then open `https://bilimhezinisi.com` and check it loads.
4. Confirm the real project is clean after your run: no `bh-e2e-` accounts and no book whose title
   contains `__e2e_kitab__` remain. If the teardown did not run, run it
   (`--project cleanup`) rather than deleting rows by hand.

### C. Fix the test that keeps crying wolf

`tests/auth-traffic.spec.ts:145` fails with a Playwright **strict mode violation**, not a product
failure. Its own saved error context says:

```
Locator: getByTestId('reader-panel').getByText('سىناق خەتكۈچ')
Error: strict mode violation: ... resolved to 2 elements
```

Two bookmarks carry the same label «سىناق خەتكۈچ», so a locator that expects one matches two. The
bookmarks and the note are added with fixed labels on the seeded book by a shared account, so a
repeat of the test (`-repeat1` folders are in `test-results/`), or a previous attempt that failed
before its own cleanup, leaves a row behind and the next run sees two. The product is fine:
adding, listing and deleting a bookmark all work.

Make the test independent of what an earlier attempt left behind, without weakening what it proves:
give the bookmark and the note a **label unique to this run** by appending `RUN_ID`, which
`tests/env.ts` already exports and `testEmail()` already uses — do not invent a second scheme —
and remove only the rows it created. It must still assert that the bookmark and the note survive a
reload and can be deleted.

Then run `tests/auth-traffic.spec.ts` **twice in a row** at 1280×800 and at 375×667 and show both
runs green.

The flaky navigation test is **not** part of this task: name it in your report, with the exact test
and what you saw, and leave it.

## Acceptance criteria

1. HEAD is on `main`; the tree is clean; the 2026-08-19 stash is untouched.
2. Stage 7's six commits are on `origin/main` and live on `https://bilimhezinisi.com`.
3. typecheck, lint, build, unit and the `notes-*` Playwright projects green.
4. `tests/auth-traffic.spec.ts:145` passes twice in a row at both viewports, still asserting the
   reload and the deletion.
5. No test account and no `__e2e_kitab__` book is left in the real project.

Commit the test fix on its own (for example `test(reader): give each run its own bookmark label`).
Finish with a short report **in simple Uyghur** for the owner: that stage 7 is now live, what the
bookmark test's real problem was, the state of the flaky navigation test, and the old stash.

If anything here conflicts with `CLAUDE.md`, or you would have to trade away correctness, privacy,
mobile quality or the free-tier limits to finish it, **stop and ask the owner in Uyghur** — never
make that trade silently.
