# PROMPT 21 — بەتتىن بەتكە ئۆتۈشنىڭ ئاستىلىقىنى ئوڭشاش

## قانداق ئىشلىتىسىز (يېڭى تۈر ئېچىپ)
1. Claude Code نى ئېچىپ **BilimHezinisi-website** قىسقۇچىنى تاللاڭ.
2. سىزىقتىن تۆۋەنكى تېكىستنى پۈتۈنلەي كۆچۈرۈپ چاپلاڭ.

> **مەسىلە:** بىر تۈرنى ياكى ئىقتىدارنى باسقاندا سايت ئىنتايىن ئاستا ئېچىلىدۇ —
> «مائۇس چېكىلمىدىمۇ؟» دەپ ئويلاپ قالغۇدەك. **بۇ بىر مەسىلە ئەمەس، بەش مەسىلە** —
> ھەممىسى بىرلىشىپ شۇ ھالەتنى پەيدا قىلغان. ھەممىسى ھەقسىز ھالەتتە ئوڭشالىدۇ.

---

You are continuing an existing, live project. Read `CLAUDE.md` in this folder FIRST —
it is the project instruction and always wins — and use the **bilim-web** skill.

## Project context
`https://bilim-hezinisi-website.vercel.app` — a free public Uyghur digital library.
Next.js 16 (App Router) + TypeScript + Tailwind on **Vercel Hobby**, Supabase Free.
Phases 1–20 are complete and deployed: library, reader, search, Qur'an, notebook with
spellcheck, PWA with offline reading, discovery pages, admin with batch import, and a
browser-only bring-your-own-key AI layer.

**The owner's report:** clicking a category, or moving from one section to another, is so
slow that it feels as if the click did not register. This is a real defect, not a
perception problem, and it affects every visitor on every page.

## Non-negotiable constraints
- **No budget, ever.** Supabase Free + Vercel **Hobby**. No paid plan, no new vendor
  account, no new runtime dependency unless you can prove nothing already present will
  do. Do not "solve" this by upgrading anything.
- **Security must not be traded for speed.** Anonymous reading stays open, but every
  `/admin` route, every mutating Server Action and every RLS policy keeps its own
  server-side verification. A cached or inherited value must never become the thing that
  decides whether someone is an admin.
- Anonymous browsing, reading and search keep working with no account.
- RTL Uyghur UI; code, comments and commit messages in English.
- All Mobile Rules in `CLAUDE.md` apply. Do not weaken the CSP or the security headers.
- The service worker, offline reading and the AI layer must all still work exactly as
  they do now.
- New migrations are NEW files in `supabase/migrations/`; never edit an applied one.

---

# STEP 0 — Measure before you change anything

Do not start editing. Produce numbers first, and put them in the final report next to the
same numbers taken afterwards.

1. On the **deployed** site, record for a click from the home page to a category, to a
   book, to `/quran`, to `/search` and to `/notes`:
   - time to the first visual change after the click,
   - time to the RSC response completing,
   - the server-side breakdown of where that time went.
2. Add a temporary, development-only timing instrument that shows how long each of these
   takes per request — the middleware's session refresh, the root layout's session
   lookup, the root layout's category query, and the page's own queries. **Nothing it
   records may include a key, a prompt, a note, or anything identifying a reader**, and
   it must not survive into production logging. Remove it, or gate it strictly, before
   the final commit.
3. State the **Supabase project region** and the **Vercel function region** side by side.
   Both are visible in the two dashboards; walk the owner through finding them in simple
   Uyghur with exact button names if you cannot read them yourself.

Report the five numbers before you touch a line of code. If the measurements contradict
any finding below, **believe the measurements** and tell the owner.

---

# The five causes

## Cause 1 — Nothing on screen changes until the whole server response arrives

There is **not one `loading.tsx` in the entire `app/` tree**. Next's `<Link>` navigation
is a React transition: without a loading boundary the browser keeps rendering the *old*
page, unchanged, until the complete RSC payload for the new one has arrived. No spinner,
no skeleton, no dimming — literally nothing. That is exactly the "did my click register?"
feeling the owner described, and it is the single biggest perceived cause.

### Fix
1. Add a `loading.tsx` for every route segment that fetches data: the home page, the
   book detail and reader routes, search, Qur'an and each sura, authors, `/new`,
   `/notes`, `/my/*` and `/admin/*`.
2. They must be **real skeletons that match the layout they replace** — same shape, same
   spacing, so nothing jumps when the content lands. Not a bare spinner, and never
   centred text that shifts the page.
3. RTL, in the manuscript palette, correct in light, dark and sepia, and honest at
   375 px, 390 px and 1280 px.
