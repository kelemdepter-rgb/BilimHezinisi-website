# PROMPT 22 — سايتنى ئۆز دومېنىغا كۆچۈرۈش (bilimhezinisi.com)

## قانداق ئىشلىتىسىز (يېڭى تۈر ئېچىپ)
1. Claude Code نى ئېچىپ **BilimHezinisi-website** قىسقۇچىنى تاللاڭ.
2. سىزىقتىن تۆۋەنكى تېكىستنى پۈتۈنلەي كۆچۈرۈپ چاپلاڭ.

> **مۇھىم — ئالدىن ئوقۇڭ:** Hostinger دا دومېننىڭ ھالىتى ھازىر **«Onay bekliyor»**
> (تەستىق كۈتۈۋاتىدۇ). ئۇ **«Aktif»** بولمىغۇچە DNS ئىشلىمەيدۇ. ئېلخېتىڭىزنى ئېچىپ
> Hostinger دىن كەلگەن تەستىق ئۇلانمىسىنى بېسىڭ. ICANN نىڭ قائىدىسى بويىچە بۇ
> **15 كۈن** ئىچىدە قىلىنمىسا دومېن ۋاقىتلىق توختىتىلىدۇ.
>
> **ئەندىشە قىلمىسىڭىزمۇ بولىدۇ:** بۇ بۇيرۇق **كونا ئادرېسنى ئۆچۈرمەيدۇ**. سايت
> پۈتۈن جەريان جەريانىدا ئىشلەپ تۇرىدۇ؛ يېڭى دومېن تەييار بولغاندىلا كونىسى يېڭىسىگە
> يۆتكەيدىغان بولىدۇ.

---

You are continuing an existing, live project. Read `CLAUDE.md` in this folder FIRST —
it is the project instruction and always wins — and use the **bilim-web** skill.

## What this task is

The owner bought **`bilimhezinisi.com`** from Hostinger. The site currently lives at
`https://bilim-hezinisi-website.vercel.app`. Move it to the new domain **without ever
taking the library offline and without breaking authentication email links**.

This is an **additive migration, not a cutover**. At every step the site must keep
working. The old address is never deleted; it ends up permanently redirecting to the new
one.

## Project context
Next.js 16 (App Router) + TypeScript + Tailwind on **Vercel Hobby**, Supabase Free.
GitHub `kelemdepter-rgb/BilimHezinisi-website`. Phases 1–21 are complete and deployed:
library, reader, exact-phrase search, Qur'an, notebook with spellcheck, PWA with offline
reading, book download and sharing, discovery pages (authors, `/new`, `/feed.xml`, book
requests), licence and trust pages (`/about`, `/privacy`, password reset, account
deletion, security headers with a nonce-based CSP), and a browser-only bring-your-own-key
Gemini AI layer.

`SITE_URL` is the environment variable that feeds `lib/seo.ts` `siteUrl()`, which in turn
drives `metadataBase`, every canonical, the sitemap, robots, the OG images, the JSON-LD
and the Atom feed. `proxy.ts` runs on every page and API request.

## Non-negotiable constraints
- **No budget, ever.** Supabase Free and Vercel **Hobby**. The domain is already paid for
  and is the owner's only cost; nothing else may cost anything. Vercel Hobby allows **50
  custom domains per project** and issues the SSL certificate automatically — confirm
  this stays free and report if anything asks for money.
- **The library must never be offline**, not for a minute, at any point in this task.
- **Authentication email links must never break.** A password-reset or confirmation email
  pointing at a dead URL locks a reader out of their bookmarks and notes.
- Anonymous browsing, reading and search keep working with no account.
- RTL Uyghur UI; code, comments and commit messages in English.
- Do not weaken the CSP or the security headers. Do not touch RLS or role checks.
- The desktop repo is a read-only reference.

---

# PHASE 0 — Preconditions (guide the owner, in Uyghur, before you change anything)

1. **The domain must be active.** Hostinger currently shows the status **«Onay bekliyor»**
   for `bilimhezinisi.com`. Explain in simple Uyghur, with exact button names, how to:
   - open the mailbox used to register the domain and click the verification link;
   - check the status at **Hostinger → Domainler → Domain arama / Alan Adı listesi**,
     where it must read **«Aktif»**.
   State plainly that ICANN requires this within **15 days** or the domain is suspended,
   and that DNS will not resolve until it clears.
2. **Do not begin Phase 2 until the status is «Aktif».** Phases 1, 3, 4 and 5 are safe to
   prepare beforehand; Phase 2 is the one that needs a live domain.
3. Ask the owner to confirm the status before you proceed, and say so in your report.

---

# PHASE 1 — Vercel: add the domain (nothing breaks)

Walk the owner through this in Uyghur with exact button names; do it yourself where you
have access.

1. Vercel → the project → **Settings** → **Domains** → **Add Domain**.
2. Add **`bilimhezinisi.com`**. Vercel will offer to add **`www.bilimhezinisi.com`** as
   well — add both.
