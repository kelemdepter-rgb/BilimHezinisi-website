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
