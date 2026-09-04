# PROMPT 29 — ئىزدەش رامكىسىنى تور كۆرگۈچنىڭ ئاپتوماتىك تولدۇرۇشىدىن ئايرىش

## قانداق ئىشلىتىسىز (يېڭى تۈر ئېچىپ)
1. Claude Code نى ئېچىپ **BilimHezinisi-website** قىسقۇچىنى تاللاڭ.
2. سىزىقتىن تۆۋەنكى تېكىستنى پۈتۈنلەي كۆچۈرۈپ چاپلاڭ.

> **مەسىلە:** ئىزدەش رامكىسىنى چەككەندە كۇنۇپكا تاختىسىنىڭ ئۈستىدە ئاچقۇچ 🔑 /
> كارتا 💳 / ئورۇن 📍 بەلگىلىرى چىقىۋاتىدۇ. كارتا بەلگىسىنى باسسا تېلېفوندا ساقلانغان
> بانكا كارتىلىرى كۆرۈنىدۇ. سايت ئۇلارنى **كۆرمەيدۇ ۋە ئالمايدۇ** — ئۇ Chrome نىڭ ئۆز
> كۆزنىكى — ئەمما بىلمىگەن ئوقۇرمەن «بۇ سايت ئۇچۇرۇمنى ئوغرىلايدىكەن» دەپ گۇمانلىنىدۇ.
>
> **بۇ مۆلچەر ئەمەس — ئۆلچەندى.** ئىگىسى ئۆز تېلېفونىدا Chrome دا 6 خىل رامكىنى
> سىناپ باقتى. ھازىرقى ھالەتتە بەلگىلەر **چىقتى**؛ `autocomplete="off"` قويۇلغان
> رامكىدا **چىقمىدى**. يەنى ئىككى قۇرلۇق ئۆزگەرتىش بىلەن ھەل بولىدۇ.
>
> **قىلىنمايدىغان ئىش:** ھېساباتقا كىرىش ۋە تىزىملىتىش بەتلىرىدىكى پارول تولدۇرۇشقا
> **قول تەگمەيدۇ**. ئۇنى بۇزساق ئادەملەر ئاجىز پارول ئىشلىتىدىغان بولۇپ قالىدۇ.
>
> **يەنە بىر ئىش:** «ئىزدەش تارىخى» ئىقتىدارى **ئۆچۈرۈلمەيدۇ**. ئۇ بۇ مەسىلىنىڭ سەۋەبى
> ئەمەس ئىكەنلىكى سىناقتا ئىسپاتلاندى — سىناق رامكىلىرىنىڭ ھېچقايسىسىدا تارىخ تىزىملىكى
> يوق ئىدى، شۇنداق تۇرۇقلۇق بەلگىلەر چىقتى.

---

You are continuing an existing, live project. Read `CLAUDE.md` in this folder FIRST —
it is the project instruction and always wins — and use the **bilim-web** skill.

## What happened, and what was measured

Testing the site on his Android phone in Chrome after `PROMPT-26.md` shipped, the owner
tapped the header search box and Chrome's keyboard accessory bar appeared carrying a
**key / card / location-pin** row. Tapping the card chip opened Chrome's own sheet listing
his saved bank cards.

**No data was taken, and the site cannot take it.** That row is browser chrome. The page
cannot detect that it exists, cannot detect that the sheet opened, and receives a value
only if the person picks one — at which point it arrives as ordinary keystrokes.

**But it is preventable, and it must be prevented**, for two reasons:

1. **A real hazard.** The search form is `method="get"`. If a reader taps the card chip
   and picks a card, the number is typed into `name="q"` and, on submit, becomes
   `https://bilimhezinisi.com/search?q=<card number>` — landing in the address bar, the
   browser history, the `Referer` header on every outbound link, Vercel's access log, and
   the reader's own `localStorage` search history. One mis-tap is enough.
2. **Trust.** This library serves an audience for whom a privacy failure is not an
   inconvenience. A reader who sees their bank cards offered on a Uyghur library's search
   box will conclude the library is after their data, and will be right to leave.

### The measurement — this is not a guess

A six-variant diagnostic page was built and run by the owner on his own phone, in his own
Chrome, on 2026-09-02:

| Variant | What it was | Icons appeared? |
|---|---|---|
| **A** | `<input type="search" name="q">` in a `<form>`, **no `autocomplete`** — the live site today | **YES**, on tap while empty |
| **B** | the same, plus `autocomplete="off"` on **both** the form and the input | **NO** |
| **C** | B plus the password-manager opt-out data attributes | **NO** |
| **D** | input outside any `<form>` | **NO** |
| **E** | `autocomplete="one-time-code"` | **NO** |
| **F** | `contenteditable` instead of an input | **NO** |

