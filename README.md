# Bilim Hezinisi — Web Edition

Public web edition of the Uyghur digital library «بىلىم خەزىنىسى».
Next.js (App Router, TypeScript, Tailwind CSS) + Supabase (Postgres, Auth,
Storage) + Vercel. The UI is Uyghur and fully RTL; anonymous visitors can
browse, read and search without an account.

See `CLAUDE.md` for the full project invariants (design tokens, roles, RLS,
mobile rules, build phases).

## Commands

```bash
npm install          # install dependencies
npm run dev          # dev server on http://localhost:3000
npm run typecheck    # next typegen + tsc --noEmit
npm run lint         # eslint
npm run build        # production build
npm run test         # Playwright suite (375x667, 390x844, 1280x800)
npm run test:unit    # vitest
```

`npm run test` starts two servers: the dev server on :3000, and a production
build on :3100 for the offline specs — Next's dev HMR client chunk is renamed
on every load, so a document cached for offline use could never find its
scripts again. That build goes to `.next-e2e/` so it cannot collide with the
dev server's `.next/`.

Running the suite several times inside ten minutes exhausts the sign-in rate
limiter (`lib/rate-limit.ts`), which on localhost puts every caller in one
bucket because there is no proxy header to tell them apart. The setup project
then fails to sign in. Restart the dev server to clear it — the limiter is
in-process by design.

## Offline reading, downloads and sharing

- **Installable.** `app/manifest.ts` plus icons generated from the desktop
  app's own `assets/icon.png` (`node scripts/build-icons.mjs`). iOS needs the
  `apple-mobile-web-app-capable` tag in `app/layout.tsx` to install full screen.
- **Offline.** `public/sw.js` is hand-written — no next-pwa. It stores only
  documents the server marked session-free (`x-bilim-cacheable`, set in
  `proxy.ts`) and only Supabase reads carrying nothing but the anon key.
  `tests/unit/sw-parity.test.ts` keeps its constants in step with
  `lib/pwa/constants.ts`. Bump `VERSION` in both to invalidate every cache.
- **Downloads.** DOCX and plain text/Markdown, built in the browser
  (`lib/books/export-book.ts`). `/api/books/[id]/download` authorises the read
  and rate limits it; the pages themselves still come straight from Supabase.
- **Egress.** `node scripts/measure-egress.mjs` measures a first and a repeat
  visit with and without the worker, against a production build on :3100.

## Environment (.env.local — never commit)

```
NEXT_PUBLIC_SUPABASE_URL=       # Supabase → Project Settings → API
NEXT_PUBLIC_SUPABASE_ANON_KEY=  # public anon key
SUPABASE_SERVICE_ROLE_KEY=      # server-only, never exposed to the client
ADMIN_EMAIL=                    # this account is auto-promoted to admin
SITE_URL=                       # e.g. https://your-app.vercel.app
```

The app renders without these (empty library, auth disabled) so the site can
be scaffolded and tested before the Supabase project exists.

## Licences and the pages that carry them

- `LICENSE` — MIT, and it covers this project's own source code only.
- `THIRD-PARTY-NOTICES.md` — every font, text and library the site serves,
  with its licence and source. It must be kept true to what is actually
  shipped; `tests/unit/font-licences.test.ts` fails the build if the fonts
  drift from it.
- `/about` and `/privacy` are public pages, no account needed, linked from
  the footer of every page. `/privacy` describes what this code does — check
  the code before changing a sentence in it.
- Fonts: only the UKIJ family (LGPL) and KFGQPC's Uthmanic Hafs are served.
  Rebuild the woff2 files after changing the manifest:

  ```bash
  node scripts/build-fonts.mjs
  ```

  Traditional Arabic and Bahij Nazanin may **not** be redistributed and are
  not in `public/fonts/`. Traditional Arabic is still offered in the reader,
  resolved from the reader's own Windows install.

## Accounts

- `/forgot-password` sends a Supabase recovery link, which lands on
  `/reset-password`. The answer is the same whether or not the address has an
  account, so the form cannot be used to discover who is registered.
