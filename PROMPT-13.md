# PROMPT 13 — ئىجازەتنامە تازىلىشى + ئىشەنچ (خەت نۇسخىسى، مەنبە، پارول، مەخپىيەتلىك)

## قانداق ئىشلىتىسىز (يېڭى تۈر ئېچىپ)
1. Claude Code نى ئېچىپ **BilimHezinisi-website** قىسقۇچىنى تاللاڭ، ھەمدە دېسكتوپ دېتال
   قىسقۇچىنىمۇ قوشۇپ تاللاڭ (`bilim hezinisi pc`) — ئۇ پەقەت ئوقۇش ئۈچۈن پايدىلىنىش مەنبەسى.
2. سىزىقتىن تۆۋەنكى تېكىستنى پۈتۈنلەي كۆچۈرۈپ چاپلاڭ.

> **نېمىشقا بۇ بىرىنچى:** دېتالنىڭ v3.1.0 نەشرىدە سىز ئۈچ خەت نۇسخىسىنى ئىجازەتنامە
> سەۋەبىدىن چىقىرىۋەتكەنسىز. تور بېتىدە ئۇلار تېخىچە بار ۋە **ھەر بىر زىيارەتچىگە
> ئەۋەتىلىۋاتىدۇ**. بۇ دېتالدىكىدىنمۇ ئېغىر مەسىلە. ئۇنىڭ ئۈستىگە قۇرئان مەنبەسى
> كۆرسىتىلمىگەن — Tanzil نىڭ CC BY 3.0 ئىجازەتنامىسىدە مەنبە كۆرسىتىش شەرت.

---

You are continuing an existing, live project. Read `CLAUDE.md` in this folder FIRST —
it is the project instruction and always wins — and use the **bilim-web** skill.

## Project context (Phases 1–12 are done and deployed)
Live at `https://bilim-hezinisi-website.vercel.app` — a free public Uyghur digital
library. Next.js App Router + TypeScript + Tailwind on **Vercel Hobby**, data in
**Supabase Free**. GitHub `kelemdepter-rgb/BilimHezinisi-website`.

Already built — do not rebuild or redesign any of it: manuscript design tokens
(light/dark/sepia), RTL shell, Supabase Auth with `admin`/`uploader`/`reader`, RLS on
every table, `ug_normalize()`, admin category tree + upload wizard + user roles, library
home, book detail, reader (lazy pages, themes, font controls, position restore,
bookmarks, notes, in-book search, print), global exact-phrase search with jump-to-match,
Quran module (114 suras / 6,236 ayas, mushaf view, search), desktop-library migration,
SEO, rate limiting, notebook with autosave + DOCX export + Uyghur spellcheck.
20 migrations applied (`0001` … `0020`).

## Non-negotiable constraints
- **No budget, ever.** Supabase Free (500 MB DB / 1 GB storage / 5 GB egress / 50,000
  MAU / project pauses after 1 week idle) + Vercel Hobby (cron minimum interval is once
  per day — the existing daily `/api/health` cron is already at that limit). No paid
  service, no new vendor account, not now and not later.
- Anonymous browsing, reading and search must keep working with **no account**.
- RTL Uyghur UI; code, comments and commit messages in English.
- No PDF, no OCR. Search operators stay removed. Desktop repo is read-only reference.
- All Mobile Rules in `CLAUDE.md` apply to anything you touch.
- New migrations are NEW files in `supabase/migrations/`; never edit an applied one.

This task is about **licence compliance and user trust**. Nothing here is cosmetic.

---

# PART A — Fonts: stop redistributing three fonts we have no right to serve

## A1. The problem, verified

`public/fonts/` currently contains, and `app/globals.css` currently declares
`@font-face` rules for:

| File | Why it must go |
|---|---|
| `Bahij_Nazanin-Regular.ttf` | Licence: "Not for reproduction, distribution or commercial use" |
| `trad-arabic.ttf` | Monotype "Microsoft supplied font" — ships with Windows, not redistributable |
| `trad-arabic-bold.ttf` | Same |

