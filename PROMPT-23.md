# PROMPT 23 — دومېن كۆچۈشىنىڭ كود قىسمى (bilimhezinisi.com)

## قانداق ئىشلىتىسىز (يېڭى تۈر ئېچىپ)
1. Claude Code نى ئېچىپ **BilimHezinisi-website** قىسقۇچىنى تاللاڭ.
2. سىزىقتىن تۆۋەنكى تېكىستنى پۈتۈنلەي كۆچۈرۈپ چاپلاڭ.

> **مۇھىم — ئالدىن ئوقۇڭ:** بۇ بۇيرۇقنىڭ ئىچىدىكى ئەڭ نازۇك ئىش — كونا ئادرېسنى
> يېڭىسىغا يۆتكەش. ئۇنى **پەقەت پارول ئەسلىگە كەلتۈرۈش سىنىقى ئۆتكەندىن كېيىنلا**
> ئىشلىتىڭ. سىناق تېخى ئۆتمىگەن بولسا بۇ بۇيرۇقنى ساقلاپ تۇرۇڭ.
>
> **ئەندىشە قىلمىسىڭىزمۇ بولىدۇ:** بۇ بۇيرۇق كونا ئادرېسنى ئۆچۈرمەيدۇ. ئۇ پەقەت
> كونا ئادرېسقا كەلگەن كىشىنى يېڭى ئادرېستىكى **دەل شۇ بەتكە** ئاپىرىدۇ. سايت پۈتۈن
> جەريان ئىچىدە ئىشلەپ تۇرىدۇ.
>
> **ئارقىغا قايتىش:** بۇ بۇيرۇقتىن كېيىن بىر نەرسە ياقمىسا، بىرلا commit نى
> قايتۇرۇش كۇپايە.

---

You are continuing an existing, live project. Read `CLAUDE.md` in this folder FIRST —
it is the project instruction and always wins — and use the **bilim-web** skill.
`PROMPT-22.md` is the reference plan for this migration; this prompt is its code half.

## What this task is

The library has **already moved** to `https://bilimhezinisi.com`. Everything that could
be done from a dashboard has been done and verified from the public internet. What is
left is the code: remove the last references to the old address, make the PWA and the
service worker correct on the new origin, and make the old address permanently redirect
to the new one.

**This is additive, not a cutover. The old address is never deleted.**

## Project context

Next.js 16 (App Router) + TypeScript + Tailwind on **Vercel Hobby**, Supabase Free.
GitHub `kelemdepter-rgb/BilimHezinisi-website`. Phases 1–21 are complete and deployed:
library, reader, exact-phrase search, Qur'an, notebook with Uyghur spellcheck, PWA with
offline reading, book download and sharing, discovery pages (`/authors`, `/new`,
`/feed.xml`, `/request`), licence and trust pages (`/about`, `/privacy`, password reset,
account deletion, nonce-based CSP), and a browser-only bring-your-own-key Gemini AI
layer. PROMPT-20 (AI answer quality) and PROMPT-21 (navigation speed) are applied.

---

# ALREADY DONE — do not redo any of this

Verified on **2026-08-29** from the public internet, not assumed:

| What | State |
|---|---|
| DNS at Hostinger | `A @ → 216.198.79.1`, `CNAME www → 8c32374881a1b2ec.vercel-dns-017.com`, TTL 60/300. Hostinger's own nameservers kept (`aster/helios.dns-parking.com`). No CAA record. |
| Vercel domains | `bilimhezinisi.com` → Production (canonical). `www.bilimhezinisi.com` → **308** → apex. `bilim-hezinisi-website.vercel.app` → Production, **still attached, Valid Configuration**. |
| TLS | Issued automatically by Vercel, free. `https://bilimhezinisi.com` fetches successfully. |
| Site serving | `https://bilimhezinisi.com/` returns the library; `https://bilimhezinisi.com/books/72` returns real book metadata. |
| Supabase Site URL | `https://bilimhezinisi.com` |
| Supabase Redirect URLs | Four entries: `https://bilimhezinisi.com/**`, `https://www.bilimhezinisi.com/**`, `https://bilim-hezinisi-website.vercel.app/**` (**kept deliberately**), `http://localhost:3000/**` |
| Vercel `SITE_URL` | `https://bilimhezinisi.com` (Config type, Production and Preview), redeployed |
| SEO output | `/sitemap.xml`, `/robots.txt` and `/feed.xml` all emit `bilimhezinisi.com` and contain no `vercel.app` |

**The canonical host is the apex `bilimhezinisi.com`.** The owner chose it; `www`
redirects to it with a 308. Do not reopen this decision.

