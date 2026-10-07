# Search floods and a database that does not answer (PROMPT-40)

On 2026-10-05, ~21:58 and ~22:10 (Istanbul), `bilimhezinisi.com` stopped
answering for more than five minutes. A load-testing tool (`Grafana k6/2.3.0`,
its default user agent) sent about 30 whole-library searches to `/search` in
0.2 s, then about 40 more. Each one asked the database for the better part of a
second of CPU; nothing bounded how many could run at once; they filled
PostgREST's connections; every other page's reads queued behind them; and with
no timeout anywhere, every page — home, Qur'an, `/admin` — waited until Vercel
killed it at 300 s.

`[bh] search_books error after 90050 ms … code=?` in the logs was Supabase's
API gateway giving up: postgrest-js records `code=?` only for an HTTP error
whose body is not PostgREST's JSON (a fetch that fails outright would be
`code=` with nothing). And postgrest-js retries a failed **GET** three more
times (1 s, 2 s, 4 s), which is how the pages' own reads reached 300 s.

What holds now, from the outside in:

| Layer | Where | Holds against | Answer |
|---|---|---|---|
| Edge rate limit | Vercel Firewall (dashboard) | one address, every instance | HTTP 429 at the edge |
| `SEARCH_RULE` | `lib/rate-limit.ts`, per server instance | one address, one instance | «ھازىر ئىزدەۋاتقانلار كۆپ» without asking the database |
| Search slots | migration `0028_search_concurrency_gate.sql` | **any number of addresses**, and callers who skip the site with the public key | `PT429 bh:search_busy` in milliseconds → the same calm message |
| Timeouts | `lib/supabase/timeouts.ts`, every Supabase client | a database or API that does not answer | gives up in seconds |
| Error pages | `app/error.tsx`, `app/global-error.tsx`; the notebook's own `app/notes/error.tsx` | everything else | «كۇتۇپخانا ھازىر جاۋاب بەرمىدى» (the notebook: «خاتىرە دەپتىرى ئېچىلمىدى») + retry |
| `maxDuration` | `app/layout.tsx` 30 s, every route handler 30 s, `/api/health` 60 s | anything left | Vercel stops it long before 300 s |

**Never load-test the live site or the live Supabase project.** Everything
below was measured on this computer against a copy (`scripts/flood/`).

---

## 1. The Vercel Firewall rules (the owner's dashboard)

They live in the dashboard, not in the repo: `vercel.json` can only express
`deny` and `challenge`, not a rate limit. Changes apply at once, without a
redeploy.

### Rule 1 — `search flood limit` (rate limit)

Created and published by the owner on **2026-10-05 22:52** (Istanbul).
Checked again on **2026-10-06**: 35 sequential `GET /search` (no word, so no
database work) answered 200 × 30, then 429 from the 31st.
**Raised to 60 on 2026-10-06**, after migration 0028 was applied and confirmed
in the live database (the owner's read-only check: all four `true`): 61
sequential `GET /search` with no word answered 200 × 60, then 429.

| Field | Value |
|---|---|
| Name | `search flood limit` |
| If | **Request Path** · **Starts with** · `/search` |
| Then | **Rate Limit** |
| Algorithm | **Fixed Window** (the only one on Hobby) |
| Time Window | **60** seconds |
| Request Limit | **60** (30 from 2026-10-05 until 0028 was live) |
| Key | **IP Address** only (the default «1 Keys: IP Address») |
| Action | **Too Many Requests (429)** — «Default (429)» |

Why 60 and not 30: the YouTube tutorial means groups — a classroom, a family,
a mosque community — searching together behind one Wi-Fi address, and with
the database's own slots in place the per-address limit no longer has to
protect the database alone. `SEARCH_RULE` is 60 for the same reason. To check
it again: 61 sequential `GET /search` with **no `q`** — 200 × 60, then 429.

`/search` also covers the Server Actions the results page posts to itself (the
«بۇ كىتابتىكى بارلىق ئورۇنلارنى كۆرۈش» expander), so they count too.

The UI the owner saw on 2026-10-05: Project → **Firewall** → **Rules** →
**Project rules** → **+ Add Rule**. Vercel's docs (revised 2026-08-28) describe
the same as **Firewall** → **Configure** → **+ New Rule**; either way the rule
is saved with **Save Rule**, then **Review Changes** → **Publish**.
**In that dialog, Esc closes the whole rule without saving** (it happened once);
to close the key picker, click empty space inside the dialog instead.

### Rule 2 — `k6 deny` (custom rule)

If **User Agent** · **Contains** · `k6/` → **Deny**. Created by the owner on
**2026-10-06**; checked the same day with one request each: the k6 user agent
answered 403, an ordinary phone browser 200. It stops only the exact tool
seen on 2026-10-05 with its default settings; anyone can change a user agent.
A cheap extra, not the protection. Two of Hobby's three custom rules are now
in use.

### Facts from Vercel's docs (checked 2026-10-06)

- WAF rate limiting is available on **Hobby**: **1** rate-limit rule per
  project, **1,000,000** allowed requests included, fixed window of 10 s to
  10 min, keyed by IP address (or JA4 digest).
- Hobby allows **3** custom rules in total, the rate-limit rule included.
- Rate-limit counters are kept **per region**: traffic from several Vercel
  regions can exceed the limit in total. One more reason the database's own
  slots are the layer that has to hold.
- **Attack Mode** is free on every plan, lets verified bots (Googlebot) and
  this project's own cron through, and is the emergency switch if the site
  stalls again: **Firewall** → **Bot Management** → **Attack Mode** →
  **Enable** in today's docs (the owner saw it on 2026-10-05 as **Rules** →
  **Danger Zone** → **Enable Attack Mode**).
