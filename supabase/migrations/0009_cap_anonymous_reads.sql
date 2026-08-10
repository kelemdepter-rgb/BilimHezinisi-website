-- ============================================================================
-- Cap what one anonymous request can pull out of the database.
--
-- The site's own code already clamps every limit and offset it sends, but the
-- anon key is public by design: anybody can call PostgREST directly and ask
-- for `book_pages?select=*` with no range at all. On a 5 GB/month egress
-- allowance that is the cheapest way to run the library out of budget.
--
-- Measured before writing this: an anonymous `quran_ayas?select=sura,aya` with
-- no range already comes back with exactly 1,000 of its 6,236 rows, so Supabase
-- ships this cap as a project default today. What follows PINS that default on
-- the role, so the guarantee belongs to this project rather than to a platform
-- setting that could be changed in a dashboard or altered upstream.
--
-- `pgrst.db_max_rows` is enforced by PostgREST itself, on the ROLE, so it
-- applies to every anonymous request whatever the client does. 1,000 is well
-- clear of the largest page the site legitimately renders (Al-Baqara's 286
-- ayas, the 114 suras, a 24-book library page, 50 search hits).
--
-- Signed-in roles are left alone: the admin book list and the migration script
-- legitimately read more than this, and both are authenticated.
-- ============================================================================

alter role anon set pgrst.db_max_rows = '1000';

-- PostgREST caches role settings; without this it keeps the old limit until
-- the next connection recycle.
notify pgrst, 'reload config';