3. **Choose the canonical host and say why.** Recommend the apex `bilimhezinisi.com` as
   the address people see and type, with `www.bilimhezinisi.com` set to **redirect** to
   it. Note honestly in the report that Vercel's own documentation prefers `www` as the
   primary for CDN reasons; if you believe that outweighs a shorter address for a public
   library, say so and let the owner decide rather than choosing silently.
4. Vercel then displays the **exact DNS records** to create — an **A** record for the
   apex and a project-specific **CNAME** for `www`.
   **Read those values from the dashboard. Never hardcode an IP address or a CNAME target
   from documentation, from memory, or from this prompt** — they are per-project and they
   change.
5. Do **not** remove `bilim-hezinisi-website.vercel.app` from the project. It stays, and
   in Phase 6 it becomes a redirect.

---

# PHASE 2 — Hostinger: point the DNS (only once the status is «Aktif»)

Two routes exist. **Recommend keeping Hostinger's DNS and adding records**, not moving
nameservers to Vercel: fewer moving parts, and the owner keeps Hostinger's DNS if he ever
wants email on the domain. Explain the trade-off in one sentence and let him choose.

Guide him in Uyghur, one step at a time:

1. Hostinger → **Domainler** → `bilimhezinisi.com` → **Yönet** → the **DNS** section.
2. Remove any parking or placeholder **A** / **CNAME** record Hostinger created for `@`
   and `www`.
3. Add exactly the records Vercel showed in Phase 1.
4. Return to Vercel → Settings → Domains and wait until both entries report a valid
   configuration. Vercel then issues the TLS certificate by itself — this is free and
   needs no action.
5. DNS can take from a few minutes to a day to propagate. Tell him that plainly so a
   delay does not look like a failure, and tell him how to check.

**Nothing in the codebase changes in this phase, and the site keeps serving from the old
address throughout.**

---

# PHASE 3 — The environment variable

1. Vercel → **Settings** → **Environment Variables** → set **`SITE_URL`** to
   `https://bilimhezinisi.com` for **Production**.
2. Confirm what else reads it. At minimum verify `lib/seo.ts` `siteUrl()`, and that its
   hardcoded fallback (used when the variable is missing) is also updated so a
   misconfigured deploy cannot silently re-advertise the old address.
3. A new deployment is required for the change to take effect. Say so.

---

# PHASE 4 — Supabase Auth (get this wrong and password reset breaks)

This is the step most likely to lock a reader out. Do it carefully and test it.

1. Supabase → **Authentication** → **URL Configuration**:
   - **Site URL** → `https://bilimhezinisi.com`
   - **Redirect URLs** — the allow list must contain **all** of:
     - `https://bilimhezinisi.com/**`
     - `https://www.bilimhezinisi.com/**`
     - `https://bilim-hezinisi-website.vercel.app/**` *(keep during the transition, so a
       link in an email already sent still works)*
     - `http://localhost:3000/**` *(local development)*
2. Check **Authentication → Emails** for any template that hardcodes a URL rather than
   using the template variable, and fix it.
3. Re-read `app/(auth)/actions.ts`, `app/auth/callback/route.ts` and
   `app/auth/confirm/route.ts`: any redirect base they compute must come from the
   configured site URL, never from a hardcoded string and never from an untrusted request
   header.
4. **Test all of it for real** on the new domain, with a throwaway account:
   - register → the confirmation email link points at `bilimhezinisi.com` and works;
   - request a password reset → the link points at `bilimhezinisi.com` and works;
   - sign in, sign out, sign in again.
   Report what you actually saw, not what you expect.

---

# PHASE 5 — The codebase

1. **Grep the whole repository** for `bilim-hezinisi-website.vercel.app` and for
   `vercel.app`. List every hit and classify each as: must change, must stay, or
   historical record.
2. **Must change** — anything a visitor or a search engine can see, and anything runtime:
   `lib/seo.ts` (including its fallback), `CLAUDE.md`, `README.md`, `app/manifest.ts`,
   `public/sw.js`, `lib/security/csp.ts` if it names the host, `playwright.config.ts` if
   it does, `docs/`, and any script.
3. **Must stay** — `PROMPT-1.md` … `PROMPT-21.md` are the project's history and are not
   rewritten. Instead, add one dated line to `CLAUDE.md` recording that the site moved to
   `bilimhezinisi.com` on this date and that the old address redirects, so a future
   session reading an old prompt is not confused.
4. **The PWA manifest.** Changing origin makes this a different web app to the browser.
   Set a stable `id` in `app/manifest.ts` if there is not one already, and make sure
   `start_url` and `scope` are origin-relative rather than absolute, so this never has to
   be touched again.
5. **The service worker.** Bump the cache version so returning readers get a clean cache
   on the new origin, and confirm the offline fallback URL is origin-relative.
6. Verify that `app/robots.ts`, `app/sitemap.ts`, `app/feed.xml/route.ts`,
   `app/opengraph-image.tsx` and every page's canonical all derive from `siteUrl()` and
   now emit the new domain.

---

# PHASE 6 — Redirect the old address to the new one

Only after the new domain is serving correctly over HTTPS.