---

# Non-negotiable constraints

- **No budget, ever.** Supabase Free and Vercel **Hobby**. Nothing may cost anything, now
  or later. If a step would require a paid plan, stop and say so.
- **The library must never be offline**, not for a minute.
- **Authentication email links must never break.** Do not remove
  `https://bilim-hezinisi-website.vercel.app/**` from anything.
- Anonymous browsing, reading and search keep working with no account.
- RTL Uyghur UI; code, comments and commit messages in English.
- **Do not weaken the CSP or the security headers. Do not touch RLS or role checks.**
  `lib/security/csp.ts` contains no hostname today; it must still contain
  `generativelanguage.googleapis.com` exactly once, in `connect-src`, and nothing new.
- **Do not touch the AI layer.** No server key, no AI route, no change under `lib/ai/`.
- The desktop repo is a **read-only reference**.
- **Never edit an applied migration** in `supabase/migrations/`. No schema change is
  needed for this task at all.
- Do not change `CRON_SECRET`, `vercel.json`, or the cron schedule.

---

# TASK 1 — Sweep the repository for old references

Grep for `bilim-hezinisi-website.vercel.app` and for `vercel.app`. Classify **every** hit
as **must change**, **must stay**, or **historical record**, and put the classified list
in your report.

A sweep run on 2026-08-29 found hits in these files and nowhere else. **Re-run the grep
yourself** — treat this table as a starting point, not as truth, and report anything it
missed:

| File | Expected classification |
|---|---|
| `README.md` | **must change** |
| `tests/unit/book-export.test.ts` | **judgement** — a fixture URL (`.../books/7`). Decide whether the test should assert the new domain or be made domain-agnostic, and say which and why. |
| `PROMPT-1.md` … `PROMPT-22.md` | **must stay** — the project's history, never rewritten |
| `HANDOFF-COWORK.md`, `DOMAIN-MIGRATION-COWORK.md` | **must stay** — history of how the work was commissioned |
| `cowork-audit/1-SKILL.md`, `2-PROJECT-INSTRUCTIONS.md`, `3-KICKOFF-PROMPT.md` | **must stay** — these describe the site as living at `bilimhezinisi.com` with the old address redirecting. They were written ahead of time and become accurate once this prompt ships. Leave them. |

Note what the sweep did **not** find, and do not invent work here: `lib/seo.ts`,
`proxy.ts`, `app/manifest.ts`, `public/sw.js`, `playwright.config.ts` and
`lib/security/csp.ts` contain **no** `vercel.app` string.

---

# TASK 2 — Change what a visitor or a search engine can see

1. **`README.md`** — replace the old address with `https://bilimhezinisi.com`.
2. **`lib/seo.ts`** — read `siteUrl()` carefully before changing anything. Today:
   - `FALLBACK` is `"http://localhost:3000"`, which is correct and must stay.
   - When `SITE_URL` is absent or local, the function falls back to
     `VERCEL_PROJECT_PRODUCTION_URL ?? VERCEL_URL`.

   **The requirement:** a deploy that loses `SITE_URL` must not silently re-advertise
   `bilim-hezinisi-website.vercel.app` to Google and to people's inboxes. Determine what
   `VERCEL_PROJECT_PRODUCTION_URL` actually resolves to now that a custom production
   domain is assigned, and if it can still yield the old host, make the outcome
   deterministic — for example by preferring the canonical domain explicitly, or by
   failing loudly in production when `SITE_URL` is missing. **Choose, justify the choice
   in the report, and cover it with a unit test.** Do not guess the value of that
   variable; verify it.
3. `docs/` currently contains only `ai-manual-check.md`. Check it and any script under
   `scripts/` for the old host and fix what you find.

---

# TASK 3 — History stays; add one dated line

Do **not** rewrite `PROMPT-1.md` … `PROMPT-22.md`.

Instead add **one dated line** to `CLAUDE.md` recording that the site moved to
`https://bilimhezinisi.com` on **2026-08-29**, that `www` redirects to the apex, and that
`bilim-hezinisi-website.vercel.app` is kept and permanently redirects — so a future
session reading an old prompt is not confused by the old address.

Put it where a reader will actually see it (near the Project Overview or the Environment
Variables section), not buried at the bottom.

---

# TASK 4 — The PWA manifest (verify; probably no change)

`app/manifest.ts` today already has `id: "/"`, `start_url: "/"` and `scope: "/"` — all
origin-relative. **Verify this is still true and then leave it alone.**

Be honest in the report about what a new origin means and do not pretend to fix it: to a
browser, a different origin is a different web app. Anyone who installed the site from
the old origin has an installed copy belonging to that origin, with its own cache. A
stable `id` cannot carry an installation across origins; nothing can.