On A the icons appeared only while the field was **empty** and vanished as soon as a
character was typed. That is the signature of Chrome's **Autocomplete** feature — the one
that remembers previously typed form values, keyed by the field's `name` — offering its
saved entries for `name="q"`, with the manual-fallback icons riding at the end of that same
row. Chromium's own PSA is explicit that `autocomplete="off"` is **still honoured** for
exactly this case, even though it is ignored for password, address and payment autofill:

> "autocomplete=off will still be respected for autocomplete data (e.g. past searches…)"
> — Evan Stade, Chromium, WHATWG mailing list, November 2014

Theory and measurement agree. **Variant B is the fix.** It is two attributes.

### Two consequences worth stating

- Chrome had been **saving the owner's search terms independently of the site**, and
  offering them back on an empty box. `autocomplete="off"` stops Chrome saving them at all.
  That is a genuine privacy improvement for every reader, separate from the icons.
- **Do not implement D, E or F.** They also passed, and every one of them costs something
  real: D breaks submission without JavaScript; E lies to the browser with a token that
  means something else and could change behaviour on any Chrome update; F is not a form
  control at all, so it breaks no-JavaScript search, the on-screen keyboard's search key,
  the Uyghur keyboard component that writes into `inputRef.current.value`, and normal
  accessibility. B and C achieve the same result for nothing.

## Project context — what already exists, do not rebuild it

Next.js 16 (App Router) + TypeScript + Tailwind on **Vercel Hobby**, Supabase Free. GitHub
`kelemdepter-rgb/BilimHezinisi-website`. Live at `https://bilimhezinisi.com`. Phases 1–26
deployed, including the category scope picker from `PROMPT-26.md`
(`components/search/category-scope.tsx`, commit `89a4907`).

Files this task touches:

- `components/search/search-field.tsx` — the one search `<input>`; every search box on the site renders through it (header at `md`+, the header's mobile panel, `/search`, the Qur'an). It also owns the «يېقىنقى ئىزدەشلەر» dropdown.
- `components/app-shell.tsx` — the two header `<form role="search" action="/search">`.
- `app/search/page.tsx` — the results page's own form.
- `components/search/uyghur-text-field.tsx`, `components/quran/sura-list.tsx`, `components/quran/mushaf.tsx`, `components/notes/find-bar.tsx`, `components/admin/book-editor.tsx`, `components/admin/upload-wizard.tsx`, `components/admin/batch-import.tsx`, `components/admin/category-tree.tsx` — the rest of the free-text fields.
- `lib/search/history.ts` + `components/my/search-history-control.tsx` — the local search history. **Read the comment at the top of `history.ts` before touching it**; that design is deliberate and is not being reopened.
- `app/privacy/page.tsx` — the privacy page.

---

# Part 1 — the fix (this is the urgent half; it must land)

## 1.1 Mark the search input as not-to-be-filled

On the `<input>` in `components/search/search-field.tsx`, add:

- `autoComplete="off"` — **the load-bearing one**; variant B proved it
- `autoCorrect="off"`
- `autoCapitalize="off"`
- `spellCheck={false}`
- `enterKeyHint="search"` — a better on-screen keyboard for a search box, free
- the password-manager opt-outs that variant C also carried, because they cost nothing and
  cover tools Chrome's own setting does not: `data-1p-ignore` (1Password),
  `data-lpignore="true"` (LastPass), `data-bwignore` (Bitwarden),
  `data-form-type="other"` (Dashlane)

Keep `type="search"` and `name="q"` exactly as they are — `q` is what `/search` reads and
what the site's `SearchAction` structured data points at.

Add `autoComplete="off"` to the **`<form>`** elements too — both header forms in
`components/app-shell.tsx` and the one in `app/search/page.tsx`. Variant B carried it on
both; ship both.

**Leave a short comment in the code saying why**, naming the 2026-09-02 measurement, so a
future contributor does not delete an attribute that looks decorative and bring the scare
back.

## 1.2 Do the same for every other non-identity field

A browser offering to fill a saved home address into «ئاپتور» is nonsense. Stop it
everywhere:

| File | Field |
|---|---|
| `components/quran/sura-list.tsx` | sura filter |
| `components/notes/find-bar.tsx` | find, and replace |
| `components/quran/mushaf.tsx` | jump-to sura / aya |
| `components/admin/book-editor.tsx` | title, author, date |
| `components/admin/upload-wizard.tsx` | title, author, date, and the rest |
| `components/admin/batch-import.tsx` | every metadata field, including bulk author |
| `components/admin/category-tree.tsx` | category name, rename |
| `components/search/uyghur-text-field.tsx` | check each caller; `off` unless that caller is asking for identity |

## 1.3 Do NOT break the forms where autofill is correct and wanted

**Leave these exactly as they are.** They already carry the right tokens, and a password
manager *should* offer to fill them:

- `app/(auth)/login/page.tsx` — `email`, `current-password`
- `app/(auth)/register/page.tsx` — `name`, `email`, `new-password`
- `app/(auth)/forgot-password/page.tsx` — `email`
- `app/(auth)/reset-password/page.tsx` — `new-password` ×2
- `app/request/page.tsx` — `email` (and its honeypot, already `off` — do not touch it)
- `components/my/ai-keys.tsx` — already `off`, correct

The owner's instruction was to stop the site inviting private data. Breaking sign-in
autofill would do the opposite: someone who cannot autofill a password picks a weaker one.
**If you think one of these is wrong, say so in Uyghur and ask — do not change it.**

## 1.4 A guard so this cannot come back

Add a source-scanning test under `tests/unit/` that **fails the build** when:

- the input in `components/search/search-field.tsx` lacks `autoComplete="off"`, or either
  header form or the `/search` form lacks it — this is the regression that matters most;
- any `autocomplete` value in the codebase is a payment token (`cc-name`, `cc-number`,
  `cc-exp*`, `cc-csc`, `cc-type`) or an address/telephone token (`street-address`,
  `address-line*`, `postal-code`, `country*`, `tel*`);
- any input `name` or `id` matches a card- or address-shaped pattern (`card`, `cc`, `cvv`,
  `cvc`, `iban`, `postal`, `zip`, `address`, `phone`, `tel`).

Write it as a real assertion over the source files, not a comment. **Prove it works**:
temporarily add a `cc-number` field in a scratch file, watch the test fail, remove it, and
say in the report that you did.

---

# Part 2 — the smaller half

## 2.1 Let a reader with no account switch the search history OFF

The history is **not** the cause of the icons — the test settled that — and it is **not**
being removed. But `components/my/search-history-control.tsx`, the only place it can be
managed, lives under `/my/`, which needs an account. An anonymous reader can *clear* the
list from the dropdown but cannot stop it being kept.

Add a switch inside the history dropdown in `components/search/search-field.tsx`:
«ئىزدەش تارىخىنى ساقلىماسلىق». Keep its state in `localStorage` beside the list —
`lib/search/history.ts` owns the key; do not scatter storage keys across components. When
it is off:

- `rememberSearch()` writes nothing;
- the dropdown never opens;
- any list already stored is cleared the moment the switch is turned off, not left behind.

Mirror the switch in `components/my/search-history-control.tsx` so both places agree.
Default stays **on**, as today.

## 2.2 Tell the truth on `/privacy`

Two or three short paragraphs in simple Uyghur, in the voice that page already uses:

- the site has **no** field for a bank card, an address or a telephone number, and never
  asks for one;
- searches are kept in the reader's own browser, are never sent to a server, and can be
  switched off — say where the switch is;
- one sentence noting that a browser may offer to fill its own saved data into any box on
  any site, that this belongs to the browser and not to this site, and that this site's
  search box is marked so browsers do not do it.

No new page, no legal boilerplate, no alarming wording.

---

# What NOT to do

- **Do not implement variants D, E or F.** See the reasons above. B and C are the answer.
- **Do not remove or weaken the search-history feature.** It is not the cause.
- **Do not inspect, validate, sniff, block or log what a reader types into the search box.**
  No "this looks like a card number" detection, ever. Prevention at the field is the fix;
  reading people's queries to protect them would be a far worse breach than the one being
  closed, and would contradict the promise at the top of `lib/search/history.ts`.
- **Do not change the search form from `GET` to `POST`.** `GET` is what makes a result page
  linkable, shareable, bookmarkable and indexable.
- **Do not add analytics, telemetry, error reporting or any third-party script.**
- **Do not add a dependency.** Every attribute in this task is plain HTML.
- Do not touch the category scope picker from `PROMPT-26.md` beyond adding attributes.

---

# Constraints that do not move

- **No budget, ever.** Supabase Free (500 MB database / 1 GB storage / 5 GB egress /
  50,000 MAU / paused after a week idle) and Vercel Hobby (cron minimum once a day, already
  used by `/api/health`; single function region; non-commercial personal use). No paid
  service, no new vendor account.
- **Anonymous reading always works** — browsing, reading and search need no account. The
  history switch must be usable by someone with no account; that is half its point.
- **RTL Uyghur UI.** Logical properties only — `ps-*`, `pe-*`, `ms-*`, `me-*`, `start-*`,
  `end-*`, `text-start`, `border-s`, `border-e`. Never physical `left`/`right`. Code,
  comments and commit messages in English; Uyghur only in UI strings.
- **Mobile Rules in `CLAUDE.md` are hard requirements.** `100dvh` never `100vh`, safe-area
  padding on fixed/sticky bars, touch targets ≥ 44 px, no hover-only affordances, no
  horizontal scroll at 360 px, no trapped body scroll, and every control still visible and
  tappable after scrolling down and back up. The new switch sits inside a dropdown on a
  phone — ≥ 44 px, and it must not push the list off screen.
