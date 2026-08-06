# PROMPT 4 — فورماتلار (PDF سىز، Markdown) + ھەقسىز ھالەتتە توختىماي ئىشلەش
3-باسقۇچ تۈگىگەندىن كېيىن، مۇشۇ سىزىقتىن تۆۋەنكى تېكىستنى Claude Code غا چاپلاڭ.
(بۇرۇنقى `PROMPT-MARKDOWN.md` ۋە `PROMPT-FREE-TIER.md` نىڭ ئورنىنى بۇ ئالدى)

---

Strictly follow **CLAUDE.md** (its "Upload Pipeline" section was just rewritten — read
it first) and use the **bilim-web** skill.

## Why this task exists — two hard constraints
1. **No PDF, no OCR, anywhere on the web edition.** PDFs are large, scanned ones need
   OCR the web cannot do, and the PDF library bloats the phone bundle. The desktop app
   handles PDFs and OCR; the web only accepts what the desktop app can export.
2. **The owner has no budget — ever.** This site must run indefinitely on Supabase Free
   + Vercel Hobby and must never pause, because it is a free public library. Do not add
   any paid service and do not add a new vendor account.

Do PART A first (it changes what gets stored), then PART B (which measures storage).

---

# PART A — Formats: remove PDF/OCR, convert Word to Markdown

## A1. Remove PDF and OCR completely
- Accepted formats become exactly: `.docx`, `.doc`, `.md`, `.html` / `.htm`, `.txt`,
  and web URL. Nothing else.
- Remove PDF from the file-picker `accept` attribute, from drag-drop validation, from
  server-side validation, and from every format list, hint, placeholder and help string
  in the UI.
- If a PDF is selected anyway (drag-drop, rename, or a crafted request), reject it —
  client AND server — with a clear Uyghur message: open it in the desktop
  «بىلىم خەزىنىسى» app, OCR it there if it is scanned, export it as DOCX, then upload
  the DOCX here.
- Delete every now-dead code path: pdfjs-dist extraction, scanned-PDF detection,
  PDF-first-page cover generation, and any related types, constants, tests and copy.
- **Remove `pdfjs-dist` from `package.json`**, from `public/` (any copied worker file),
  and from any config that references it. Then verify with a search that no reference
  to `pdf`, `pdfjs` or OCR remains in application code or UI strings (matches in book
  content, or in text explaining "convert your PDF in the desktop app", are fine).
- Confirm no OCR library (tesseract.js or similar) exists in this project; if one does,
  remove it. OCR is desktop-only and must never be added here.
- Report the client bundle size before and after — dropping pdfjs should be a real
  speed win on phones.
- Covers now come only from a manual image upload or the generated placeholder card.

## A2. Store Markdown instead of plain text
Plain-text extraction throws away headings, bold, lists and tables, which matters for
scholarly books. Markdown preserves that structure and costs far less space than HTML.

- `.docx` → **mammoth `convertToHtml`** (not `extractRawText`) → **turndown** →
  Markdown. Preserve headings, bold/italic, ordered & unordered lists, blockquotes,
  links and tables (turndown GFM plugin for tables). Drop embedded images instead of
  inlining them as base64 — CLAUDE.md forbids blobs in Postgres.
- `.html` / `.htm` and web-URL import → turndown → Markdown (readability first for URLs,
  as today).
- `.md` → stored as-is.
- `.txt` and legacy `.doc` (word-extractor) → plain text; they carry no formatting.
  In the UI, suggest re-saving a `.doc` as `.docx` in Word to keep formatting.
- Add a `content_format` column to `books` (`'markdown' | 'text'`, default `'text'`) in
  a NEW migration and set it correctly on upload. Books already uploaded keep `'text'`,
  so nothing existing changes appearance.
- Chunking into `book_pages` must still split on paragraph boundaries AND must never
  cut a Markdown block in half — no splitting inside a table or code block, and no
  splitting between a heading and its first paragraph. Update the chunker and its tests.

## A3. Reader renders Markdown properly
- Render `content_format='markdown'` pages through a Markdown renderer with **inline
  HTML disabled**, then through the existing sanitizer (`lib/sanitize.ts`). No raw HTML
  passthrough, ever.
- Style headings, bold, lists, blockquotes and tables with the existing manuscript
  design tokens; they must look correct in RTL and in all three themes, and must obey
  the reader's font-size / font-family / line-height controls.
- Tables must not cause horizontal overflow at 360 px: wrap them in a scroll container
  with `overscroll-contain` that does not trap body scroll.
- `content_format='text'` pages render exactly as they do today.

## A4. Search must not degrade
- Verify with real Uyghur and Arabic queries that Markdown syntax (`**`, `#`, `-`, `|`)
  does not break matching — a word written `**سۆز**` must still be found by `سۆز`.
- **Strip Markdown syntax from search snippets before display** so results read as
  clean prose, keeping `<mark>` highlighting intact and safely rendered.
- Show before/after results for the same query set.

## A5. Admin experience
- Format hints, empty states and the book-edit screen all state the supported formats
  in Uyghur, with no mention of PDF as an option.
- The wizard preview step shows the **rendered** Markdown (as readers will see it),
  with a toggle to inspect the raw source.

---

# PART B — Make the free tier last

## B1. MEASURE FIRST — never optimise blind
Write `scripts/db-usage.mjs` (service-role, read-only) reporting: total database size;
size per table AND per index (`pg_total_relation_size`, `pg_relation_size`,
`pg_indexes_size`); Storage bucket sizes; book count; page count; average bytes per
book. Run it and print a clear table. Every change below is judged against these real
numbers — report before/after for each.

