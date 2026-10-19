# PROMPT 40 — «ئىزدەش» كەلكۈنى پۈتۈن سايتنى يىقىتىۋەتمەسلىكى

**قانداق ئىشلىتىسىز:** Claude Code نى `BilimHezinisi-website` قىسقۇچىدا ئېچىڭ. بۇ ھۆججەتنىڭ
«---» سىزىقىدىن كېيىنكى پۈتۈن ئىنگلىزچە قىسمىنى كۆچۈرۈپ چاپلاڭ. ئۇ ئىشنى باشلاشتىن بۇرۇن سىزدىن
ئىككى سوئال سورايدۇ (PROMPT-39 تاماملاندىمۇ، Supabase تا 0027 ئىجرا قىلىندىمۇ). Vercel دىكى
Firewall قائىدىسى 5-ئۆكتەبىر كەچ قۇرۇلۇپ سىنالدى. ئۇ پەقەت قائىدىنىڭ ئورنىدا بارلىقىنى جەزملەيدۇ.

> **بۇ نېمە ئىش:** 2026-يىل 5-ئۆكتەبىر كەچتە سايت 5 مىنۇتتىن ئارتۇق ئېچىلمىدى. سەۋەبى: بىر
> ئاپتوماتىك پروگرامما بىر سېكۇنت ئىچىدە نەچچە ئون «پۈتۈن كۇتۇپخانىدىن ئىزدەش» تەلىپى ئەۋەتتى.
> ھەر بىر ئىزدەش ساندانغا (Supabase) خېلى ئېغىر ئىش. ساندان كىچىك ۋە ھەقسىز بولغاچقا تولۇپ
> كەتتى. ئاندىن باش بەت، قۇرئان، ئادمىن بېتى — ساندانغا بىر نەرسە سورايدىغان ھەممە بەت — 300
> سېكۇنت كۈتۈپ، ئاخىرىدا ئېچىلالماي قالدى. ھازىر «ئىزدەش» نىڭ ھېچقانداق تورمىزى يوق: Vercel
> دىمۇ، سايتنىڭ كودىدىمۇ، ساندانىدىمۇ. بۇ بۇيرۇق ئۈچ قەۋەت تورموز قوشىدۇ: (1) ساندان بىر ۋاقىتتا
> پەقەت بىر نەچچە ئېغىر ئىزدەشنى ئىشلەيدۇ، ئارتۇقىغا دەرھال «ھازىر ئالدىراش، بىردەمدىن كېيىن قايتا
> سىناڭ» دەيدۇ؛ (2) ساندان جاۋاب بەرمىسە، بەت 300 سېكۇنت ئەمەس، بىر نەچچە سېكۇنتتا ئۇيغۇرچە
> چۈشەندۈرۈش بىلەن توختايدۇ؛ (3) Vercel دا بىر ئادرېستىن مىنۇتىغا 30 تىن ئارتۇق ئىزدەش كېلىشى
> توسۇلىدۇ. ئادەتتىكى ئوقۇرمەن ھېچقانداق پەرق ھېس قىلمايدۇ.

---

You are continuing an existing, live project. Read `CLAUDE.md` in this folder FIRST — it is
the project instruction and always wins — and use the **bilim-web** skill.

## What this task is

On **2026-10-05, ~21:58 and again ~22:10 (Istanbul time)**, `https://bilimhezinisi.com` stopped
answering for more than five minutes. Browsers spun and gave up. Other users reported the same.
The cause is now known (evidence below): an automated client fired **dozens of whole-library
searches within the same fraction of a second**, twice, and the Supabase Free database could not
keep up. Because nothing in the stack bounds how much database work an anonymous visitor can
start, and nothing bounds how long a page waits for the database, a search flood turned into a
**site-wide outage**: home, Qur'an, authors, new books and every admin page timed out at
Vercel's 300-second ceiling.

Your job is to make that failure impossible to repeat: search may refuse politely under a flood,
but **reading the library must keep working**, and nothing may hang for minutes.

## Project context

Next.js 16 (App Router) + TypeScript + Tailwind on Vercel Hobby (`lhr1`, `vercel.json`), Supabase
Free, live at `https://bilimhezinisi.com`. Phases 1–38 are deployed (see Part 0 about 39). Read
these before writing anything:

