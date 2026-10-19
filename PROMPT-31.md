# PROMPT 31 — «كىتاب تەلەپ قىلىش» ئىقتىدارىنى پۈتۈنلەي ئېلىۋېتىش

## قانداق ئىشلىتىسىز (يېڭى تۈر ئېچىپ)
1. Claude Code نى ئېچىپ **BilimHezinisi-website** قىسقۇچىنى تاللاڭ.
2. سىزىقتىن تۆۋەنكى تېكىستنى پۈتۈنلەي كۆچۈرۈپ چاپلاڭ.

> **ئالدىن قىلىدىغان ئىش (سىز ئۆزىڭىز):** بۇ بۇيرۇقنى ئىشلىتىشتىن بۇرۇن
> `https://bilimhezinisi.com/admin/requests` نى بىر ئېچىپ كۆرۈڭ. ئوقۇمىغان
> تەلەپلەر بولسا، كېرەكلىكىنى ئۆزىڭىزگە كۆچۈرۈپ ئېلىڭ — بۇ ئۆزگەرتىشتىن كېيىن
> **ئۇلار پۈتۈنلەي يوقايدۇ ۋە قايتۇرغىلى بولمايدۇ**.
>
> **بۇ نېمە ئىش:** ئىگىسى 2026-09-11 دە «كىتاب تەلەپ قىلىش» نىڭ بۇ سىستېمىغا
> زۆرۈرىيىتى يوق دەپ قارار قىلدى. شۇڭا:
> - `bilimhezinisi.com/request` بېتى، فورمىسى ۋە ئاستىدىكى ئۇلىنىشى يوقايدۇ؛
> - باشقۇرۇش سۇپىسىدىكى «تەلەپلەر» بۆلىكى ۋە ساناقچىسى يوقايدۇ؛
> - سانداندىكى `book_requests` جەدۋىلى، ئۇنىڭ trigger ۋە فۇنكسىيەسى يېڭى بىر
>   migration بىلەن ئۆچۈرۈلىدۇ (كونا migration غا **قول تەگمەيدۇ**);
> - `/request` غا كىرگەنلەر «ھەققىدە» بېتىگە يۆتكىلىدۇ — چۈنكى ئالاقە ئېلخېتى
>   ئەمدى شۇ يەردە.
>
> **سىز قىلىدىغان ئاخىرقى ئىش:** كود تارقىتىلغاندىن كېيىن، Supabase دا يېڭى
> migration نى ئىجرا قىلىش كېرەك. Claude Code سىزگە ئۇنى قانداق قىلىشنى ئۇيغۇرچە،
> قەدەممۇقەدەم ئېيتىپ بېرىدۇ.

---

You are continuing an existing, live project. Read `CLAUDE.md` in this folder FIRST —
it is the project instruction and always wins — and use the **bilim-web** skill.

## What this task is

Remove the book-request feature from «بىلىم خەزىنىسى» completely: the public form, the
admin inbox, the server helpers, the rate-limit rule, the tests, and the database table.
The owner decided on 2026-09-11 that the library does not need it — the contact address
on `/about` is the channel that replaces it.

This is a **deletion**, and the only way to do a deletion well is to leave nothing behind:
no dead file, no unused export, no orphaned link, no test that still names it, no table
sitting in a 500 MB budget. When you are done, `grep -ri "book_request\|/request\|كىتاب تەلەپ"`
across the repo must return nothing but this prompt file and the older `PROMPT-*.md`
history (those are history and are never rewritten).

**The owner has confirmed the table is to be dropped**, and has been told the rows in it
are lost for good. Do not ask him again; do not soften this into "leave the table for now".

## Project context

Next.js 16 (App Router) + TypeScript + Tailwind on **Vercel Hobby**, Supabase Free.
GitHub `kelemdepter-rgb/BilimHezinisi-website`. Live at `https://bilimhezinisi.com`.
Phases 1–30 deployed. The book-request feature arrived in the discovery phase and is
described in `PROMPT-24.md`; migration `0022_book_requests.sql` created its table.

---

# Part 1 — delete the code

## 1.1 Whole files and folders to delete

