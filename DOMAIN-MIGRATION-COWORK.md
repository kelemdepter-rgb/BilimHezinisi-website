# يېڭى Cowork تۈرى — دومېننى كۆچۈرۈش (bilimhezinisi.com)

## قانداق ئىشلىتىسىز

1. Cowork تا **يېڭى تۈر** (ياكى يېڭى سۆزلىشىش) ئېچىڭ.
2. بىر قىسقۇچنى تاللاڭ:
   `E:\ditallar\men yasigan ditallar\BilimHezinisi-website`
3. Hostinger، Vercel ۋە Supabase تاختىلىرىنى **ئۆزىڭىز ئىشلىتىدىغان توركۆرگۈدە**
   (Firefox بولسىمۇ بولىدۇ) ئېچىپ، ھېساباتلىرىڭىزغا كىرگەن بولۇڭ.
4. سىزىقتىن تۆۋەنكى تېكىستنى پۈتۈنلەي كۆچۈرۈپ چاپلاڭ.

> **بۇ تۈر نېمە قىلىدۇ:** سىزنى قەدەممۇ-قەدەم يېتەكلەيدۇ. ھەر بىر قەدەمدىن كېيىن
> **تەكشۈرىدۇ**، ئاندىن كېيىنكىسىگە ئۆتىدۇ. كود ئۆزگەرتىش قىسمى ئەڭ ئاخىرىدا،
> يېڭى دومېن ئىشلەۋاتقانلىقى ئىسپاتلانغاندىن **كېيىن** Claude Code قا بېرىلىدۇ.
>
> **باشقۇرۇش تاختىلىرىدىكى چېكىشلەرنى ئۆزىڭىز قىلىسىز.** Cowork نىڭ توركۆرگۈ
> قورالى پەقەت Chrome بىلەن ئىشلەيدۇ، سىزنىڭ تاختىلىرىڭىز Firefox تا. شۇڭا ئۇ
> سىزگە قەيەرنى بېسىشنى ئېيتىدۇ، سىز قىلىسىز، ئاندىن ئۇ نەتىجىنى **تور ئارقىلىق
> ئۆزى تەكشۈرىدۇ**. بۇ تېخىمۇ بىخەتەر — ھېساباتلىرىڭىزغا ھېچكىم كىرمەيدۇ.
>
> **سايت بىر مىنۇتمۇ توختىمايدۇ.** كونا ئادرېس ھەرگىز ئۆچۈرۈلمەيدۇ.

---

You are running a **live domain migration** for a public library that people are using
right now. The owner is **not a programmer**. Your job is to walk him through it one step
at a time in simple Uyghur, verify each step yourself before moving on, and hand the code
half to Claude Code only at the end.

## The prime directive

**The library must never go offline, and no reader may ever be locked out of their
account.** Everything below is designed around that. This is an **additive migration, not
a cutover**:

- the old address `bilim-hezinisi-website.vercel.app` is **never deleted**;
- both addresses are allowed in Supabase during the transition;
- the redirect from old to new is written **last**, only after the new domain is proven to
  serve the real site over HTTPS.

If a step cannot be completed safely, **stop and say so**. Never guess a DNS value, never
invent an IP address, never skip a verification.

## Project context

**«بىلىم خەزىنىسى» (Bilim Hezinisi)** — a free public Uyghur digital library.
Next.js 16 (App Router) + TypeScript + Tailwind on **Vercel Hobby**, Supabase Free.
GitHub `kelemdepter-rgb/BilimHezinisi-website`. Repo folder: `BilimHezinisi-website`.

Phases 1–21 are complete and deployed: library, reader, exact-phrase search, Qur'an,
notebook with Uyghur spellcheck, PWA with offline reading, book download and sharing,
discovery pages (`/authors`, `/new`, `/feed.xml`, `/request`), licence and trust pages
(`/about`, `/privacy`, password reset, account deletion, nonce-based CSP), a browser-only
bring-your-own-key Gemini AI layer, and the two recent repairs — **PROMPT-20** (AI answer
quality) and **PROMPT-21** (navigation speed) — **both already applied and live**.

- **Current address:** `https://bilim-hezinisi-website.vercel.app`
- **Target address:** `https://bilimhezinisi.com`
- Registered at **Hostinger**. Status confirmed **«Etkin»** (active), expiry 2029-08-29,
  auto-renew on. The ICANN verification is already done.

**`PROMPT-22.md` in the repo root is the reference plan for this migration. Read it
first.** You are executing its dashboard half yourself with the owner, and producing its
code half as a separate, later prompt. Also read `CLAUDE.md` — it is the project
instruction and always wins.

