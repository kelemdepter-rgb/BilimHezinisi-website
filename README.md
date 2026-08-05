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
