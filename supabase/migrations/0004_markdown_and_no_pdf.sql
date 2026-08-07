-- ============================================================================
-- Upload pipeline change (CLAUDE.md, Upload Pipeline):
--   1. Record how each book's pages are stored, so the reader knows whether to
--      render Markdown or plain text. Existing books stay 'text' and therefore
--      look exactly as they do today.
--   2. Refuse NEW PDF books at the database level, not only in the UI.
-- ============================================================================

alter table public.books
  add column if not exists content_format text not null default 'text'
    check (content_format in ('markdown', 'text'));

-- ── Server-side PDF rejection ───────────────────────────────────────────────
-- Enforced on INSERT only, deliberately:
--   * a crafted client cannot create a PDF book, and
--   * books uploaded before this change (the library already holds one PDF)
--     stay fully readable AND editable — an UPDATE trigger would block even a
--     title correction on them.

create or replace function public.reject_pdf_books()
returns trigger
language plpgsql
as $fn$
begin
  if upper(coalesce(new.format, '')) = 'PDF' then
    raise exception 'PDF is not supported on the web edition; export DOCX from the desktop app';
  end if;
  return new;
end
$fn$;

create trigger books_reject_pdf
  before insert on public.books
  for each row execute function public.reject_pdf_books();
