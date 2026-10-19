-- ============================================================================
-- In-book links: what a book's headings and `#…` links are (PROMPT-51).
--
-- A Word table of contents is a list of internal hyperlinks to bookmarks.
-- mammoth turns each entry into <a href="#QBH1"> and each bookmark into an
-- empty <a id="QBH1"></a>; turndown keeps the link as `[label](#QBH1)` and
-- drops the empty anchor. So the stored Markdown has the links and none of
-- their targets, and every TOC entry in the reader was a gold, underlined
-- link that went nowhere. Footnotes come out the same way: `[\[1\]](#footnote-1)`
-- in the text and `[↑](#footnote-ref-1)` at the end of each note.
--
-- The targets are recovered in the reader, at click time, from the text that
-- is already stored (lib/reader/internal-links.ts): a TOC label is matched to
-- the heading it names, a note link to the link that points back at it. This
-- function hands the reader what that needs and nothing else, so no book is
-- re-uploaded, no stored text changes, and the renderer stays as it is.
--
-- ── What it returns ──────────────────────────────────────────────────────────
-- ONE jsonb value, never a set of rows: anon's PostgREST answers stop at 1,000
-- rows (pgrst.db_max_rows, 0009), and a book's outline can be longer than that.
--   {"v": 1, "capped": false, "entries": [...]}
-- `entries` in document order — page_no, then position in the page — each a
-- compact array:
--   [page_no, "h", level, text]    an ATX heading: `#`…`######`, at most three
--                                  spaces before it; text as written, ≤ 300
--                                  characters. turndown writes only ATX
--                                  headings (and escapes a line that would
--                                  make a setext one), and no book in the
--                                  library came in as raw .md.
--   [page_no, "l", label, frag]    an inline link whose destination starts
--                                  with `#`: the label as written (escaped
--                                  brackets and all, ≤ 300) and the fragment
--                                  without `#` (≤ 200).
--   [page_no, "f", marker, info]   a line opening or closing a ``` or ~~~
--                                  code block (info ≤ 100), so the reader
--                                  ignores headings and links inside code.
-- At most 5,000 entries; `capped` says when the book had more.
--
-- One regular expression does it, in one pass per page: ^ and $ match at line
-- breaks ('w'), everything else may cross them, so a link label broken over
-- two lines is still one link. lib/reader/outline.ts is the same expression
-- for the browser — the offline path, the e2e stub and the import test — and
-- tests/unit/book-outline-sql.test.ts holds the two to the same answer.
--
-- ── Who sees what ────────────────────────────────────────────────────────────
-- SECURITY INVOKER: it reads book_pages as the caller, so RLS decides —
-- "book_pages_select_published_or_staff" (0001) gives anonymous readers the
-- published books only and staff their drafts as well. A book the caller may
-- not read answers exactly like a book with no headings: no entries.
--
-- ── Why it takes no search slot (0028) ───────────────────────────────────────
-- The slots protect the database from what a search costs: a walk over the
-- whole library's index. This reads ONE book's pages by primary key — the
-- same rows anyone can already fetch through REST with
-- `book_pages?book_id=eq.N` — and the reader calls it at most once a visit,
-- only after a link in the book has been touched. A pool of its own would
-- only add a way for a reader to be refused something that costs a page read.
-- ============================================================================

create or replace function public.book_outline(p_book_id bigint)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $fn$
  with found as (
    select p.page_no, m.n, m.g
      from public.book_pages p
     cross join lateral regexp_matches(
             p.content,
             '^ {0,3}(#{1,6})[ \t]+([^\n]*)$'
             '|^ {0,3}(`{3,}|~{3,})([^\n]*)$'
             '|\[((?:[^][\\]|\\.)*)\]\(#((?:[^() \t\n\r\f\v\\]|\\.)*)(?:[ \t]+"[^"\n]*")?\)',
             'gw'
           ) with ordinality as m(g, n)
     where p.book_id = p_book_id
  ),
  entries as (
    select case
             when f.g[1] is not null then jsonb_build_array(f.page_no, 'h', length(f.g[1]), left(f.g[2], 300))
             when f.g[3] is not null then jsonb_build_array(f.page_no, 'f', f.g[3], left(btrim(f.g[4], E' \t'), 100))
             else jsonb_build_array(f.page_no, 'l', left(f.g[5], 300), left(f.g[6], 200))
           end as entry,
           row_number() over (order by f.page_no, f.n) as rn
      from found f
  )
  select jsonb_build_object(
           'v', 1,
           'capped', count(*) > 5000,
           'entries', coalesce(jsonb_agg(e.entry order by e.rn) filter (where e.rn <= 5000), '[]'::jsonb)
         )
    from entries e
$fn$;

-- ── Who may call it ──────────────────────────────────────────────────────────
revoke all on function public.book_outline(bigint) from public;
grant execute on function public.book_outline(bigint) to anon, authenticated;

-- PostgREST learns the new function at once.
notify pgrst, 'reload schema';