- `/my/account` lets any signed-in reader download everything they own as
  JSON, or delete their account and every row belonging to it. The last
  remaining admin is refused, with the reason.

## Database

Migrations live in `supabase/migrations/`. Apply `0001_init.sql` in the
Supabase SQL Editor (or `npx supabase db push` when the project is linked).
Never edit an applied migration — add a new file.

### Where the functions run

The Supabase project is in **eu-west-2 (London)**, so `vercel.json` pins the
Vercel functions to **`lhr1`** — the same city. Without that key Vercel puts
them in `iad1` (Washington D.C.) by default, and every one of the Supabase
round trips a page makes crosses the Atlantic twice. Keep the two in the same
region: if the Supabase project is ever moved, move `regions` with it.

## Free tier — كۇتۇپخانىنى ھەقسىز ساقلاش

بۇ سايت Supabase ۋە Vercel نىڭ ھەقسىز نۇسخىسىدا ئىشلەيدۇ. چەكلىمە: ساندان
**500 MB**، ساقلاش **1 GB**، ئېقىم **5 GB/ئاي**.

### بوشلۇقنى ئۆلچەش

```bash
node --env-file=.env.local scripts/db-usage.mjs
```

قايسى جەدۋەل ۋە قايسى ئىندېكسنىڭ قانچە جاي ئىگىلىگىنىنى، ھەر كىتابقا قانچە
بايت كەتكىنىنى ۋە يەنە قانچە كىتاب سىغىدىغانلىقىنى كۆرسىتىدۇ. `/admin` بېتىدىمۇ
ئوخشاش ئۇچۇر كۆرۈنىدۇ.

### زاپاسلاش (backup) — ئەڭ مۇھىم ئىش

Supabase يوقاپ كەتسە ياكى ھېسابات ئېتىلىپ قالسا، كىتابلىرىڭىز يوقالماسلىقى
ئۈچۈن ۋاقىتلىق زاپاسلاپ تۇرۇڭ:

```bash
node --env-file=.env.local scripts/backup.mjs
```

`backups/` قىسقۇچىغا زىپلانغان بىر ھۆججەت چۈشىدۇ. **ئۇنى كومپيۇتېرىڭىزدىن
باشقا يەرگىمۇ كۆچۈرۈپ قويۇڭ** (USB دىسكا ياكى بۇلۇت دىسكا).

**قانچىلىك ئارىلىقتا؟** يېڭى كىتاب قوشقان ھەر قېتىمدىن كېيىن، ياكى ئاز
دېگەندە **ئايدا بىر قېتىم**.

### ئەسلىگە قايتۇرۇش (restore)

يېڭى (بوش) Supabase لايىھەسىگە:

```bash
node --env-file=.env.local scripts/restore.mjs backups/bilim-backup-2026-08-07.ndjson.gz
```

ئالدىن سىناپ كۆرۈش ئۈچۈن `--dry-run` قوشۇڭ — ھېچنېمە يېزىلمايدۇ. قايتا ئىجرا
قىلىشقا بولىدۇ، تەكرارلانمايدۇ.

### سايت ئۇخلاپ قالماسلىقى ئۈچۈن

Supabase نىڭ ھەقسىز لايىھەسى 7 كۈن جىمجىت تۇرسا توختايدۇ. شۇڭا `vercel.json`
دا كۈندە بىر قېتىم `/api/health` نى چېكىدىغان cron بار. Vercel دا
`CRON_SECRET` مۇھىت ئۆزگەرگۈچىسىنى قويۇڭ (خالىغان ئۇزۇن مەخپىي سۆز).

## ئىملا لۇغىتىنى قايتا قۇرۇش

لۇغەت `public/spellcheck/uyghur-dict.bin` دا تەييار تۇرىدۇ ۋە git تا بار، شۇڭا
**ئادەتتە قايتا قۇرۇشنىڭ ھاجىتى يوق**. پەقەت مۇنۇ ئۈچ ئەھۋالدا لازىم بولىدۇ:

- `data/spellcheck/vocabulary.txt` نى تەھرىرلىگەندە (سۆز قوشقاندا/تۈزەتكەندە)
- كۇتۇپخانىغا يېڭى كىتاب قوشۇلغاندا (سۆز كۆپلۈكى ئۆزگىرىدۇ)
- دېسكتوپ دېتالنىڭ لۇغىتى يېڭىلانغاندا

### تەرتىپى مۇھىم

```bash
# 1. كىتابلارنى ئوقۇپ سۆز كۆپلۈكىنى ھېسابلاش  (ئىنتېرنېت + .env.local كېرەك)
node --env-file=.env.local scripts/build-word-frequencies.mjs

# 2. قوشۇمچە تىزىملىكىنى لۇغەتتىن قېزىش
node --env-file=.env.local scripts/build-suffixes.mjs

# 3. يېڭى سۆز نامزاتلىرىنى تەۋسىيە قىلىش  (خالىغاندا)
node --env-file=.env.local scripts/build-vocabulary.mjs

# 4. ئاخىرقى لۇغەتنى ياساش
node scripts/build-spelldict.mjs

# 5. تەكشۈرۈش
npm run test:unit
```

1-قەدەم كىتابلارنى ئوقۇيدۇ ۋە نەتىجىنى `spellcheck-data/` غا ساقلايدۇ. ئۇ قىسقۇچ
git تا **يوق** (چوڭ، ھەم قايتا ياسىغىلى بولىدۇ)، شۇڭا يېڭى clone دا 1 ۋە 2 نى
چوقۇم ئىجرا قىلىش كېرەك. ئۇنىڭسىز 4-قەدەم **توختايدۇ** — بۇرۇن ئاگاھلاندۇرۇپ
داۋاملىشاتتى، ۋە سۆز كۆپلۈكىسىز لۇغەت ياساپ قوياتتى: سىرتتىن قارىغاندا ساغلام،
ئەمما تەۋسىيەلەرنىڭ تەرتىپى ناچار.

كىتابلار ئۆزگەرمىگەن بولسا 1-قەدەمنى `--rescan` سىز ئىجرا قىلىڭ — ساقلانغان
نۇسخىنى ئىشلىتىدۇ ۋە تېز تۈگەيدۇ.

### تىزىملىكنى ئوقۇغاندا

`data/spellcheck/vocabulary.txt` ھەر قۇرغا ئۈچ خىل قارار قوبۇل قىلىدۇ:

```
سۆز    5   3              ← توغرا. لۇغەتكە قوشۇلىدۇ.
سۆز    5   3   = توغرىسى  ← خاتا. لۇغەتكە كىرمەيدۇ، توغرىسى تەۋسىيە قىلىنىدۇ.
سۆز    5   3   -          ← سۆز ئەمەس. چەتكە قېقىلىدۇ، قايتا سورالمايدۇ.
```

قارارلىرىڭىز تىزىملىك قايتا ياسالغاندىمۇ ساقلىنىدۇ. ئەگەر سۆزلەرنى `=` بەلگىسىز،
ئورنىدا تۈزەتكەن بولسىڭىز، `scripts/adopt-review.mjs` جۈپلەرنى ئەسلىگە
كەلتۈرەلەيدۇ (يان تەرەپتىكى ئىككى ساننى ئۆزگەرتمىگەن بولسىڭىز).

## Troubleshooting

**Every Supabase call fails with `fetch failed` / pages take ~7 s.**
Check the dev server output for `UNABLE_TO_VERIFY_LEAF_SIGNATURE`. Antivirus
or VPN software that inspects HTTPS re-signs traffic with its own root
certificate, and Node does not read the OS certificate store by default, so
it rejects the connection. The `dev` script therefore runs with
`NODE_OPTIONS=--use-system-ca`, which makes Node trust the system store in
addition to its bundled CAs.

`dev` and `test` both carry it: several specs call Supabase directly with the
service role (seeding accounts, and proving that a deleted account left no
rows), and without the flag those calls fail intermittently with a bare
`fetch failed`. `build` and `start` are left untouched so deployments are
unaffected — the flag needs Node ≥ 22.15 and the interception does not exist
on the hosting side. If a standalone script hits the same wall, run it as
`node --use-system-ca script.mjs`.
