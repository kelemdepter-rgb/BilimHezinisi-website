-- ============================================================================
-- The book-request inbox is withdrawn.
--
-- 0022 gave a reader a way to ask for a book without an account, and gave the
-- admin an inbox to read the requests in. The owner withdrew the feature on
-- 2026-09-11: the library does not need it, and the contact address on /about
-- is the channel that replaces it. The form, the inbox and every helper that
-- touched this table are gone from the code in the same change.
--
-- What goes, in order:
--
--   1. the trigger, so nothing fires while the table is being taken apart;
--   2. the table — its two indexes and all four RLS policies go with it;
--   3. the trigger function, which existed for this table and nothing else.
--
-- The table's daily and total caps existed only to keep it out of the 500 MB
-- free-tier budget; dropping it gives that room back outright.
--
-- public.is_admin() is NOT touched: other policies use it.
--
-- This is the irreversible step. Every request ever sent is deleted with the
-- table, which the owner has been told and has accepted.
-- ============================================================================

drop trigger if exists book_requests_cap on public.book_requests;

drop table if exists public.book_requests;

drop function if exists public.book_requests_guard();