## Constraints that do not move

- **No budget, ever.** Supabase Free and Vercel **Hobby**. The domain is already paid for
  and is the owner's only cost. Vercel Hobby allows **50 custom domains per project** and
  issues the TLS certificate automatically at no charge. If anything asks for money, stop.
- Anonymous browsing, reading and search keep working with no account, throughout.
- Do not touch RLS, role checks, the CSP, the AI layer, or anything unrelated to the
  domain.
- RTL Uyghur UI; code, comments and commit messages in English.
- Never edit an applied migration in `supabase/migrations/`.

## Who does what — read this before you plan anything

**You cannot open his dashboards.** The owner keeps Hostinger, Vercel and Supabase signed
in on **Firefox**, and the browser automation available to you drives **Chrome only**. Do
not ask him to switch browsers, and do not try to reach those dashboards yourself.

The division of labour is therefore fixed:

| Who | Does what |
|---|---|
| **The owner**, in his own Firefox | Every click inside Hostinger, Vercel and Supabase. Every value read off those screens. |
| **You** | Tell him exactly what to click. Then verify the *result* from the public internet — fetch the URL, read what came back, check the headers and the redirect. |

This is the safer arrangement anyway: nothing ever reaches into his accounts.

What that means in practice:

- **Ask him to paste values back to you.** When Vercel shows the DNS records, ask him to
  copy them into the chat exactly as written. **Never fill in a value he has not given
  you** — no IP address, no CNAME target, from documentation or from memory.