```
app/request/page.tsx
app/request/actions.ts
app/request/loading.tsx
app/request/                      (the folder itself)

app/admin/requests/page.tsx
app/admin/requests/actions.ts
app/admin/requests/               (the folder itself)

components/admin/request-inbox.tsx
lib/requests.ts
tests/unit/book-requests-sql.test.ts
```

`lib/requests.ts` is used by nothing else once the four files above are gone — it owns
`REQUEST_LIMITS`, `MIN_FILL_SECONDS`, `issueStamp`, `readStamp`, `insertBookRequest`,
`listBookRequests`, `countOpenRequests` and the `BookRequest` / `SubmitOutcome` types, and
every one of them is book-request only. Confirm with a grep before deleting, not after.

**Do not delete `components/search/uyghur-text-field.tsx`.** The request form used it, but
so do the search box and the admin forms.

## 1.2 Edits

**`components/app-shell.tsx`** — in the footer nav, delete the whole
`<Link href="/request" data-testid="request-link">كىتاب تەلەپ قىلىش</Link>` element. The
footer then reads: ھەققىدە · مەخپىيەتلىك ۋە بىخەتەرلىك · ھېساباتىم · © — which still
wraps correctly at 360 px. Change nothing else in that footer.

**`components/admin/admin-nav.tsx`** — delete the
`{ href: "/admin/requests", label: "تەلەپلەر", icon: "mail", adminOnly: true }` entry from
`LINKS`. The remaining four entries keep their order.

**`app/admin/page.tsx`** — delete all four of these, and nothing else:
- the `import { countOpenRequests } from "@/lib/requests";` line;
- the `const openRequests = …` line;
- the `<StatCard icon="mail" label="يېڭى كىتاب تەلەپلىرى" …>` block and its
  `session.role === "admin" &&` wrapper;
- the `<Link href="/admin/requests" … data-testid="admin-requests-link">` button and its
  `session.role === "admin" &&` wrapper.

The dashboard then shows three stat cards (سالاھىيىتىڭىز / كىتابلار / تۈرلەر) and three
buttons. Check the `grid gap-4 sm:grid-cols-2 lg:grid-cols-3` still looks right with three
cards instead of four — it should, but look at it rather than assuming.

**`lib/rate-limit.ts`** — delete `BOOK_REQUEST_RULE` and its doc comment. Every other rule
(`SIGN_IN_RULE`, `SIGN_UP_RULE`, `PASSWORD_RESET_RULE`, `BOOK_DOWNLOAD_RULE`,
`NOTE_SOURCE_RULE`) stays exactly as it is, and so do `callerKey`, `isRateLimited` and
`resetRateLimits`.

**`tests/env.ts`** — delete `SEED_REQUEST_PREFIX` and its comment.

**`tests/auth.teardown.ts`** — delete the `SEED_REQUEST_PREFIX` import and the
`await admin.from("book_requests").delete().like(…)` line with its comment. Update the
teardown's own summary comment so it no longer says "and requests". Everything else in the
teardown stays.

**`tests/discovery.spec.ts`** — delete the book-request blocks: the tests
"takes a request from a signed-out visitor", the honeypot test, the rate-limit test, and
the whole `test.describe("the request inbox is the admin's alone", …)`. Also delete the
`SEED_REQUEST_PREFIX` import and the mention of "book-request inbox" in the file's header
comment. The authors, what's-new and Atom-feed coverage in this file stays untouched.

**`tests/autofill.spec.ts`** — delete only the test
"the book-request form still offers to fill in an email". **Every other assertion in that
file stays**, in particular the ones proving the sign-in form still carries
`autocomplete="email"` / `current-password` and the register form `new-password`. Those
exist because `PROMPT-29.md` deliberately made sure this site's search boxes opt out of
autofill *without* breaking sign-in — do not weaken that while removing a neighbouring
test.

**`playwright.config.ts`** — in the `discovery-${viewport.name}` project's comment, drop
"and the book-request inbox". The project itself and every `testMatch` stay.

**`CLAUDE.md`, `README.md`, `docs/`** — grep them. If any of them describes the book
request feature, remove that description. Do **not** rewrite `PROMPT-*.md` history files
or `AUDIT-2026-09-02.md`; they record what was true when they were written.

## 1.3 Files that need no change — verified, do not "fix" them