- `app/search/page.tsx` — the results page (anonymous, server-rendered, `PAGE_SIZE` 20,
  `MAX_PAGE` 15, `MAX_QUERY_CHARS` 200) and `app/search/loading.tsx`.
- `lib/search/books.ts` — `runBookSearch()`, the only caller of the `search_books` RPC from pages.
  It already distinguishes `timeout` (SQLSTATE `57014`) from `error` and logs
  `[bh] search_books <failure> after <ms> ms (<scope>)` via `reportServerError`, never the words.
- `supabase/migrations/0025_search_uses_the_index.sql` — the current `search_books` (security
  definer, `search_path = ''`, `plan_cache_mode = force_custom_plan`): a GIN index scan bounded
  to 301 candidate pages, `ug_normalize()` on each, `ts_rank` over the normalized text, plus a
  title/author pass over `books`. Also `search_quran` where relevant.
- `app/search-actions.ts` (`listBookMatchesAction`, up to 100 pages per call) and
  `app/notes/source-actions.ts` (notebook source panel, already behind `NOTE_SOURCE_RULE`).
- `lib/rate-limit.ts` — the in-process limiter (`callerKey()`, `isRateLimited()`, the existing
  rules). **It is not applied to `/search` today.**
- `lib/supabase/server.ts`, `lib/supabase/middleware.ts`, `lib/supabase/client.ts`,
  `lib/supabase/public-client.ts`, `lib/supabase/admin.ts`, `lib/cache.ts` (`cachedClient()`):
  every Supabase client in the app. **None of them sets a fetch timeout.**
- `proxy.ts` — runs on every page and API request (CSP nonce + `updateSession` → `getClaims()`).
- `app/api/health/route.ts` — the only cron (daily 06:00 UTC, `maxDuration` 45). It runs the
  keep-alive and the search self-check (`lib/search/health.ts`), surfaced in
  `components/admin/usage-panel.tsx`. Your changes must not make that self-check report a false
  failure.
- There is **no `error.tsx` or `global-error.tsx`** anywhere in `app/`.

## Evidence — what happened (from the owner's Vercel dashboard, 2026-10-05)

Runtime Logs (Hobby keeps only one hour; the owner screenshotted them):

- `22:12:17.85 → 22:12:18.05`: about **30** `GET /search` requests in **0.2 s**. Again
  `22:12:23.24 → 22:12:24.38`: about **40** more. Two error waves in the histogram,
  ~21:58–21:59 and ~22:10–22:12.
- Dozens of `[bh] search_books error after 90050–90180 ms (whole library) — code=? rpc error`.
  No SQLSTATE, after ~90 s: the request never got a Postgres answer at all (not the anon role's
  3 s statement timeout, which would have produced `57014` within seconds). The most likely
  reading is that Supabase's API layer and connection pool were saturated; confirm or correct
  this from the code paths before relying on it.
- Dozens of `504 … Vercel Runtime Timeout Error: Task timed out after 300 seconds` on `/search`,
  **and on unrelated pages**: `/`, `/quran`, `/new`, `/authors`, `/notes`, `/my/ai`,
  `/my/account`, `/admin`, `/admin/books`, `/admin/categories`, `/admin/users`.
- Observability (last 12 h): CDN requests spiked to ~2.5K in one bucket with a large 5xx share;
  function timeout rate 2.2 % over 12 h, peaking near 90 %; Active CPU spiked.
- Request details of two flooded `/search` rows (request IDs `dgdlr-1791227538166-…` and
  `959cw-1791227533811-…`, started 22:12:13–22:12:18): **User Agent `Grafana k6/2.3.0`** — the
  k6 load-testing tool with its default user agent — `q` set to ordinary Uyghur words
  («تېخنىكا», «مېۋە»), received at the **Frankfurt (`fra1`)** edge, routed to `lhr1`,
  **Firewall: Allowed**, middleware 6–7 ms, then the function waited the full **300.0 s** on two
  `GET …supabase.co/rest/…` calls and died with `FUNCTION_INVOCATION_TIMEOUT`.