- **Ask for a screenshot when a status is ambiguous** ("valid configuration" vs "invalid
  configuration", a certificate state, a list of DNS records). Reading a screenshot is
  reliable; guessing is not.
- **Verify everything you can from outside.** Fetching `https://bilimhezinisi.com` and
  reading what comes back tells you whether DNS resolved, whether the certificate is
  valid, whether the site or a parking page is being served, and what the redirect does.
  Use that as your proof at every gate, and say what you actually saw.
- If a check genuinely cannot be done from outside, say so plainly and ask him to look —
  do not quietly assume it passed.

## How to work with the owner

- **Simple Uyghur**, one step at a time.
- **Exact button names.** Hostinger's interface is in Turkish, Vercel's and Supabase's in
  English — give the label he will actually see, and the Uyghur meaning beside it.
- **Never put three dashboard steps in one message.** One action, then wait.
- After each step ask him to confirm, then verify the result from outside before you say
  the step is done.
- Tell him plainly at each step what would happen if it went wrong, and that nothing so
  far is irreversible.

---

# The order of operations — do not reorder any of this

## STEP 0 — One decision, asked once

Ask the owner which address should be the real one people see:

- **`bilimhezinisi.com`** (recommended) — shorter, and what someone will say out loud.
  `www.bilimhezinisi.com` then redirects to it.
- **`www.bilimhezinisi.com`** — Vercel's own documentation prefers a `www` primary for CDN
  reasons.

Give him the one-sentence trade-off, recommend the first, take his answer, and write it
down. Everything afterwards follows that choice.

## STEP 1 — Vercel: add the domain

Nothing breaks here; the site keeps serving from the old address.

1. Vercel → the project → **Settings** → **Domains** → **Add Domain**.
2. Add **`bilimhezinisi.com`**. Vercel will offer **`www.bilimhezinisi.com`** as well —
   add both, and set the non-canonical one to redirect to the canonical one from Step 0.
3. **Do not remove `bilim-hezinisi-website.vercel.app`.** It stays in the project.
4. Vercel now displays the **exact DNS records** to create: an **A** record for the apex
   and a project-specific **CNAME** for `www`.

**Ask the owner to copy those values out of Vercel and paste them into the chat, exactly
as shown** — record type, name, and value. They are per-project and they change over
time. **Never supply a DNS value he has not given you**, from documentation, from a blog,
from this prompt, or from memory. If what he pastes looks incomplete or ambiguous, ask
for a screenshot of that panel rather than filling in the gap yourself.

## STEP 2 — Hostinger: point the DNS

Recommend **keeping Hostinger's own nameservers and editing the DNS records there**,
rather than moving nameservers to Vercel — fewer moving parts, and he keeps Hostinger DNS
if he ever wants email on the domain. Explain that in one sentence and let him choose.

Guide him, one action per message:

1. Hostinger → **Domainler** → `bilimhezinisi.com` → **Yönet**.
2. Open the **DNS** section (DNS / Nameservers).
3. **Delete the parking records** Hostinger created — any existing `A` or `CNAME` for `@`
   and for `www` that points at Hostinger's placeholder page.
4. Add exactly the records Vercel showed in Step 1.
5. **Check the CAA records.** If a CAA record exists that does not permit
   `letsencrypt.org`, Vercel cannot issue the certificate. If you find one, tell him what
   it says and what to change. If there is none, say so — no CAA record is fine.

## STEP 3 — Wait, then prove it actually works

**This is the gate. Do not pass it on hope.**

1. Ask the owner to return to Vercel → Settings → Domains and tell you what each entry
   says. Wait until both report a **valid configuration**. If the wording is ambiguous,
   ask for a screenshot. Vercel then issues the TLS certificate by itself.
2. Tell him that DNS can take anywhere from a few minutes to a day, so a delay is normal
   and not a failure. Do not let him "fix" it by changing records while it propagates —
   that is how people break a migration that was already working.
3. **Verify from the public internet yourself**, and report exactly what came back:
   - `https://bilimhezinisi.com` loads **the library** — not a Hostinger parking page,
     not a Vercel 404. Say which you saw.
   - the fetch succeeds over HTTPS at all, which is what tells you the certificate is
     valid — a bad or missing certificate fails the request.
   - the non-canonical host (`www`, or the apex) redirects to the canonical one.
   - a deep link works: fetch a real book page by URL on the new domain and confirm the
     book's content comes back.
4. Ask the owner to open `https://bilimhezinisi.com` in his own Firefox and confirm the
   padlock shows no warning — that is the one check you cannot make from outside.

**Do not continue to Step 4 until all of these are true.** If the site loads but shows a
parking page, DNS has not finished or a Hostinger record was left behind — go back to
Step 2, do not proceed.

## STEP 4 — Supabase Auth (the one step that can lock someone out)

If this is wrong, password-reset and confirmation emails point at a dead address and a
reader loses access to their bookmarks and notes. Do it carefully, then test it for real.

1. Supabase → **Authentication** → **URL Configuration**:
   - **Site URL** → `https://bilimhezinisi.com` (or the canonical chosen in Step 0)
   - **Redirect URLs** — the allow list must contain **all four**:
     - `https://bilimhezinisi.com/**`
     - `https://www.bilimhezinisi.com/**`
     - `https://bilim-hezinisi-website.vercel.app/**` ← **keep this.** Emails already sent
       still point at the old address, and removing it would break them.
     - `http://localhost:3000/**` ← local development
2. Check **Authentication → Emails** for any template that hardcodes a URL instead of
   using the template variable. Fix any you find.
3. **Test for real.** The owner runs this in his own browser, with a throwaway address he
   does not mind using; you tell him each step and read what he reports:
   - register → ask him to **paste the confirmation link from the email** (not the
     password, just the link) so you can see which domain it points at — then he clicks
     it and tells you whether it worked;
   - request a password reset → same: paste the link, check the domain, then use it;
   - sign in, sign out, sign in again.

Report what was actually observed, not what you expected. **If any link still carries the
old address, stop.** Find out why before continuing — this is the one failure that locks
readers out.

## STEP 5 — The environment variable

1. Vercel → **Settings** → **Environment Variables** → set **`SITE_URL`** to the canonical
   address, for **Production**.
2. Trigger a redeploy — the change only takes effect on a new deployment. Explain that.
3. Verify on the live site that the canonical tags, `/sitemap.xml`, `/robots.txt` and
   `/feed.xml` now all emit the new domain.

`SITE_URL` feeds `lib/seo.ts` `siteUrl()`, which drives `metadataBase`, every canonical,
the sitemap, robots, the OG images, the JSON-LD and the Atom feed.

## STEP 6 — Only now, hand the code half to Claude Code

Everything up to here was dashboards. The remaining work is code, and the most delicate
part of it — the redirect — must not be written before the new domain is proven, which is
why it waits until now.

Write **`PROMPT-23.md`** into the repo folder and deliver it to the owner, in the house
style used by `PROMPT-1.md` … `PROMPT-22.md`: a short Uyghur header explaining how to use
it, then a fully self-contained English prompt for a fresh Claude Code session with no
memory. It must cover:

1. **Find every old reference.** Grep the repository for
   `bilim-hezinisi-website.vercel.app` and for `vercel.app`; list every hit and classify
   it as must-change, must-stay, or historical record.
2. **Change what a visitor or a search engine can see**, and anything runtime:
   `lib/seo.ts` including its hardcoded fallback, `CLAUDE.md`, `README.md`, `docs/`,
   `playwright.config.ts` if it names the host, `lib/security/csp.ts` if it does, and any
   script.
3. **Leave `PROMPT-1.md` … `PROMPT-22.md` alone** — they are the project's history.
   Instead add one dated line to `CLAUDE.md` recording that the site moved to
   `bilimhezinisi.com` on this date and that the old address redirects, so a future
   session reading an old prompt is not confused.
4. **The PWA manifest.** A new origin is a different web app to the browser. Set a stable
   `id` in `app/manifest.ts` if there is not one, and make `start_url` and `scope`
   origin-relative so this never has to be touched again.
5. **The service worker.** Bump the cache version in `public/sw.js` and confirm the
   offline fallback URL is origin-relative.
6. **The redirect** — `bilim-hezinisi-website.vercel.app` issues a **308 permanent
   redirect** to the same path and query string on the new domain. `proxy.ts` already runs
   on every request and is the natural place, unless Vercel's own domain redirect is
   cleaner; the prompt must require Claude Code to choose and to say which and why. The
   safety rules are the point of this item:
   - fires **only** for the exact old production hostname;
   - **never** for a Vercel preview host (`*-git-*.vercel.app` and hashed preview URLs),
     or every preview becomes untestable;
   - **never** for `localhost` or the Playwright host, or local development and the whole
     test suite break;
   - **path and query preserved**, so a shared link to a book still lands on that book;
   - `/api/health` keeps answering on whichever host the daily Vercel cron calls, so the
     Supabase project never pauses — verified explicitly;
   - a test proving each of these, including that a preview host is **not** redirected.
7. **Tests**: `npm run typecheck && npm run lint && npm run build` green; every existing
   unit and Playwright suite green at **375×667, 390×844 and 1280×800**, including the
   offline, AI and spellcheck suites.
8. **Acceptance criteria** someone could check without trusting the author, and a closing
   instruction to **stop and ask the owner in Uyghur** rather than silently trading away
   quality.

Restate the non-negotiable constraints inside that prompt — no budget, never offline,
never break an auth email, do not weaken the CSP, do not touch RLS or roles, desktop repo
read-only.

## STEP 7 — After Claude Code has finished

Verify the whole thing and report what you saw. Items 1–4 and 9–10 you can check yourself
by fetching the public URLs; items 5–8 need the owner to look, so tell him exactly what to
do and what a good result looks like:

1. `https://bilimhezinisi.com` serves the library over HTTPS with a valid certificate.
2. The non-canonical host redirects to the canonical one.
3. `https://bilim-hezinisi-website.vercel.app/books/<some id>` returns **308** to the same
   book on the new domain — path preserved.
4. A Vercel **preview deployment** URL still serves normally and is **not** redirected.
5. Register, confirm, sign in, sign out and reset a password — every email link points at
   the new domain and works.
6. Anonymous browsing, reading, search, Qur'an, the reader and the notebook all work.
7. Offline reading works on the new origin.
8. No CSP violations in the console on home, reader, search, Qur'an, notebook, `/about`,
   `/privacy` and `/my/ai`.
9. `/robots.txt`, `/sitemap.xml`, `/feed.xml`, the canonical tags and the OG tags all emit
   the new domain and nothing else.
10. `/api/health` answers.

Then, in simple Uyghur with exact button names, walk him through:

- adding `bilimhezinisi.com` as a new property in **Google Search Console** and submitting
  `https://bilimhezinisi.com/sitemap.xml`. The 308 is what carries the existing search
  ranking across, so this is a formality, not a rescue.
- **Flag, do not change:** the **Android app** is a separate project at
  `E:\ditallar\men yasigan ditallar\BilimHezinisi-Mobile(...)`. If it references the
  website URL anywhere, it needs its own update in that project. The **desktop repo is
  read-only** — if its About dialog, README or store listing mentions the old address,
  report it so he can handle it there.

## Rollback — tell him this early, so he is not anxious

- **Before Step 6**, rolling back means doing nothing at all: the old address is still the
  live one and everything keeps working.
- **After Step 6**, rolling back means reverting one commit — the redirect.
- At no point is anything irreversible, and at no point is the library offline.

## Never

- Never delete `bilim-hezinisi-website.vercel.app` from the Vercel project.
- Never remove the old address from Supabase's redirect allow list during this migration.
- Never hardcode a DNS value from memory, from documentation, or from this prompt.
- Never write the redirect before the new domain is proven to serve the site.
- Never touch RLS, role checks, the CSP, or the AI layer.
- Never spend money, and never propose a paid plan.

---

Start by reading `PROMPT-22.md` and `CLAUDE.md`, then confirm to the owner in Uyghur what
you are about to do and ask him the one question in Step 0.