`lib/reader/settings.ts` offers both "Traditional Arabic" and "Bahij Nazanin" in the
reader's font picker. The desktop app removed all three in v3.1.0 for exactly this
reason — read `../bilim hezinisi/bilim hezinisi pc/RELEASE-NOTES-v3.1.0.md` and
`THIRD-PARTY-NOTICES.md` there before you start, and follow the same decision.

## A2. What to do

1. **Delete the three files** from `public/fonts/` and delete their `@font-face` blocks
   from `app/globals.css`.
2. **Keep "Traditional Arabic" as a system font only.** Do not ship a file and do not
   declare an `@font-face`. Reference the family by name in the font stack so a Windows
   reader still gets the exact same rendering, and everyone else falls back cleanly.
   This is what the desktop now does.
3. **Remove "Bahij Nazanin" entirely** from `lib/reader/settings.ts`
   (the `ReaderFont` union, `FONT_STACKS`, `FONT_LABELS`) and from anywhere else it
   appears. `clampSettings()` must silently migrate a stored `"bahij"` value to the
   default instead of throwing — readers who chose it keep working with no error and no
   flash of unstyled text. The localStorage key is `bh-reader-settings`. Check
   `lib/quran/settings.ts` for the same problem and fix it the same way.
4. **Replace the lost choices with fonts we may actually redistribute.** The UKIJ family
   is LGPL. The desktop offers UKIJ Ekran, Tuz, Tuz Tom, Tuz Kitab and Esliye; the web
   ships only Ekran. **First verify in the desktop `THIRD-PARTY-NOTICES.md` that each
   file you intend to copy is genuinely UKIJ/LGPL** (do not assume from the filename),
   then copy the verified ones into `public/fonts/` and add them to the reader's picker.
   The reader ends this task with *more* usable fonts than it started with, all of them
   legitimate.

## A3. Convert to woff2 (`CLAUDE.md` asks for this and it has never been done)

- Convert every font we ship ourselves and are permitted to convert to **woff2**, and
  serve only woff2. `ukijekran.ttf` is 166 KB; woff2 is typically about half.
- Update the `<link rel="preload">` in `app/layout.tsx` — it currently preloads
  `/fonts/ukijekran.ttf` with `type="font/ttf"`. Preload **only** the one family used
  for the first paint; do not preload the optional reading fonts, or every visitor pays
  for fonts they never select.
- **Uthmanic Hafs is the exception.** It is KFGQPC-licensed and that licence restricts
  modification. Read the licence text in the desktop `THIRD-PARTY-NOTICES.md`. If format
  conversion is not clearly permitted, **leave the `.otf` files exactly as they are** and
  say so in your report. Do not guess on this one.
- Add a long-lived immutable `Cache-Control` header for `/fonts/*` in `next.config.ts`,
  the same way `/spellcheck/*` already has one.

## A4. Fix the documents that would undo this

`CLAUDE.md` currently lists `trad-arabic(.bold).ttf` and `Bahij_Nazanin-Regular.ttf` as
fonts to copy from the desktop. If that line stays, a future session will put them back.

- Update the Visual Identity section of `CLAUDE.md` to name only the fonts we are
  permitted to redistribute, and add one sentence recording *why* the other three were
  removed.
- If a copy of the `bilim-web` skill exists in this repo (e.g. `.claude/skills/`), it
  says the same thing in its "Gotchas" section — update it too, and tell me in the final
  report that my account-level copy of the skill needs the same edit.

---

# PART B — Attribution we are legally required to give

## B1. Qur'an sources

The Arabic text is from the **Tanzil Project** under **CC BY 3.0**; attribution is a
*condition of the licence*, not a courtesy. The Uyghur translation is by
**Shaykh Muhammad Salih**, published by **QuranEnc.com** (v1.0.2-xml.1).