So this was a load-test tool used as a flood, not a break-in. The owner ran no test himself. That
afternoon he had published a YouTube tutorial for the site, and ordinary traffic in Observability
rose over the ~6 hours before the incident — consistent with new viewers. Ordinary viewers did not
cause the outage (browsers report Chrome/Safari, not `k6`, and no human sends 30 searches in
0.2 s), but someone who found the site through the video most likely did — curious or hostile, it
cannot be told apart. **The fix must not depend on who it was, or on traffic falling back after the
video cools down:** one laptop can repeat this at any time, and more visibility means more people
who might try.

Measured afterwards from the owner's computer (idle database, 2026-10-05 ~22:30): `/` 0.23 s,
`/books/72` 0.26 s, `/quran` 0.19 s, `/new` 0.21 s, and one whole-library search for «ناماز»
**0.93 s** end to end. One request costs an attacker nothing; it costs our shared-CPU database
the better part of a second. Forty at once is enough to stall it.

What was ruled out: Vercel and Supabase status pages show no incident on 2026-10-04/05; DNS is
unchanged (`A 216.198.79.1`, Hostinger nameservers); no code was pushed after 2026-09-25 (the
local `origin/main` is `375e0f1` — confirm the live deployment's commit on Vercel); nothing in the
site's own pages generates bursts of `/search` requests (the only `/search` links are the two
pagination links on the results page). Nothing suggests data was read beyond public search
results or changed — every flooded request was an anonymous read.

**The defect is ours, whoever sent the flood:** `/search` is the one anonymous route that makes
the database do heavy work, and it has no brake at any layer — no edge limit, no app limit, no
database concurrency limit — and no client in the app gives up on a slow database before
Vercel's 300 s ceiling.

## Non-negotiable constraints (restated from `CLAUDE.md`; they win over anything here)

- **No budget, ever.** Supabase Free + Vercel Hobby only. No paid service, no new vendor account,
  no second cron, no external API at runtime. **No CAPTCHA, no Turnstile, no hCaptcha.** No Redis,
  Upstash, KV or any other new store.
- **Anonymous reading always works** — browsing, reading and search need no account. A busy
  answer from search is acceptable; a hung or blank page is not.
- **Search operators stay removed.** Whatever is typed is one literal phrase. Do not change what
  search matches or how it ranks — only how much of it may run at once and how long anyone waits.
- **What a reader types is never logged or stored** (PROMPT-29). New log lines carry reason
  codes, durations and scope only — never the query, never an IP, never an email.
- **RTL Uyghur UI**; code, comments and commits in English.
- **Mobile Rules are hard:** ≥44 px targets, `100dvh`, safe-area padding, nothing hidden after
  scrolling down and back up, no horizontal scroll at 360 px, logical properties only.
- **RLS on every table.** `/admin` and every mutating Server Action re-verify the role
  server-side. **Never edit an applied migration** — new SQL goes in a new file numbered after
  the highest one in `supabase/migrations/`.
- **Do not weaken the CSP**; no third-party runtime scripts.
- **Never load-test production.** Never send bursts at `bilimhezinisi.com`, never at the
  production Supabase project — this exact mistake, or someone else's, is what took the site down.
  All concurrency tests (k6, autocannon, a loop of `fetch`, anything) run against a local build
  and a local or scratch database. The one exception is Part D's check: sequential requests to
  `/search` with **no** `q`, which do no database work. Add this rule, in one line, to `CLAUDE.md`'s
  DO-NOT-TOUCH list.
- **Never `git add -A`.** Stage only the files you changed.

## What to do

### Part 0 — Repository state first (ask before you push anything)

As of 2026-10-05, `git status` reports `main...origin/main [ahead 5]`: commits `2bc6d54 …
8abdd60` (PROMPT-39: Before User Created hook, bot fields, registration pause) exist **only
locally**. The live `/register` does not contain the `bh_note` honeypot field, which confirms they
are **not deployed**. Migration `0027_before_user_created_hook.sql` may or may not have been run
against the production database.

Pushing anything to `main` would ship those five commits too. So before writing code:

1. Run `git status`, `git log origin/main..HEAD --oneline`, and `git diff --ignore-all-space
   --stat`, and show the owner the result in plain Uyghur.
2. Ask him, in simple Uyghur, **one question at a time**:
   - Is PROMPT-39 finished and tested, and does he want it live?
   - Was `0027` run in Supabase (guide him to check **Database → Functions** for
     `hook_before_user_created`, or the equivalent he can read; verify the current UI)?