- `app/sitemap.ts` — never listed `/request`.
- `app/robots.ts` — never mentioned it.
- `public/sw.js` and `lib/pwa/constants.ts` — the worker has no `/request` path.
- `app/privacy/page.tsx` and `app/about/page.tsx` — the owner's current copy does not
  mention book requests. **Do not edit either page**; they were finished on 2026-09-10/11
  and their wording is his.

---

# Part 2 — the redirect

Anyone who bookmarked `/request`, and any crawler that indexed it, should land somewhere
useful rather than on a 404. The About page is where the contact address now lives, so
that is where they go.

Add a `redirects()` function to `next.config.ts` (it currently has `headers()` and no
`redirects()`), returning one permanent redirect:

```
{ source: "/request", destination: "/about", permanent: true }
```

- Put it beside `headers()`, with a short English comment saying the book-request form was
  removed on 2026-09-11 and the contact address on `/about` replaced it.
- `permanent: true` (308) is correct: the page is not coming back.
- **Do this in `next.config.ts`, not in `proxy.ts` or `lib/legacy-host.ts`.** The
  2026-08-29 domain migration lives there and is settled — do not touch either file.
- Confirm the existing `headers()` block, the CSP and the legacy-host redirect still work
  afterwards; `tests/domain.spec.ts` must stay green.

---

# Part 3 — the database

**Never edit an applied migration.** `supabase/migrations/0022_book_requests.sql` stays on
disk exactly as it is — it is the record of what was once applied.

Add a new file `supabase/migrations/0024_drop_book_requests.sql` (0023 is the highest
today) containing, in this order:

1. `drop trigger if exists book_requests_cap on public.book_requests;`
2. `drop table if exists public.book_requests;` — this takes the indexes and all four RLS
   policies with it.
3. `drop function if exists public.book_requests_guard();` — the trigger function, which
   only exists for that table.

Write the file in the same voice as the migrations around it: a header comment saying what
is being removed and why (the feature was withdrawn on 2026-09-11; the table's daily and
total caps existed only to keep it out of the 500 MB free-tier budget, and dropping it
gives that room back outright).

Do **not** touch `public.is_admin()` — other policies use it.

