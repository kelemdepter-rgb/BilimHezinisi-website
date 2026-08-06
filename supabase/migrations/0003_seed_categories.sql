-- ============================================================================
-- Phase 2 groundwork:
--   1. Seed the default Uyghur category list from the desktop app
--      (defaultCats() in main.js). The desktop list is flat, so these all seed
--      as top-level rows; the web adds hierarchy through the admin UI.
--   2. Guard the last admin account at the database level.
-- ============================================================================

-- ── 1. Default categories ───────────────────────────────────────────────────
-- Names come verbatim from the desktop app so a later library migration lines
-- up. Icons are ids from the shared SVG sprite (components/icons.tsx).

insert into public.categories (name, icon, sort_order)
values
  ('قۇرئان ۋە تەپسىر',            'mosque',        0),
  ('ھەدىسلەر',                    'scroll',        1),
  ('فىقھى كىتابلار',              'scale',         2),
  ('تەۋھىد ۋە ئەقىدە',            'star',          3),
  ('تارىخ',                       'landmark',      4),
  ('ئەدەبىي ئەسەرلەر',            'feather',       5),
  ('تىل-ئەدەبىيات',               'languages',     6),
  ('سىيرەت',                      'book-marked',   7),
  ('ئۇيغۇرچە ئوقۇشلۇق كىتابلار',  'book-open',     8),
  ('بالىلار كىتابلىرى',           'smile',         9),
  ('لازىملىق كىتابلار',           'bookmark',     10),
  ('مۇھىم ئەسەرلەر',              'layers',       11),
  ('باشقا',                       'folder',       12)
on conflict (name) do nothing;

-- ── 2. Never let the site end up with no admin ──────────────────────────────
-- The admin UI checks this too, but the trigger is the real guarantee: it also
-- covers the SQL editor, the service role and any future client.

create or replace function public.protect_last_admin()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  remaining int;
begin
  if tg_op = 'UPDATE' and old.role = 'admin' and new.role <> 'admin' then
    select count(*) into remaining
      from public.profiles p
     where p.role = 'admin' and p.id <> old.id;
    if remaining = 0 then
      raise exception 'the last admin cannot be demoted';
    end if;
  elsif tg_op = 'DELETE' and old.role = 'admin' then
    select count(*) into remaining
      from public.profiles p
     where p.role = 'admin' and p.id <> old.id;
    if remaining = 0 then
      raise exception 'the last admin cannot be removed';
    end if;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end
$fn$;

create trigger profiles_protect_last_admin_update
  before update on public.profiles
  for each row execute function public.protect_last_admin();

create trigger profiles_protect_last_admin_delete
  before delete on public.profiles
  for each row execute function public.protect_last_admin();