3. Propose the safest order and wait for his answer. If PROMPT-39 is not ready, build this task on
   a branch from `origin/main`, ship it alone, and leave PROMPT-39's commits untouched for him to
   finish later. Never rewrite, squash or drop his commits without his explicit yes.

Number the new migration after the highest file present (today that is `0028_…`), and make it
**independent of 0027** so it applies cleanly whether or not 0027 has been run.

### Part A — A concurrency gate inside the database (the real fix)

New migration, e.g. `0028_search_concurrency_gate.sql`. Inside `search_books` (and inside any
other anonymous RPC whose cost you measure above ~100 ms — check `search_quran` and whatever
`listBookMatchesAction` calls), **before** the expensive work:

- Try to take one of **N** transaction-scoped advisory-lock "slots"
  (`pg_try_advisory_xact_lock(<fixed namespace key>, <slot>)` for slot 1..N). Never the blocking
  variant. If no slot is free, end at once with a stable, machine-readable refusal — e.g.
  `raise exception 'bh:search_busy' using errcode = '<a dedicated SQLSTATE you document>'` — so
  the caller gets an answer in milliseconds instead of joining a queue.
- Size the slots for the **heaviest** search, not the typical one. Measured 2026-10-05 ~23:05,
  single sequential requests, idle database, server-reported time: «تېخنىكا» 0.17 s, «مېۋە» 0.48 s,
  «ناماز» 0.59 s, «كىتاب» 0.64 s, «ئىلىم» 0.72 s, «پەيغەمبەر» 1.23 s, and **«ئاللاھ» hits the 3 s
  statement timeout every time** (fixed separately in `PROMPT-41.md`; until then the gate must hold
  even when every slot is a 3 s search).
- Use separate slot pools for whole-library and one-category searches so a flood of the heavy
  kind cannot starve the cheap kind. Start from **2 whole-library slots and 3 one-category
  slots**, then measure (see Tests) and adjust; write the measured numbers and the reasoning in
  the SQL comment.
- Transaction-scoped locks release themselves at commit or rollback, so a crashed or cancelled
  request cannot leak a slot. Prove that in a test.
- **Verify, don't assume:** that `pg_try_advisory_xact_lock` works inside this function as
  PostgREST calls it (the transaction mode PostgREST uses for this function's volatility; the
  current function is `stable`). If the volatility has to change, change it deliberately,
  re-check that `supabase-js` `.rpc()` still reaches it, and say so in the commit message.
- Keep everything else about the function byte-for-byte equivalent in behaviour: same arguments,
  same result columns, same ranking, same 301-candidate bound, same `security definer`,
  `search_path = ''`, `plan_cache_mode`, and the same grants (re-issue them explicitly after
  `create or replace`).
- Do not use a table to count concurrent searches. A write per search would make the flood
  heavier, not lighter.

### Part B — The app answers "busy" quickly and kindly

1. In `lib/search/books.ts`, map the refusal to a third failure kind, `busy`, alongside
   `timeout` and `error`. Log `search_books busy (<scope>)` at most — no query text.
2. In `app/search/page.tsx`, show a calm Uyghur message for `busy`, e.g.
   «ھازىر ئىزدەۋاتقانلار كۆپ. بىر نەچچە سېكۇنتتىن كېيىن قايتا سىناڭ.» with a retry control
   (≥44 px, reachable by tap, keeps `q` and `cat`). It must not look like a crash. Add a
   `data-testid="search-busy"`.
3. Apply an **in-process limiter** to `/search` (and to `listBookMatchesAction`) with the
   existing `lib/rate-limit.ts` machinery: a new `SEARCH_RULE` (start at 30 per 60 s per
   `callerKey()`; justify the number). When it trips, render the same busy message **without
   calling the database**. Say plainly in the code comment that this limiter is per instance and
   is only the middle layer; the database gate (Part A) is what holds against a distributed flood.
4. `listBookMatchesAction` and the notebook source panel (`app/notes/source-actions.ts`) must
   handle `busy` with their own short Uyghur message instead of failing silently.
5. Crawlers: make result pages (`/search` **with** a `q`) `noindex, follow` via
   `generateMetadata`, keep `/search` itself indexable, and add `Disallow: /search?` to
   `app/robots.ts` while keeping `/search` allowed. Keep the JSON-LD `SearchAction` on the home
   page. This only helps with polite crawlers — say so in the comment.