- **Search operators stay removed.** Typed text is one literal phrase.
- **AI stays bring-your-own-key and browser-only.** Do not touch `lib/ai/`.
- **RLS stays as it is.** Do not touch a policy or `lib/admin/guards.ts`.
- **Do not weaken the CSP** and add no third-party script or CDN.
- **Do not touch `lib/legacy-host.ts`, `proxy.ts`, `lib/seo.ts`, `public/sw.js` or
  `lib/pwa/constants.ts`** — the 2026-08-29 domain migration is settled.
- **Never edit an applied migration.** This task needs no schema change at all; if you
  think it does, stop and say why first.
- Do not run `git add -A` / `git add .` / `git commit -a`. Stage only the files you changed.
  `git push` deploys to the live library — **ask the owner in Uyghur before pushing.**
- Do not fix anything else from `AUDIT-2026-09-02.md`. `PROMPT-27.md` (the
  presentation-forms book) and `PROMPT-28.md` (the anonymous auth round trips) are next, in
  that order, and are not part of this change.

---

# Tests

- `npm run typecheck && npm run lint && npm run build` — green.
- Every existing unit and Playwright suite green. Five are known flaky or pre-existing
  failures — `keyboard.spec.ts:151`, `ai.spec.ts:148`, `ai.spec.ts:261`,
  `offline.spec.ts:181`, `reader-ai.spec.ts:534`. If one of those fails, say so and move on;
  do not chase it and do not treat it as caused by this change.
- **New tests, at 375×667, 390×844 and 1280×800:**
  - the header search input, the mobile search-panel input, the `/search` input and the
    Qur'an search input all carry `autocomplete="off"`, and their forms do too;
  - **no** element on `/`, `/search`, `/quran`, `/books/[id]` or `/notes` carries a `cc-*`,
    `street-address`, `postal-code`, `country` or `tel` autocomplete token;
  - the login form still carries `autocomplete="email"` and `autocomplete="current-password"`,
    and the register form still carries `autocomplete="new-password"` — **assert this
    explicitly**, so a future change cannot quietly break sign-in autofill;
  - the history switch is present in the dropdown, is ≥ 44 px, turning it off clears the
    stored list and stops the dropdown opening, and turning it back on starts recording;
  - no horizontal overflow at 360 px on `/` and `/search` with the dropdown open;
  - the dropdown still scrolls inside itself and does not lock body scroll;
  - searching still works with JavaScript disabled — the form still submits to `/search`.
- The guard test from 1.4 passes, and you have proved it fails when it should.

---

# Acceptance criteria

1. Every search box on the site is marked `autocomplete="off"` at **both** the input and the
   form, plus the attributes listed in 1.1 — this is the configuration measured to work.
2. Every non-identity free-text field in the app is marked `off`.
3. Sign-in, sign-up, password-reset and the book-request email field still autofill
   correctly — proved by a test, not by assertion.
4. No payment, address or telephone autocomplete token exists anywhere, and a test fails if
   one is ever added, or if `autocomplete="off"` is ever removed from the search box.
5. The search-history feature still works, and a reader with no account can now switch it
   off from the search box itself; switching it off erases what was already stored.
6. `/privacy` says, in plain Uyghur, that the site has no card/address/phone field, where
   the search switch is, and that a browser's own saved data belongs to the browser.
7. Nothing sniffs, validates or logs what anyone types. No analytics. No new dependency. No
   CSP, RLS or migration change. No variant D, E or F.
8. Nothing from earlier phases regressed — the category scope picker, the reader, the Qur'an
   module, the notebook, the PWA and the AI layer all still work.

---

# The report

Commit as one logical change with an English conventional message. Report in **simple
Uyghur**:

- what you added, file by file;
- confirmation that the sign-in forms were left alone and still autofill;
- confirmation that the search history still works and now has an off switch;
- and one honest line about scope: the fix was verified on **one** phone, one Android, one
  Chrome version, on 2026-09-02. It is the configuration that measured clean there. Another
  browser or a future Chrome release could behave differently — Chromium ignores
  `autocomplete="off"` for password, address and payment autofill and honours it only for
  saved form entries, which is exactly the case that was hitting this site. Say this
  plainly, and ask the owner to re-check on his phone after deploying. **Do not claim the
  icons are gone from the live site until he has confirmed it** — Playwright's desktop
  Chromium does not render that bar and cannot answer this question.

**If any part of this would break autofill on the sign-in form, or would require reading
what readers type, stop and ask the owner in Uyghur.** He would rather keep a browser
feature he finds annoying than have this library become something that looks at people's
queries.