## B2. Shrink the database (500 MB is the real wall)
In a NEW migration:

a) **Drop `book_pages_trgm_idx`.** A GIN trigram index over the full text of every page
   is typically 1–3× the size of the text itself — the single biggest consumer. Keep the
   trigram index on `books.title || author` (tiny, and it powers partial-title lookup).
   Page-content search continues through the FTS index.

b) **Remove the stored `content_norm` tsvector column** and replace it with an
   expression index:
   `create index ... on public.book_pages using gin (to_tsvector('simple', public.ug_normalize(content)));`
   The stored column is a second full copy of the search data. Update `search_books` to
   use the same expression so the index is still used — `explain analyze` must show an
   index scan, not a seq scan — and compute `ts_rank` only on matched rows.

c) Check that no column stores the book text twice (e.g. an oversized `description`).

d) Confirm long text is TOAST-compressed
   (`alter table ... alter column content set storage extended` if not).

**Search quality must not regress.** Run the SAME real queries before and after (single
word, quoted phrase, a word with hamza/ya variants, a rare word deep inside a book) and
show that results and snippets match. If dropping the trigram index measurably breaks a
search style the desktop app supports, **tell me instead of silently accepting the loss**.

Report: "before X MB/book → after Y MB/book → free tier now holds ≈ Z books".

## B3. Cut egress (5 GB/month cap)
a) **Covers through `next/image`**: configure `images.remotePatterns` for the Supabase
   Storage host and replace the raw `<img>` cover tags in
   `components/library/book-card.tsx`, `components/library/recent-strip.tsx` and the
   book detail page (correct `sizes`, `loading="lazy"`). Vercel then caches optimised
   covers on its CDN, so Supabase is hit once, not once per visitor.
b) **Smaller covers**: cap at ~400 px wide, WebP, ≤30 KB. Add an admin action to
   re-compress existing covers.
c) **Cache public pages**: home, book detail and book pages are near-static — use ISR /
   `revalidate` and proper `Cache-Control` so repeat visits are served by Vercel's CDN.
   Admin pages and per-user data stay dynamic and private (`no-store`); never cache
   anything user-specific.
d) Verify: loading the home page twice must not cause a second Supabase request for the
   same cover.

## B4. Never let the project pause (Supabase Free pauses after ~7 idle days)
- Add `app/api/health/route.ts`: one trivial query (e.g. `select count(*) from
  categories`), returns `{ok:true}`, no secrets, no user data.
- Add `vercel.json` with a **Vercel Cron** job hitting it **once per day** (Hobby allows
  daily crons), protected by a `CRON_SECRET` header check.
- Show the last successful ping time on `/admin` so I can see at a glance that the site
  is alive.

## B5. Admin usage panel — so I see the limits coming
On `/admin`, a clear Uyghur panel showing: database used / 500 MB, storage used / 1 GB,
books, pages, and **estimated remaining book capacity** from the measured average.
Colour states normal / warning at 70 % / critical at 85 %, each with a short Uyghur
sentence telling me what to do. Server-side, admin only.

## B6. Never lose the library — free backup
- `scripts/backup.mjs`: exports books + pages + categories to a compressed
  JSON/NDJSON file on my computer; resumable; service-role; no paid feature.
- `scripts/restore.mjs`: restores that file into an empty project, so if Supabase is
  ever lost I can rebuild on a fresh free project the same day.
- Document both in `README.md` in simple Uyghur, including how often to run a backup.

## B7. Keep the door open (no cost now)
Centralise every Storage call behind one module `lib/storage.ts` (`uploadFile`,
`getPublicUrl`, `removeFiles`), used by `lib/books/save.ts`, `lib/library.ts` and
`app/admin/books/actions.ts`. Implementation stays Supabase Storage today; the point is
that switching to Cloudflare R2 later becomes a one-file change. **Do not add R2 now.**

## B8. Confirm it all stays free
Vercel Hobby suits a non-commercial free library (no ads, no payments). Explicitly check
and state that nothing in the code requires a Vercel or Supabase paid plan.

---

# Tests + final report (mandatory)
- `npm run typecheck && npm run lint && npm run build` pass; existing Playwright suites
  still green at 375×667, 390×844, 1280×800.
- Unit tests: DOCX→Markdown keeps headings/bold/lists/tables; the chunker never splits a
  table or code block; the snippet-stripper removes syntax but keeps `<mark>`.
- Playwright: a `.docx` uploads end-to-end; a `.pdf` is rejected with the Uyghur
  guidance message; the reader renders a Markdown book correctly in all three themes
  with no horizontal overflow; the health route returns ok; the admin usage panel
  renders for admin and is blocked for a reader.
- Final report in simple Uyghur: what changed, bundle size before/after, measured DB
  bytes per book before/after, how many books now fit free, and exactly what I must do
  myself (apply the new migrations, set `CRON_SECRET` in Vercel, run the first backup).

# Acceptance criteria
- PDF cannot be uploaded anywhere, `pdfjs-dist` is gone, and no OCR code exists here.
- A real Word document with headings, bold text, lists and a table uploads and reads
  back with that formatting intact, on a phone, in all three themes.
- Search still finds words inside formatted text; snippets show clean prose.
- Measured database bytes per book dropped substantially with search results unchanged.
- Covers are served from Vercel's CDN, not repeatedly from Supabase.
- A daily cron keeps the project from ever pausing; `/admin` shows remaining capacity.
- I have a working backup and restore I can run myself.
- Zero new paid services, zero new vendor accounts, nothing already uploaded looks
  different.

Commit per logical step with English conventional messages. Ask me first if a change
would trade away real search quality for space, or if removing PDF support would break
something I have not anticipated.