6. The daily `/api/health` search self-check must not report a failure because a slot happened
   to be busy: on `busy`, retry once after a short pause, then report `busy` as its own state
   (not as `error`) in `components/admin/usage-panel.tsx`.

### Part C — Never hang for 300 seconds again

1. Give **every** Supabase client a fetch timeout through `global.fetch` (an `AbortSignal`
   combined with any signal the caller passes): the server client, the proxy client in
   `lib/supabase/middleware.ts`, `cachedClient()`, the admin/service client, the public client
   and the browser client. Measure today's slowest legitimate call per client (admin batch
   inserts of ≤500 rows, the health route, sign-in) and choose ceilings with a margin; document
   each number and where it came from. Reads should give up in seconds, not minutes.
2. In the proxy, a timed-out or failed `getClaims()` must fall through as "not signed in" for
   page rendering purposes (the page still renders for anonymous reading) — never block the
   request. Make sure this cannot be used to bypass any server-side role check: `/admin` and
   every mutating Server Action keep re-verifying the role themselves and must **fail closed**.
3. Set a `maxDuration` ceiling for page rendering (verify where Next 16.3 accepts it — root
   layout, segment layouts or pages — against the docs shipped in `node_modules/next`), well
   below 300 s, with explicit longer exceptions only where a measured operation needs them.
4. Add `app/error.tsx` (and `app/global-error.tsx` if needed) with a short Uyghur message and a
   retry button, styled with the existing tokens, RTL, mobile-safe. When the database is down,
   a reader must see that message within seconds — not a spinner for five minutes.
5. Make sure offline/PWA behaviour is unchanged: `public/sw.js` must not cache the error page as
   if it were the book page. Check the `CACHEABLE_HEADER` path and add a test.

### Part D — The edge brake (the owner does this in Vercel; you guide him)