4. Respect `prefers-reduced-motion`: no pulsing animation for a reader who asked for
   less movement.
5. Add an immediate **pending state on the control the reader clicked** — a category
   chip, a nav item, a book card — using `useLinkStatus` (Next 16) or `useTransition`,
   so the tap acknowledges itself in the same frame. Do not disable the control; just
   show it is working. Touch targets and the mobile rules still apply.

## Cause 2 — The root layout blocks every navigation on three or four Supabase round trips

`app/layout.tsx` is an async server component that awaits, on **every single
navigation**:

```
const [session, categories] = await Promise.all([getSessionInfo(), getCategories()]);
```

and `lib/data.ts` `getSessionInfo()` does two calls **in sequence**:

```
await supabase.auth.getUser()          // network call to Supabase Auth
await supabase.from("profiles")…       // waits for the one above
```

`getCategories()` is a third query. So before the page's own data is even requested, the
shell has already made three Supabase calls, two of them serialised.

### Fix
1. **The shell must not block on per-user data.** Render the header, the sidebar and the
   page immediately, and stream the account-dependent parts (the sign-in / account
   control, the admin link) inside a `<Suspense>` with a stable-width fallback so nothing
   shifts when they arrive. The root layout should `await` only what the first paint
   truly needs.
2. **Break the sequential chain.** The `profiles` lookup must not wait on a network
   `getUser()` round trip. Investigate `supabase.auth.getClaims()`, which verifies the
   JWT locally against the project's JWKS instead of calling the Auth server — **verify
   for yourself whether this project's signing keys support it** rather than assuming,
   and report what you found. If local verification is not available, at minimum fetch
   the profile without serialising behind a redundant auth round trip.
3. **Never trust an unverified cookie.** Whatever you do here, the identity used for any
   decision must still be cryptographically verified. If you cannot make it both fast and
   verified, keep it correct and slow, and say so.

## Cause 3 — The same authentication work is done twice per request

`proxy.ts` runs on every page and API request and calls `updateSession()`, which calls
`supabase.auth.getUser()`. Then the root layout calls `getSessionInfo()`, which calls
`supabase.auth.getUser()` **again**. Two verifications of the same token on the same
request.

The middleware's call is not redundant — it refreshes and rotates the token, and its
result decides the `CACHEABLE_HEADER` the service worker relies on. The layout's repeat
is what needs to go.

### Fix
Do the verification **once** per request and let the render read the result — for example
by having the proxy pass the verified identity forward on the request headers it already
mutates (it already sets `x-nonce` this way). Rules that must hold:
- the value is written by our own middleware and can never be spoofed by an incoming
  request header — **strip any inbound header of that name before setting it**;
- it carries identity only, and never a token, a key or an email where one is not needed;
- `/admin` and every mutating Server Action still verify the role themselves against
  `profiles`, exactly as they do today. This change speeds up rendering; it must not
  become the basis of an authorisation decision.
- the `CACHEABLE_HEADER` behaviour for the service worker is unchanged.

## Cause 4 — Nothing in the codebase is cached

A grep for `revalidate`, `unstable_cache`, `"use cache"`, `force-static` and
`cacheLife` across `app/` and `lib/` returns **nothing**. Every query runs fresh on every
request, including `getCategories()` — a small table that changes when the owner edits the
category tree, perhaps once a month, re-fetched on every click by every visitor.

### Fix
1. Cache the genuinely public, non-user-specific reads: the category tree first, then the
   library listings, author list and Qur'an sura list where they do not vary per reader.
   Use Next 16's caching properly and say which mechanism you chose and why.
2. **Invalidate on write.** Every Server Action that changes categories, books or their
   status must revalidate the matching tag or path, so the owner never sees a stale
   library after publishing a book. Prove it with a test: publish a book, and it appears
   without waiting for a timer.
3. **Never cache anything per-reader** — no bookmarks, notes, reading progress, notebook
   content, AI state, or admin data. If a value depends on who is asking, it is not
   cacheable here. Write this rule as a comment where a future session will see it.
4. Check `books/[id]` and `quran/[sura]`: these are public, stable documents and are
   strong candidates for being generated once rather than per request. If you can make
   them static or incrementally revalidated without breaking the reading-position
   restore, do it and report the effect on both speed and free-tier egress.

## Cause 5 — The functions may be running on the wrong side of the world

`vercel.json` sets no `regions` key. Vercel's documentation states that the default
function region for all new projects is **`iad1` (Washington, D.C., USA)**, and warns:
"If your functions communicate with external services, choosing regions far from those
services increases latency. Select only regions close to your external services."