The desktop added a source footer under every sura in v3.1.0. The web currently has
none — grep confirms the strings "Tanzil", "QuranEnc" and «مەنبە» appear nowhere under
`components/quran/`, `app/quran/` or `lib/quran/`.

Add the same attribution to the web:
- a source footer at the end of every sura on `/quran/[sura]`,
- a source line on the `/quran` index,
- links to `https://tanzil.net` and
  `https://quranenc.com/en/browse/uyghur_saleh`,
- an explicit statement that the Arabic text is unmodified.

Port the exact Uyghur wording from the desktop rather than inventing new phrasing.
It must be readable on a 375 px phone and must not overlap the sticky bottom bar.

## B2. `/about` page («بىلىم خەزىنىسى ھەققىدە»)

A public page, no login needed, linked from the footer or the main menu. Port the
content of the desktop's About dialog (`src/index.html`, `id="about"` and
`id="acredits"`) plus the full credits list:

- what the library is, who publishes it, that it is free with no ads and no tracking,
- every third-party source with its licence: UKIJ fonts (LGPL), Uthmanic Hafs (KFGQPC),
  Tanzil (CC BY 3.0), the Uyghur Qur'an translation (QuranEnc / Muhammad Salih),
  UyghurSpell (MIT), and every runtime npm dependency's licence family,
- a link to the desktop app at
  `https://github.com/kelemdepter-rgb/BilimHezinisi-desktop`,
- contact `kelemdepter@gmail.com` and a clear takedown statement: if anyone believes
  material here infringes their rights, it will be corrected or removed promptly.

## B3. Repository files

Add to the repo root, modelled on the desktop's versions:
- `LICENSE` — MIT, same as the desktop, correct year and holder.
- `THIRD-PARTY-NOTICES.md` — every bundled font, text and library with its licence and
  source URL. This must match what the site actually ships **after** Part A.

---

# PART C — Trust: things a reader cannot currently do

## C1. Password reset (currently impossible)

`app/(auth)/actions.ts` has exactly three actions: sign in, sign up, sign out. A reader
who forgets their password is locked out permanently — bookmarks, notes and reading
position are unreachable, and they cannot re-register with the same email.

Build it with Supabase Auth (free, already available):
- `/forgot-password` — enter email, call `resetPasswordForEmail` with a redirect to our
  callback. Always show the same neutral Uyghur confirmation whether or not the address
  exists (never reveal which emails are registered).
- A reset landing route that accepts the recovery link and lets the user set a new
  password via `updateUser`, then signs them in.
- A «پارولنى ئۇنتۇدىڭىزمۇ؟» link on the sign-in page.
- Apply the existing `lib/rate-limit.ts` to the request endpoint.
- Verify the Supabase email templates actually send on the Free plan and tell me, in
  simple Uyghur with exact button names, anything I must switch on in the Supabase
  dashboard.

## C2. Account deletion and data export

Add `/my/account` (signed-in only):
- **«سانلىق مەلۇماتىمنى چۈشۈرۈش»** — downloads one JSON file containing that user's
  bookmarks, book notes, reading progress, recent reads, Qur'an bookmarks and notebook
  documents. Generated for the requesting user only.
- **«ھېساباتىمنى ئۆچۈرۈش»** — a destructive action behind a confirmation where the user
  types their own email to proceed. A server action re-verifies the session, deletes the
  auth user with the service-role client, and removes every row belonging to them.
  Verify with a test that nothing of theirs survives.
- An admin must not be able to delete themselves by accident and leave the site with no
  admin — block the last remaining admin and explain why in Uyghur.

## C3. Privacy page

`/privacy`, public. Adapt the desktop `PRIVACY.md` to the web's reality — do not copy it
unchanged, because the web *does* have a server and the desktop does not. State plainly
and truthfully:
- reading, browsing and searching require no account and store nothing that identifies
  the reader;
- what an account stores (email address, bookmarks, notes, reading progress, notebook);
- where it is stored (Supabase) and where the site is hosted (Vercel);
- that there are no ads, no analytics, no trackers and no third-party scripts;
- how to export and delete everything (link to `/my/account`);
- contact address.

