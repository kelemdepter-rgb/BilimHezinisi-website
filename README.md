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
npm run test         # Playwright smoke tests (375x667, 390x844, 1280x800)
```

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

## Database

Migrations live in `supabase/migrations/`. Apply `0001_init.sql` in the
Supabase SQL Editor (or `npx supabase db push` when the project is linked).
Never edit an applied migration — add a new file.

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

This is deliberately applied to `dev` only. `build` and `start` are left
untouched so deployments are unaffected — the flag needs Node ≥ 22.15 and the
interception does not exist on the hosting side. If a standalone script hits
the same wall, run it as `node --use-system-ca script.mjs`.