- Do **not** turn the Bot Protection managed ruleset to **Challenge** without
  watching it in **Log** first: a challenge page served to the service
  worker's background fetch of a book page could be kept as that page.

---

## 2. The search slots (migration 0028)

Every expensive anonymous search takes one of a few transaction-scoped
advisory locks before any work — `pg_try_advisory_xact_lock(20261005,
pool × 100 + n)`, never the blocking form — or ends at once with
`SQLSTATE PT429, message 'bh:search_busy'` (PostgREST turns `PTxyz` into HTTP
xyz, so it is an HTTP 429). The lock goes with the transaction: commit,
error, statement timeout, cancel or a dead backend all give it back.

| Pool | Function | Slots |
|---|---|---|
| 1 | `search_books`, whole library | 2 |
| 2 | `search_books`, one category | 3 |
| 3 | `book_match_pages` (the reader's navigator, the expander) | 2 |
| 4 | `search_quran` | 1 |

The slot taker is `private.take_search_slot()`, in a schema the API does not
expose (`public` and `graphql_public` only — checked against the live project
2026-10-06). Everything else about the three functions is unchanged; 400
calls against the local copy answered byte-for-byte the same before and after,
and `tests/unit/search-gate-sql.test.ts` holds them to 0025's and 0015's bodies.

**Verified, not assumed:** PostgREST 14.5 (what the live project reports) runs
a STABLE function in a **READ ONLY, READ COMMITTED** transaction — for POST and
GET alike — and `pg_try_advisory_xact_lock` works there, so the functions stay
STABLE.

**Live since 2026-10-06.** The owner ran 0028 in the SQL Editor
(«Success»); his read-only check of the three function definitions and the
slot taker answered `true` four times. `scripts/search-timing.mjs after`, as
an anonymous visitor against 61 books / 19,616 pages: 0 failed, 0 over
budget, of 22 calls; 20 cells answered exactly as the `before` run taken that
morning, and the 2 that differ are capped results (more than 300 matching
pages), whose 301-row slice depends on the plan by design (0014).

### Choosing the sizes

A direct flood of all four functions at once — 100 callers, 30 s, straight at
PostgREST with the public key (the attack that skips the site and its
firewall):

| Slots (whole/category/navigator/Qur'an) | Total | Search holders that ran into the 3 s timeout | Reading pages, max |
|---|---|---|---|
| 2/3/2/2 | 9 | ~41 | 81 ms |
| 2/2/2/1 | 7 | 32 | 127 ms |
| **2/3/2/1** | **8** | **22** — and the most results (369), the fewest 10 s waits (18) | **156 ms** |
| 2/3/1/1 | 7 | 14 | 71 ms |
| 2/2/1/1 | 6 | 13 | 112 ms |
| 1/2/1/1 | 5 | 0 | 66 ms |

Category searches are cheap (a scoped candidate set), so three slots cost
little. The navigator keeps two because every reader arriving from a result
calls it; with one, an ordinary busy evening would start telling readers
"busy". The Qur'an search is the least used, so one.

---

## 3. Measurements (local copy, 2026-10-06)

The copy: Supabase's Postgres image 17.6.1.143 and PostgREST 14.5 (the live
versions), 57 books / 17,682 pages (the desktop library, tripled — live had
17,601), the Qur'an seeded. The database container held to **0.66 CPU**:
single searches then take about half their live time («پەيغەمبەر» 0.50–0.56 s
here, 1.23 s live; «ناماز» 0.29 s here, 0.59 s live) and the total is about the
free tier's two shared cores.

### The concurrency checks — `node scripts/flood/gate-check.mjs`

All pass. A whole-library search with both slots held elsewhere: **HTTP 429
`PT429` in 14–23 ms**. A one-category search, the navigator and the Qur'an
search still answer meanwhile. With one slot held a second search still
answers. Slots come back after commit, after an error, after a statement
timeout and after the holding backend is terminated. A burst of 30: 2 results,
28 busy, nothing else.

### The flood — `node scripts/flood/flood.mjs`

100 virtual users, each from its own address (so `SEARCH_RULE` never fires and
the database's slots are what hold), whole-library searches for heavy words
back to back for 30 s — about 50 a second. A reader in a separate process loads
the home page, a book page and the reader page over and over.

**With the slots, reader on a second instance** (`FLOOD_READER=http://localhost:3401`
— closer to Vercel, where requests get function instances of their own and
the database is the one thing every page shares, which is what failed):

| Run | `/` max | book page max | reader max | busy | results | anything else |
|---|---|---|---|---|---|---|
| 1 | 231 ms | 147 ms | 234 ms | 1,391 | 71 | 0 |
| 2 | 262 ms | 137 ms | 370 ms | 1,406 | 75 | 0 |

Medians during the flood: 42–83 ms. After the flood: 22–46 ms, and one search
answers with results in ~0.44 s.

**Without the slots** (0025's functions, the new timeouts, same flood): the
reading pages on the other instance took **4.9–10 s** and ran into the 10 s
timeout; of 362 searches 21 got results, 83 timed out, 258 failed. That is
2026-10-05, reproduced — ending at 10 s instead of 300.

**One address** (`--one-address`): `SEARCH_RULE` lets 60 a minute through,
8 got results, 1,786 were told "busy"; reading pages max 170 ms.

**Reader on the same instance as the flood**: the reading pages took
1.6–2.9 s. That is this computer's single `next start` process saturating its
own CPU rendering ~55 search pages a second — `robots.txt`, which reads
nothing, slowed to 0.43 s alongside — while PostgREST answered a plain read in
52 ms and a refusal in 18 ms (median) the whole time. On Vercel that layer
scales out; the database does not, which is why the slots are the fix.

### The database not answering — `GET /__gw/blackhole/on` on the local gateway

| Page | Warm cache | Cold cache |
|---|---|---|
| `/` | 200 in 10.05 s → `app/error.tsx` | 500 in 10.2 s → `app/global-error.tsx` |
| book page, reader | 200 in 10.0 s → error page | 500 in 20.0 s (two loaders, one after the other) |
| `/quran` | 200 in 0.04 s (the sura list is cached) | 500 in 10.0 s |
| `/admin`, signed out | 307 → `/login` in 0.06 s | 500 in 10.1 s |

In a browser the Uyghur error page was on screen at **10.1 s** (warm) and
**10.3 s** (cold). Nothing reaches Vercel's 300 s.

A failed page can still arrive as a **200**: once a route's loading skeleton
has streamed, the status has gone out, and the failure ends the stream with
React's `$RX("B:0","<digest>")`. `public/sw.js` now refuses to store any
document carrying `$RX(`, `data-dgst=` or `data-bh-error-page`. Checked in a
real browser: a book page kept while healthy stayed byte-for-byte the same
(88,717 bytes) through a failed reload, and offline the book — not the error
page — came back.

---

## 4. How to repeat it

```bash
node scripts/flood/stack.mjs up          # Docker: Postgres 17.6 + PostgREST 14.5, every migration
node scripts/flood/gateway.mjs           # another terminal: /rest/v1 on :54339
node scripts/flood/stack.mjs seed        # needs migration-data/library.db
node scripts/flood/gate-check.mjs        # the slot checks
node scripts/flood/serve.mjs build       # the site, built against the local stack only
node scripts/flood/serve.mjs start       # :3400 (and `start 3401` for the reader)
FLOOD_READER=http://localhost:3401 node scripts/flood/flood.mjs
node scripts/flood/stack.mjs down
```

Every script refuses a target that is not `127.0.0.1`/`localhost`. The build
takes every Supabase variable — the address, both keys, `ADMIN_EMAIL` — from
`.flood/local.env` (random local keys), overriding `.env.local`. `grep` the
build for the live project's host before serving it; it should find none
(2026-10-06: none in `.next-flood/static` or `.next-flood/server`).

## 5. The timeouts

| Client | Ceiling | Why |
|---|---|---|
| Server client, shared-cache client, service-role client, health check | **10 s** | above the 8 s statement timeout of signed-in/service requests; the slowest legitimate call measured is ~1.2 s live |
| Proxy's session check | **3 s**, overall | normally no network at all; past it the page renders anonymously and is **not** marked cacheable if a session cookie came with it |
| A page's or an action's "who is signed in" | **5 s**, overall | auth-js retries a refresh for up to 30 s by itself; past it pages render anonymously and every role check fails closed |
| Browser clients | **30 s** | phones on weak connections; a 200-page batch insert |
| Browser uploads to Storage | **10 min** | a kept original over a mobile uplink |

A timeout aborts with a plain `AbortError`, which postgrest-js does **not**
retry (any other fetch failure on a GET it retries three times).