**Status:** the owner created and published this rule on 2026-10-05 at 22:52 (Istanbul). It was
verified the same minute: 35 sequential `GET /search` (no `q`, so no database work) from his
connection returned 200 ×30, then 429 from the 31st. Do not recreate it; confirm it is still
listed under Firewall → Rules, and record its settings in `docs/`. If it is missing, guide
him **in simple Uyghur, one step at a time, with exact button names** (verify the current UI
against <https://vercel.com/docs/vercel-firewall/vercel-waf/rate-limiting>):

- Project → **Firewall** → **Rules** → **Project rules** → **+ Add Rule** (the UI the owner saw
  on 2026-10-05), name `search flood limit`.
- **If** Request Path **Starts with** `/search` → **Rate Limit** row: **Fixed Window**, **60**
  seconds, **30** requests, key **IP Address** only (the default «1 Keys: IP Address») →
  **Then** **Too Many Requests (429)** → **Save Rule** → **Review Changes** → **Publish**.
- Warn him: in this dialog **Esc closes the whole rule without saving** (it happened once).
  To close the key picker, click empty space inside the dialog instead.

**After Part A is deployed and verified**, guide the owner to raise the rule from 30 to **60
requests per 60 s**. Reason: the YouTube tutorial means groups — a classroom, a family, a mosque
community — may follow it together behind one shared Wi-Fi address, and 30 searches a minute
shared by a room is tight. Once the database gate exists, the per-IP limit no longer has to protect
the database on its own, so it can be generous. Confirm with a single sequential test of 61
requests to `/search` **without** a `q` (no database work), as was done on 2026-10-05.

Then, if he has not already, a second custom rule (Hobby allows three): **If** User Agent
**Contains** `k6/` → **Then** **Deny**. Tell him plainly that this only stops the exact tool
seen on 2026-10-05 with its default settings — anyone can change a user agent — so it is a
cheap extra, not the protection; the rate limit and Part A are.

Facts to tell him, from Vercel's own docs: WAF rate limiting is available on Hobby with **1 rule
per project** and **1,000,000 allowed requests** included; Hobby allows **up to 3 custom rules**
in total; changes apply without a redeploy. **Attack Mode** (Firewall → Rules page → **Danger Zone** →
**Enable Attack Mode**, as the owner saw it on 2026-10-05) is free on all plans, lets verified bots such as Googlebot through,
and is the emergency switch if the site stalls again. Do not enable the Bot Protection managed
ruleset in **Challenge** mode without first watching it in **Log** mode: a challenge served to
the service worker's background fetches could be cached as if it were a book page. Note:
`vercel.json` can express only `deny`/`challenge` mitigations, not rate limits, so this rule
lives in the dashboard. Record the rule's exact settings in `docs/` so it is not lost.

### Not in scope — do not do these

- No CAPTCHA or proof-of-work, no login wall for search, no change to what search matches.
- No caching of whole HTML pages at the CDN: the per-request CSP nonce makes every response
  unique, and the CSP must not be weakened.
- No change to how book listings are cached (the owner chose to see new books immediately).
- No new cron, no external monitor, no new vendor.

## Tests

- `npm run typecheck`, `npm run lint`, `npm run build`, the full unit suite and the full
  Playwright suite are green. Any test you believe is flaky: prove it on the baseline commit
  before calling it pre-existing.
- **SQL tests** (local Postgres / Supabase local stack / scratch project — never production):
  N concurrent whole-library searches succeed, the N+1th gets `bh:search_busy` in < 200 ms;
  slots are released after commit, after an error and after a statement timeout; a one-category
  search still succeeds while all whole-library slots are held; results and ranking are identical
  to `0025` for a fixed set of queries (reuse `scripts/search-parity.mjs` if it fits).
- **Flood test against a local production build** (`next build && next start`) pointed at a
  local or scratch database: fire ≥100 concurrent `/search?q=…` requests while repeatedly loading
  `/`, a book page and a reader page. Assert: the reading pages keep answering in under 2 s; no
  request takes longer than your documented ceilings; search answers are either results or the
  busy message; nothing returns a 5xx after the flood stops. Record the numbers in the commit
  message or `docs/`.
- **Timeout test**: with the database unreachable (wrong URL or a blackholed port locally), `/`
  shows the Uyghur error page within your ceiling, and `/admin` refuses rather than letting
  anyone in.
- **Playwright at 375×667, 390×844 and 1280×800**: the busy message and the error page are
  visible, readable, RTL, have a tappable retry control (≥44 px), cause no horizontal overflow,
  and stay usable after scrolling down and back up. Mock the RPC for these — do not depend on a
  real flood.
- Unit tests for the `busy` mapping, `SEARCH_RULE`, the robots/noindex rules, the fetch-timeout
  wrapper (including that a caller's own `AbortSignal` still works), and the health check's
  `busy` state. Assert that no log line contains the query text.

## Acceptance criteria

1. Under a local flood of ≥100 concurrent whole-library searches, `/`, a book page and a reader
   page keep answering in under 2 s, measured and recorded.
2. Excess searches get a polite Uyghur busy message quickly (database refusal in < 200 ms);
   nobody waits minutes.
3. With the database unreachable, every page gives up within the documented ceiling and shows
   the Uyghur error page; no route can reach Vercel's 300 s limit through a Supabase call.
4. `/admin` and every mutating Server Action still fail closed when auth or the database is slow.
5. Search results and ranking are unchanged for normal use; operators remain removed; the query
   is never logged.
6. The daily health check distinguishes `busy` from `error`.
7. Result pages are `noindex, follow`; `robots.txt` disallows `/search?` and still allows
   `/search`.
8. The Vercel rate-limit rule exists, has been raised to 60 per 60 s after Part A was verified
   live (the owner confirms with a screenshot), and its settings are recorded in `docs/`; `CLAUDE.md` forbids load-testing production in one plain line.
9. PROMPT-39's unpushed commits were handled exactly as the owner decided in Part 0.
10. typecheck, lint, build and every existing test are green; the new tests above pass at all
    three viewports.

Commit per logical step with English conventional messages (e.g. `feat(db): …`,
`fix(search): …`, `test(search): …`), push only after Part 0 is settled, and verify on
`https://bilimhezinisi.com` after Vercel deploys — **with single, ordinary requests only**.
Finish with a short report **in simple Uyghur** for the owner: what changed, what he did in
Vercel, what he should check on his phone, and anything left undone.

If anything here conflicts with `CLAUDE.md`, or you would have to trade away quality, security,
anonymous reading, mobile behaviour or the free-tier limits to finish it, **stop and ask the
owner in Uyghur** — never make that trade silently.