**Decision already taken — do not reopen it:** do **not** add an "install from the new
address" notice. The old address was never published to anyone. The owner confirmed on
2026-08-29 that he is the only person who has ever used it and that every registered
account is his own test account. There is no audience to notify, and a banner that
exists for nobody is dead code in shipped UI.

---

# TASK 5 — The service worker

`public/sw.js` has `const VERSION = "v1"`. It is mirrored in `lib/pwa/constants.ts` as
`SW_VERSION = "v1"`, and `tests/unit/sw-parity.test.ts` reads the worker's source to
prove the two copies match.

1. Bump the cache version to `v2` **in both places**, so the parity test stays green and
   `SW_CACHES` / `SW_DOCS_CACHE` stay in step.
2. Confirm the offline fallback URL and every cached path in `public/sw.js` are
   **origin-relative** (`/...`), never absolute. Fix any that are not.
3. Confirm the old caches are cleaned up on `activate` — a returning device must not sit
   on a stale shell forever.
4. Run the offline Playwright suite and report the result.

---

# TASK 6 — Redirect the old address to the new one

**This is the delicate part. The safety rules matter more than the feature.**

`bilim-hezinisi-website.vercel.app` must issue a **308 permanent redirect** to the same
path and query string on `https://bilimhezinisi.com`.

## Choose the mechanism and say why

Two options exist. **Evaluate both, choose one, and justify the choice in the report:**

- **`proxy.ts`** — it already runs on every page and API request. Being in git, it is
  reviewable, diffable and testable, and it is the only option a Playwright test can
  cover. **But note its matcher deliberately includes API routes**, so a naive
  implementation there *will* intercept `/api/health` — see the rules below.
- **Vercel's own domain redirect** on the `bilim-hezinisi-website.vercel.app` entry in
  Settings → Domains. Cleaner in some ways, but it is a dashboard setting invisible to
  the repository and untestable in CI, and the owner would have to apply it by hand.
  If you judge this to be better, say so plainly and give him exact button names in
  Uyghur — **do not silently assume he will do it.**

## The safety rules — every one of these needs a test

1. **Fires only for the exact old production hostname**
   `bilim-hezinisi-website.vercel.app`. Match the host exactly; never match on a
   `.vercel.app` suffix.
2. **Never fires for a Vercel preview host.** Previews look like
   `bilim-hezinisi-website-git-<branch>-kelemdepter-s-projects.vercel.app` and
   `bilim-hezinisi-website-<hash>-kelemdepter-s-projects.vercel.app` (both were observed
   on the last deployment). If previews redirect, every preview becomes untestable.
   **A test must prove a preview host is NOT redirected.**
3. **Never fires for `localhost`** (any port) or for the Playwright host.
   `playwright.config.ts` uses `http://localhost:3000` for dev and `http://localhost:3100`
   for the production-build run. If either redirects, local development and the whole
   test suite break.
4. **Path and query string are preserved**, so a link someone already shared to a book
   still lands on that book. `.../books/72?x=1` → `https://bilimhezinisi.com/books/72?x=1`.
5. **`/api/health` must keep answering on whichever host the daily cron calls.**
   This is not optional: `vercel.json` schedules `{ "path": "/api/health", "schedule":
   "0 6 * * *" }`, and that daily request is the only thing stopping the Supabase free
   project from pausing after ~7 idle days — which would take the library offline.
   `app/api/health/route.ts` authenticates the cron with a `Bearer` token in the
   `Authorization` header. **A redirect must not swallow that request or drop that
   header.** Determine what host Vercel Cron actually calls, exempt `/api/health`
   explicitly if there is any doubt, and **prove with a test that it still returns 200
   on both hosts with a valid token and 401 without one.** Say in the report exactly how
   you verified this — "it should be fine" is not verification.
6. The redirect must not interfere with the Supabase auth callback on the old host
   (`/auth/callback`, `/auth/confirm`). A link in an email already sent must still work:
   landing on the old host and being 308'd to the same path on the new host is
   acceptable **only if** the query string survives intact. Check this explicitly and
   report it.

---

# TASK 7 — Tests (mandatory)

- `npm run typecheck && npm run lint && npm run build` — all green.
- Every existing unit and Playwright suite green at **375×667, 390×844 and 1280×800**,
  including the offline, AI and spellcheck suites. Do not skip a suite because it is slow.
