-- ============================================================================
-- No search operators at all.
--
-- The owner's call, and the right one for this library: someone typing into a
-- search box does not think in operators. Quoted phrases, OR and -exclusion
-- are gone; the "this word is too common" hint already says what to do, and
-- adding another word is a far more natural fix than learning a syntax.
--
-- What remains is the whole contract: every word you type must appear, matched
-- from its beginning (0015), and the result takes you to that exact place.
--
-- The query is tokenized by Postgres itself rather than split by hand. Running
-- to_tsvector over the query produces exactly the lexemes the documents were
-- indexed with, so punctuation someone types out of old habit — a quote, a
-- stray dash — is dropped by the same tokenizer that dropped it from the text,
-- instead of becoming a lexeme like «"بسم» that could never match anything.
-- ============================================================================

create or replace function public.ug_tsquery(q text)
returns tsquery
language sql
immutable
as $fn$
  select coalesce(
    (
      -- Each lexeme of the query, as a prefix, all required.
      select to_tsquery('simple', string_agg(quote_literal(lexeme) || ':*', ' & '))
      from unnest(to_tsvector('simple', public.ug_normalize(q)))
    ),
    -- Nothing tokenizable was typed: an empty query, which matches nothing.
    plainto_tsquery('simple', '')
  )
$fn$;

grant execute on function public.ug_tsquery(text) to anon, authenticated;
