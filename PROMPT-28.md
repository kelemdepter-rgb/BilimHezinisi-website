# PROMPT 28 — ھېساباتسىز ئوقۇرمەننىڭ بىكار سوئاللىرىنى توختىتىش

## قانداق ئىشلىتىسىز (يېڭى تۈر ئېچىپ)
1. Claude Code نى ئېچىپ **BilimHezinisi-website** قىسقۇچىنى تاللاڭ.
2. سىزىقتىن تۆۋەنكى تېكىستنى پۈتۈنلەي كۆچۈرۈپ چاپلاڭ.

> **مەسىلە:** ھېساباتى يوق بىر ئوقۇرمەن كىتاب ئاچقاندا، توركۆرگۈ Supabase غا
> **«بۇ كىم؟»** دەپ ئۈچ قېتىم سوراپ بارىدۇ. ھېسابات يوق بولغاچقا ئۈچىلىسى «يوق» (401)
> دەپ قايتىدۇ. يەنى ھەر كىتاب ئېچىلغاندا ئۈچ قېتىم بىكارغا تور ئىشلىتىلىدۇ.
>
> **بۇنىڭ زىيىنى:** كىتاب سەل ئاستا ئېچىلىدۇ، ھەقسىز پىلاننىڭ تور نۆۋىتى بىكار
> خەجلىنىدۇ، ۋە توركۆرگۈنىڭ خاتالىق تىزىملىكى قىزىل خاتالىق بىلەن تولىدۇ.
>
> **بۇ كىچىك ۋە خەتەرسىز بىر تۈزىتىش.** بىخەتەرلىككە قىل قەدەرمۇ تەگمەيدۇ — كىمنىڭ
> نېمە قىلالايدىغانلىقىنى يەنىلا سانلىق مەلۇمات ئامبىرىنىڭ ئۆزى (RLS) بەلگىلەيدۇ.

---

You are continuing an existing, live project. Read `CLAUDE.md` in this folder FIRST —
it is the project instruction and always wins — and use the **bilim-web** skill.

## What this task is

Two related defects in how the **browser** talks to Supabase, both visible in the console
of any signed-out reader on any book page:

1. **Three failed auth round trips per book opened.** Console shows
   `Failed to load resource: the server responded with a status of 401` three times.
2. **`Multiple GoTrueClient instances detected in the same browser context.`** A warning
   from `@supabase/ssr`, because a fresh browser client is constructed at every call site
   instead of once.

Both live in the same corner of the codebase and are one reviewable change. Nothing else
is in scope.

## The evidence

Measured on 2026-09-02, live site, signed out, on `/books/72/read?page=6&q=ناماز`:

- Console: three `401` resource errors on load, plus the `Multiple GoTrueClient instances`
  warning.
- `performance.getEntriesByType('resource')` on the same page:
  `rpc/book_match_pages` **992 ms**, `book_pages?…` **480 ms**. The 401s sit on top of
  that budget for no return.

**Root cause.** `lib/reader/pages.ts` calls `createSupabaseBrowserClient()` inside each
exported function, and several of those functions then call `supabase.auth.getUser()`
unconditionally:

- `saveProgress` (line ~78)
- `touchRecentRead` (line ~97)
- `fetchAnnotations` (line ~113)
- `addBookmark`, `addNote` (below)

`auth.getUser()` is a **network** call to `/auth/v1/user`. For a visitor with no session it
can only ever return 401. The reader calls the first three on every book open, so a
signed-out reader — most of the audience — pays three failed requests every time.

`lib/quran/bookmarks.ts` has the same shape (`getUser()` at lines ~15 and ~27); check it
and fix it the same way if it is on a path an anonymous reader reaches.

## Project context — what already exists

Next.js 16 (App Router) + TypeScript + Tailwind on **Vercel Hobby**, Supabase Free. Live at
`https://bilimhezinisi.com`. Phases 1–25 deployed.

- **`lib/supabase/client.ts`** — `createSupabaseBrowserClient()`, a bare
  `createBrowserClient(...)` with no memoisation.
- **`lib/supabase/public-client.ts`** — already does exactly the right thing for the
  anon-key client: a module-level singleton, `persistSession: false`. **Read its comment
  before you change anything.** It explains why published book text is fetched with the
  plain anon key and why `public/sw.js` refuses to cache a response whose `Authorization`
  header is anything else. Do not break that arrangement, and do not merge the two clients.
- **`lib/reader/pages.ts`** — the reader's data layer, the file this task is mostly about.
- **`components/reader/reader.tsx`** and `components/reader/reader-panel.tsx` — the
  callers. The reader page is server-rendered and the server already knows whether anyone
  is signed in (`getSessionInfo()` in `lib/data.ts`).

---

# The work

## 1. One browser client, not many

Memoise `createSupabaseBrowserClient()` at module level, the way
`lib/supabase/public-client.ts` already memoises its own. Same key, same storage, one
`GoTrueClient`. Keep the function's name and signature so no call site changes.