Every Supabase call this site makes is such a call. If the Supabase project sits in
Europe while the functions run in Virginia, each of the round trips above crosses the
Atlantic twice, and the three or four of them per navigation are enough on their own to
produce what the owner is seeing.

### Fix
1. Establish the Supabase project's actual region.
2. Set the Vercel function region to the closest available one. Hobby allows **a single
   region**, configured as `"regions": ["<code>"]` in `vercel.json` or in the dashboard
   under **Settings → Functions → Function Regions**.
3. Measure the same five navigations before and after this one change alone and report
   the difference. If Supabase and the functions are already in the same region, say so
   and move on — do not change it for its own sake.
4. If the regions are far apart and Supabase offers no nearby region on the free plan,
   report that honestly as a ceiling rather than pretending it away.

---

# Also worth checking while you are in there

- **Client bundle weight on first load.** `components/notes/ai-panel.tsx` (33 KB source),
  `components/reader/reader.tsx` (39 KB) and `components/admin/batch-import.tsx` (51 KB)
  are large. Confirm that heavy, rarely-used code — the DOCX writer, `mammoth`,
  `turndown`, the batch importer, the AI panels, the quote-card canvas — is dynamically
  imported and is **not** in the bundle a first-time reader downloads. Report the actual
  first-load JS per route before and after.
- **The category filter.** Establish whether clicking a category is a full server
  navigation or a client-side filter, and whether that is the right choice for a list this
  size. If it stays a navigation, it must be prefetched and must show its pending state
  instantly.
- **Prefetching.** With every route dynamic and no loading boundaries, `<Link>` prefetch
  currently buys almost nothing. Once Cause 1 and Cause 4 are fixed, verify prefetch is
  actually doing something on the links a reader is most likely to click next.
- **Fonts and first paint.** Confirm the preloaded woff2 is the one the first paint
  really uses, and that no other font blocks rendering.
- **`app/favicon.ico` is 165 KB.** Check what it costs on a first load and fix it if it
  is on the critical path.

---

# How to work on this

- **One cause per commit**, with the measurement before and after in the commit message.
  If one of them turns out to make no difference, say so and keep the change only if it is
  right on its own merits.
- **Do not refactor beyond the fault.** This is a performance repair on a working site of
  twenty completed phases. Anything you touch that is not one of the five causes above
  must be justified in the report.
- If a fix would trade away correctness, security, offline behaviour or a mobile rule,
  **stop and explain the trade-off to the owner in Uyghur** rather than choosing silently.

---

# Tests and reporting (mandatory)

- `npm run typecheck && npm run lint && npm run build` all pass.
- Every existing unit and Playwright suite stays green at **375×667, 390×844 and
  1280×800**, including the offline, AI and spellcheck suites.
- New tests:
  - every data-fetching route has a `loading.tsx` that renders without horizontal
    overflow at all three viewports;
  - clicking a nav item, a category and a book card produces a visible pending state in
    the same interaction, before any content arrives;
  - a signed-in reader still sees their account controls, and a signed-out visitor sees
    the sign-in link, after the shell was made non-blocking;
  - `/admin` remains unreachable for a signed-out visitor and for a plain `reader`, and a
    forged identity header from an incoming request is ignored;
  - publishing a book makes it appear in the library without waiting for a cache timer;
  - no per-reader data is served from any cache;
  - offline reading, the AI panel and the spellchecker all behave as before.
- Final report in **simple Uyghur**:
  1. the five measurements before and after, per navigation;
  2. which of the five causes mattered most, with the number that proves it;
  3. the Supabase region, the Vercel region, and what you set;
  4. whether local JWT verification was available, and what you did about the duplicated
     auth call;
  5. what is now cached, what is deliberately not, and how it is invalidated;
  6. first-load JS per route before and after;
  7. anything still slow that you could not fix without money, and what it would take.

# Acceptance criteria
- Clicking anything produces a visible response **immediately** — the reader is never left
  wondering whether the click registered.
- The root layout no longer blocks a navigation on a chain of Supabase round trips, and
  the same token is not verified twice per request.
- Public, non-user data is cached and correctly invalidated; nothing per-reader is cached
  anywhere.
- The function region is a deliberate choice, recorded in `vercel.json`.
- Authorisation is exactly as strict as before; RLS, `/admin` guards and Server Action
  role checks are untouched in substance.
- Offline reading, the AI layer, search, the notebook and the spellchecker all still work.
- Still free: Supabase Free, Vercel Hobby, no new vendor account, no new runtime
  dependency that was not justified in the report.

Commit per logical step with English conventional messages.
