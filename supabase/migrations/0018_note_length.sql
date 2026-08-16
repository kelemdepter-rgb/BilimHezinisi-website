-- The notes list shows how long each note is. Reading content_text just to
-- call .length in JavaScript would download every note in full to render a
-- list of titles: twenty long notes is over a megabyte of egress for a number
-- Postgres already knows. A stored generated column costs 4 bytes per row and
-- lets the list select nothing but metadata.
alter table public.note_documents
  add column if not exists content_length integer
  generated always as (length(content_text)) stored;