Do **not** run this migration yourself against production. When the code change is
committed, tell the owner in Uyghur, step by step with the exact button names, how to run
it in the Supabase dashboard (Supabase → the project → **SQL Editor** → **New query** →
paste the file's contents → **Run**), and say plainly that this is the irreversible step.

---

# Constraints — restated, because they are not negotiable

- **Anonymous reading always works.** Browsing, reading and search need no account, before
  and after this change.
- **RTL Uyghur UI.** Logical properties only — `ps-*`, `pe-*`, `ms-*`, `me-*`, `start-*`,
  `end-*`, `text-start`. Never physical `left`/`right`. Code, comments and commit messages
  in English; Uyghur only in UI strings.
- **Mobile Rules in `CLAUDE.md` are hard requirements.** After the footer link goes, check
  the footer still wraps cleanly with no horizontal scroll at 360 px, and the admin
  dashboard's three cards and three buttons still lay out correctly on a phone.
- **RLS stays enabled on every remaining table.** Dropping one table must not change a
  policy on any other. Do not touch `lib/admin/guards.ts`.
- **AI stays bring-your-own-key and browser-only.** Do not touch `lib/ai/`.
- **Search operators stay removed.** Typed text is one literal phrase.
- Do not weaken the CSP, add no third-party script or CDN, add no dependency, remove no
  dependency you have not proved is now unused.
- Do not touch `lib/legacy-host.ts`, `proxy.ts`, `lib/seo.ts`, `public/sw.js` or
  `lib/pwa/constants.ts`.
- Do not run `git add -A` / `git add .` / `git commit -a`. Stage only the files you changed
  and deleted. `git push` deploys to the live library — **ask the owner in Uyghur before
  pushing.**
- Do not take the opportunity to refactor anything nearby. This change deletes a feature;
  it improves nothing else.

---

# Tests

- `npm run typecheck && npm run lint && npm run build` — green. Lint and typecheck are what
  catch a leftover import or an unused export; do not silence either with a disable
  comment.
- Every remaining unit and Playwright suite green. Five are known flaky or pre-existing
  failures — `keyboard.spec.ts:151`, `ai.spec.ts:148`, `ai.spec.ts:261`,
  `offline.spec.ts:181`, `reader-ai.spec.ts:534`. If one of those fails, say so and move
  on; do not chase it and do not treat it as caused by this change.
- Run `tests/unit/sql-parity.test.ts` and `tests/unit/script-parity.test.ts` specifically:
  they read the migration files, and a new migration is exactly the kind of change that
  trips them.
- **New assertions, at 375×667, 390×844 and 1280×800:**
  - `/request` responds with a **308 to `/about`**, and following it lands on the About
    page with its `<h1>` «بىلىم خەزىنىسى ھەققىدە» visible;
  - `/admin/requests` no longer exists — signed in **as the admin**, it does not render an
    inbox (a 404 is the expected outcome; assert whatever the app actually does, and say
    which in your report);
  - the footer contains no link to `/request` and no element with
    `data-testid="request-link"`, on `/`, `/search` and `/about`;
  - the footer still shows ھەققىدە, مەخپىيەتلىك ۋە بىخەتەرلىك and the account link, with no
    horizontal overflow at 360 px;
  - the admin navigation has no «تەلەپلەر» entry and the dashboard has no
    `data-testid="admin-requests-link"`, signed in as the admin;
  - the admin dashboard still renders its three stat cards and three buttons, and the
    usage panel, with no overflow at 360 px.
- **A guard test** — one assertion, in a suite that always runs, that the string
  `book_requests` appears nowhere under `app/`, `components/`, `lib/` or `tests/`. It is
  cheap, and it is what stops this feature being half-restored by accident later.
- Take a screenshot of the footer and of `/admin` at 390×844 and look at them.

---

# Acceptance criteria

1. Every file in 1.1 is deleted; every edit in 1.2 is made; nothing in 1.3 was touched.
2. `grep -ri "book_request\|request-link\|admin-requests\|كىتاب تەلەپ"` over `app/`,
   `components/`, `lib/`, `tests/`, `scripts/` and `supabase/migrations/0024*` returns
   nothing — the only surviving mentions are in `PROMPT-*.md`, `AUDIT-*.md` and
   `supabase/migrations/0022_book_requests.sql`, all of which are history.
3. `typecheck`, `lint` and `build` are green with no disable comment added anywhere.
4. `/request` permanently redirects to `/about`; the redirect lives in `next.config.ts`;
   `proxy.ts`, `lib/legacy-host.ts` and the CSP are untouched and `domain.spec.ts` passes.
5. `supabase/migrations/0022_book_requests.sql` is byte-for-byte unchanged, and
   `0024_drop_book_requests.sql` exists and drops the trigger, the table and the function
   in that order.
6. The footer, the admin navigation and the admin dashboard each show exactly what 1.2
   describes, on a phone and on a desktop.
7. The sign-in, sign-up and password-reset autofill assertions in `tests/autofill.spec.ts`
   still exist and still pass.
8. Nothing else regressed: the library home, the reader, search, the Qur'an module, the
   notebook, the PWA, sharing, `/about`, `/privacy`, `/my/*` and the AI layer all still
   work.

---

# The report

Commit as one logical change with an English conventional message
(`feat(request): remove the book-request feature`). Then report in **simple Uyghur**:

- the list of what was deleted, in plain words — the page, the form, the admin inbox, the
  footer link, the dashboard card, the tests;
- that `/request` now sends people to «ھەققىدە», and why;
- what `/admin/requests` does now for a signed-in admin (404, or whatever it actually is);
- **the one step he must do himself:** running
  `supabase/migrations/0024_drop_book_requests.sql` in the Supabase SQL Editor, written out
  click by click with the exact button names, and a clear sentence that this is the
  irreversible step — after it, every request ever sent is gone;
- one honest line on what this change does **not** do: nobody can ask for a book through
  the site any more, and the only route left is the email address on «ھەققىدە».

**If any part of this deletion would also remove something the site still needs — a shared
component, a rate-limit helper, an RLS function used by another table — stop and ask the
owner in Uyghur before deleting it.** Deleting one thing too many in a live library is
worse than leaving one dead file behind for a day.