Keep the two clients **separate**. The public client exists so that cacheable reads carry
only the anon key; folding it into the session client would silently poison the service
worker's cache rules.

## 2. Do not ask the network who an anonymous reader is

Replace the unconditional `await supabase.auth.getUser()` in the browser paths with a check
that costs no request. Options, in order of preference:

- **Best:** the reader page already knows server-side. Pass "is someone signed in" down as
  a prop from the server component into the reader, and have the reader skip
  `saveProgress`, `touchRecentRead` and `fetchAnnotations` entirely when nobody is. A call
  that is never made is faster than a call made cheaply.
- **Otherwise:** read the session from local storage rather than the network
  (`auth.getSession()`, or the client's cached claims) and return early when there is none.

Whichever you choose, when a session **is** present the code must still obtain the real
user id the way it does now before writing a row — do not invent an id from a prop.

**Say plainly in your report why this is not a security change.** It is not, and the reason
must be on the record: every one of these tables is protected by owner-only RLS
(`user_id = (select auth.uid())`, migration `0001`), so the database decides what may be
written. The client-side check is an optimisation that avoids a pointless request; it has
never been what protects anything, and it must not become what protects anything. **Do not
let a prop decide what a reader may see or do** — `components/app-shell.tsx` carries a
comment saying exactly this about `looksSignedIn`; obey it.

## 3. Do not go further than this

- Do **not** try to speed up `book_match_pages` (992 ms). It is real and it is recorded in
  `AUDIT-2026-09-02.md` as P2-8, but it is a SQL question that deserves its own prompt and
  its own measurements.
- Do **not** touch the service worker, the offline cache, or `lib/pwa/`.
- Do **not** refactor the reader's components beyond passing the one prop.

---

# Constraints that do not move

- **No budget, ever.** Supabase Free, Vercel Hobby. No new dependency.
- **Anonymous reading always works.** That is the exact case being fixed; prove it still
  works, and prove a signed-in reader's bookmarks, notes and reading position still work.
- **RLS stays as it is.** Do not touch a policy. Do not touch `lib/admin/guards.ts`. Every
  `/admin` route and mutating Server Action keeps verifying the role server-side.
- RTL Uyghur UI; logical properties only; code, comments and commit messages in English.
- Mobile Rules in `CLAUDE.md` are hard requirements.
- **Search operators stay removed.**
- **Do not weaken the CSP** and do not touch `lib/ai/`.
- **Do not touch `lib/legacy-host.ts`, `proxy.ts`, `lib/seo.ts`, `public/sw.js` or
  `lib/pwa/constants.ts`.**
- **Never edit an applied migration.** This task needs no schema change at all.
- Do not run `git add -A` / `git add .` / `git commit -a`. `git push` deploys to the live
  library — **ask the owner in Uyghur before pushing.**
- Do not fix anything else from `AUDIT-2026-09-02.md`. `PROMPT-26.md` owns the category
  picker; `PROMPT-27.md` owns the presentation-forms book.

---

# Tests

- `npm run typecheck && npm run lint && npm run build` — green.
- Every existing unit and Playwright suite green, `reader.spec.ts` and `offline.spec.ts`
  especially. Five are known flaky or pre-existing — `keyboard.spec.ts:151`,
  `ai.spec.ts:148`, `ai.spec.ts:261`, `offline.spec.ts:181`, `reader-ai.spec.ts:534`. Say
  so and move on if one fails.
- **New tests, at 375×667, 390×844 and 1280×800:**
  - a **signed-out** reader opens a book: **zero** requests to `/auth/v1/user`, and **zero**
    401 responses, asserted from the Playwright network log — not from a screenshot;
  - a **signed-in** reader opens a book: reading position is saved and restored, the book
    appears in recent reads, and bookmarks and notes still load, save and delete;
  - the console carries no `Multiple GoTrueClient instances` warning on the reader, the
    Qur'an mushaf and the notebook;
  - no horizontal overflow at 360 px, and every reader control still visible and tappable
    after scrolling down and back up.
- Record the reader page's load timings before and after, on the same book, and put both
  numbers in the report.

---

# Acceptance criteria

1. A signed-out reader opening a book makes no auth request and sees no 401 in the console.
2. A signed-in reader loses nothing: progress, recent reads, bookmarks and notes all still
   work.
3. Only one `GoTrueClient` exists in the browser; the warning is gone.
4. `lib/supabase/public-client.ts` and the service worker's caching rule are untouched and
   still correct.
5. No RLS change, no policy change, no migration, no CSP change, no new dependency.
6. The report states, in one sentence, why this is not a security change — and no prop
   anywhere decides what a reader may see or do.
7. Nothing from earlier phases regressed.

Commit as one logical change with an English conventional message. Report in **simple
Uyghur**: what you changed, the before/after timings, and the test results viewport by
viewport.

**If removing the auth call would mean trusting a client-side flag for anything a reader is
allowed to do, stop and ask the owner in Uyghur.** A slightly slower book page is worth far
more than a hole in who may write what.