Make `bilim-hezinisi-website.vercel.app` issue a **308 permanent redirect** to the same
path and query string on `https://bilimhezinisi.com`. `proxy.ts` already runs on every
request and is the natural place, unless you judge Vercel's own domain redirect to be
cleaner — choose, and say which you chose and why.

**The safety rules here matter more than the feature:**

- The redirect fires **only** for the exact old production hostname.
- It must **never** fire for a Vercel **preview deployment** host (the
  `*-git-*.vercel.app` and hashed preview URLs), or every preview becomes untestable.
- It must **never** fire for `localhost` or for the Playwright test host, or local
  development and the whole test suite break.
- The **path and query string are preserved**, so a link someone already shared to a book
  or a specific page still lands on that book or page.
- `/api/health` must keep answering on whichever host the daily Vercel cron calls, so the
  Supabase project never pauses. Verify this explicitly.
- Add a test that proves each of these, including that a preview host is not redirected.

---

# PHASE 7 — Readers who already installed the app (be honest about this)

A service worker belongs to one origin. Anyone who added the site to their home screen
from `bilim-hezinisi-website.vercel.app` has an installed copy pointing at the old origin,
with its own cache.

- Nothing breaks: they will be redirected, and the site will work.
- But their installed shortcut still opens the old origin first, and their offline cache
  is on the old origin.
- Decide whether a one-time, dismissible Uyghur notice is worth showing to visitors who
  arrive via the redirect, inviting them to re-install from the new address. Judge it, do
  it or skip it, and explain the reasoning in the report. Do not ship a notice that
  appears on every visit.

---

# PHASE 8 — Search engines

1. The 308 redirect is what preserves the site's existing search ranking — confirm it is
   a **308 or 301**, never a 302 or 307.
2. Tell the owner in Uyghur, step by step, how to add `bilimhezinisi.com` as a new
   property in **Google Search Console** and submit `https://bilimhezinisi.com/sitemap.xml`.
3. Verify by fetching them that `/robots.txt`, `/sitemap.xml` and `/feed.xml` on the new
   domain all reference the new domain and nothing else.

---

# PHASE 9 — Flag, do not change

- The **Android app** is a separate project at
  `E:\ditallar\men yasigan ditallar\BilimHezinisi-Mobile(...)`. If it references the
  website URL anywhere, it needs its own update. **Report it; do not touch it here.**
- The **desktop app repo is read-only**. If its About dialog, README or store listing
  mentions the old address, report it so the owner can handle it in that project.

---

# Verification before you call this done

Check each of these against the real, deployed site and report what you saw:

1. `https://bilimhezinisi.com` serves the library over HTTPS with a valid certificate.
2. `https://www.bilimhezinisi.com` redirects to the canonical host.
3. `https://bilim-hezinisi-website.vercel.app/books/<some id>` returns **308** to
   `https://bilimhezinisi.com/books/<same id>` — path preserved.
4. A Vercel **preview deployment** URL still serves normally and is **not** redirected.
5. Register, confirm, sign in, sign out and reset a password — every email link points at
   the new domain and works.
6. Anonymous browsing, reading, search, Qur'an, the reader and the notebook all work on
   the new domain.
7. Offline reading still works on the new origin.
8. The AI settings page loads and the CSP still names Google exactly once, in
   `connect-src`. No CSP violations in the console on home, reader, search, Qur'an,
   notebook, `/about`, `/privacy` and `/my/ai`.
9. `/robots.txt`, `/sitemap.xml`, `/feed.xml`, the canonical tags and the OG tags all emit
   `bilimhezinisi.com`.
10. `/api/health` answers, and the daily cron will still reach it.

# Tests and reporting (mandatory)

- `npm run typecheck && npm run lint && npm run build` all pass.
- Every existing unit and Playwright suite stays green at **375×667, 390×844 and
  1280×800**, including the offline, AI and spellcheck suites.
- New tests: the old production host redirects with the path preserved; a preview host and
  `localhost` do **not**; `siteUrl()` emits the new domain; no `vercel.app` string remains
  in any user-facing output.
- Final report in **simple Uyghur**:
  1. what the Hostinger status was when you started and whether the owner cleared it;
  2. exactly which DNS records were created, and where;
  3. which host is canonical and why;
  4. what changed in Supabase, and the result of the real register / reset test;
  5. every file that changed, and every `vercel.app` reference you deliberately left;
  6. whether an installed-PWA notice was added, and why;
  7. a numbered list of what the owner must still do himself — the Search Console steps,
    and the Android app.

# Acceptance criteria
- The library is reachable at `https://bilimhezinisi.com` with a valid certificate, and
  was never offline during the migration.
- Every old link still works and lands on the same page at the new domain.
- No reader can be locked out: confirmation and password-reset emails point at the new
  domain and were tested for real.
- Preview deployments and local development are unaffected.
- Nothing from Phases 1–21 regressed; the CSP was not weakened; RLS and role checks are
  untouched.
- Still free: Supabase Free, Vercel Hobby, no new paid service, no new vendor account.

Commit per logical step with English conventional messages. **If any step would take the
site offline, break an authentication email, or cost money, stop and explain it to the
owner in Uyghur rather than proceeding.**