Only write statements you have verified against the actual code. If the code
contradicts a sentence you want to write, fix the code or change the sentence.

---

# PART D — Security headers (there are currently none)

`next.config.ts` sets only a cache header for `/spellcheck/*`. Add a `headers()` block
covering every route:

- `Content-Security-Policy` — as strict as the app allows. `default-src 'self'`;
  `img-src 'self' data: blob:` plus the Supabase storage host; `font-src 'self'`;
  `connect-src 'self'` plus the Supabase host; `frame-ancestors 'self'`;
  `object-src 'none'`; `base-uri 'self'`. Next's inline bootstrap script needs a nonce
  or a hash — implement it properly rather than falling back to blanket
  `'unsafe-inline'` for scripts. If you cannot make a nonce-based CSP work without
  breaking hydration, ship `Content-Security-Policy-Report-Only` first, prove the site
  is clean, and tell me exactly what is blocking enforcement — do not silently weaken it.
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy` denying camera, microphone, geolocation, payment and USB
- `X-Frame-Options: SAMEORIGIN`

Note in a comment that `connect-src` will need
`https://generativelanguage.googleapis.com` added when the AI layer lands, so a future
session does not disable the whole policy to make one request work.

Verify with the browser console empty of CSP violations on: home, book detail, reader,
search, Qur'an, notebook (the spellcheck worker and its `Cache Storage` fetch are the
most likely casualties), admin, and every auth page.

---

# PART E — One small waste

`public/brand.png` is **425 KB**. Find where it is used. If it is rendered anywhere a
visitor loads, serve it through `next/image` at the size actually displayed, or replace
it with a correctly-sized webp. If it is unused, delete it. Report which it was.

---

# Tests and reporting (mandatory)

- `npm run typecheck && npm run lint && npm run build` all pass.
- Existing unit and Playwright suites stay green at **375×667, 390×844 and 1280×800**.
- New Playwright coverage at all three viewports:
  - the reader's font picker offers only fonts we ship legally, and a profile with the
    old `"bahij"` value stored still loads without error;
  - `/about`, `/privacy` and the Qur'an source footer render with no horizontal overflow
    and are not covered by any sticky bar after scrolling down and back up;
  - the password-reset request page submits and shows the neutral confirmation;
  - `/my/account` export downloads a file and deletion is blocked until the email is
    typed correctly.
- A unit test asserting that `public/fonts/` contains none of the three removed
  filenames — so this can never silently regress.
- Grep proof in the report: the three font filenames appear nowhere in the repo.
- Final report in **simple Uyghur**: what was removed, what replaced it, whether
  Uthmanic Hafs was converted or left alone and why, whether the CSP is enforcing or
  report-only, and a numbered list of everything I must do myself (Supabase dashboard
  steps for email templates, applying any migration, re-running `ZAPASLA.bat`).

# Acceptance criteria
- No file in the repo or in the deployed output redistributes Bahij Nazanin or
  Traditional Arabic, and `CLAUDE.md` no longer instructs anyone to add them back.
- Readers on Windows still see Traditional Arabic if they pick it; nobody sees a broken
  or missing font; the picker offers more legitimate choices than before.
- Every Qur'an page credits Tanzil and QuranEnc; `/about`, `/privacy`, `LICENSE` and
  `THIRD-PARTY-NOTICES.md` exist and are accurate.
- A reader who forgets their password can recover it, and any reader can export or
  delete everything they have.
- Security headers are present on every route with a clean console.
- Nothing from Phases 1–12 regressed. No paid service and no new vendor account.
- Do NOT start the AI layer, the PWA, or any new reading feature — those are separate
  prompts.

Commit per logical step with English conventional messages. **If doing any of this
correctly would conflict with the free-tier rules, the mobile rules, or an existing
feature, stop and explain the trade-off to me in Uyghur rather than choosing silently.**