- **New tests:**
  - the old production host redirects with **308**, path and query preserved;
  - a **preview** host is not redirected;
  - `localhost:3000` and `localhost:3100` are not redirected;
  - `/api/health` answers on both hosts (200 with a valid token, 401 without);
  - `siteUrl()` emits the new domain, and emits it deterministically when `SITE_URL` is
    absent (per Task 2);
  - no `vercel.app` string appears in any user-facing output — page HTML, canonical tags,
    OG tags, `sitemap.xml`, `robots.txt`, `feed.xml`, the manifest.
- Assert no horizontal overflow at 360 px, and that key controls stay visible and
  clickable after scrolling down then back up. The Mobile Rules in `CLAUDE.md` are hard
  requirements.

---

# Acceptance criteria — someone must be able to check these without trusting you

1. `https://bilimhezinisi.com` serves the library over HTTPS with a valid certificate,
   and the library was never offline.
2. `https://www.bilimhezinisi.com` redirects to the apex.
3. `https://bilim-hezinisi-website.vercel.app/books/72` returns **308** to
   `https://bilimhezinisi.com/books/72` — path preserved. A query string survives too.
4. A Vercel **preview deployment** URL still serves normally and is **not** redirected.
5. Register, confirm, sign in, sign out and reset a password all work, and every email
   link points at the new domain.
6. Anonymous browsing, reading, search, Qur'an, the reader and the notebook all work.
7. Offline reading works on the new origin.
8. No CSP violations in the console on home, reader, search, Qur'an, notebook, `/about`,
   `/privacy` and `/my/ai`. The CSP names Google exactly once, in `connect-src`.
9. `/robots.txt`, `/sitemap.xml`, `/feed.xml`, the canonical tags and the OG tags all
   emit `bilimhezinisi.com` and nothing else.
10. `/api/health` answers, and the daily cron will still reach it.
11. Still free: Supabase Free, Vercel Hobby, no new paid service, no new vendor account.
12. Nothing from Phases 1–21 regressed. RLS, role checks and the AI layer are untouched.

---

# TASK 8 — Committing (read this BEFORE your first `git add`)

**The working tree is not clean, and the noise is not yours to fix.**

`git status` reports roughly 54 modified files across `app/`, `lib/`, `components/`, plus
`.gitignore`, `PROMPT-14.md` and `PROMPT-16.md`. This is **not work in progress**:
`git diff --ignore-cr-at-eol` comes back **empty**, so every one of those "changes" is a
CRLF/LF line-ending difference and nothing else. The repository has no `.gitattributes`
and `core.autocrlf` is unset.

Rules:

1. **Never run `git add -A`, `git add .`, or `git commit -a`.** Stage only the exact
   files you changed, by path. A single careless `git add -A` would bury a four-file
   change inside a ten-thousand-line diff nobody can review.
2. **Do not "fix" the line endings, and do not add a `.gitattributes` as part of this
   task.** It is a separate decision the owner has not asked for. Raise it in the report
   as a suggestion for another day, with the trade-offs, and leave it alone.
3. `.claude/settings.local.json` is gitignored and must stay out of every commit.
   There is also a `.git/STALE-index.lock.delete-me` left over from a tooling accident —
   it is inert, ignore it, and do not commit anything from `.git/`.
4. **`git push` triggers a production deploy on Vercel.** Ask the owner in Uyghur before
   pushing, and tell him plainly what is about to go live. He will be prompted for
   approval by Claude Code as well — do not treat that prompt as the whole conversation.

---

# Reporting

Commit per logical step, English conventional messages, one logical change each.

Final report in **simple Uyghur**, covering:

1. every `vercel.app` hit, and how you classified it — including every one you
   deliberately left, and why;
2. which mechanism you chose for the redirect, and why you rejected the other;
3. exactly how you verified that `/api/health` and the daily cron still work;
4. what you decided about `siteUrl()`'s fallback, and why;
5. every file that changed;
6. the test results, viewport by viewport;
7. a numbered list of anything the owner must still do himself.

---

# Flag, do not change

- The **Android app** is a separate project at
  `E:\ditallar\men yasigan ditallar\BilimHezinisi-Mobile(...)`. If it references the
  website URL anywhere, it needs its own update **in that project**. Report it; do not
  touch it here.
- The **desktop repo is read-only**. If its About dialog, README or Microsoft Store
  listing mentions the old address, report it so the owner can handle it there.
- **Google Search Console** is the owner's own step and is deliberately not automated.

---

**If any step would take the site offline, break an authentication email link, disable
`/api/health`, weaken the CSP, or cost money — stop and explain it to the owner in simple
Uyghur rather than proceeding. If a requirement here conflicts with `CLAUDE.md`,
`CLAUDE.md` wins; say so rather than silently trading away quality.**
