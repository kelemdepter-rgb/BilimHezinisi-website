# PROMPT 2 — Phase 2: Books & Admin
مۇشۇ سىزىقتىن تۆۋەنكى تېكىستنى Claude Code غا چاپلاڭ.
(BilimHezinisi-website قىسقۇچىدا تېرمىنال ئېچىپ `claude` نى ئىجرا قىلىڭ)

---

Strictly follow **CLAUDE.md** in this folder and use the **bilim-web** skill.
Phase 1 is DONE and live on Vercel (`bilim-hezinisi-website.vercel.app`): design
tokens, RTL shell, themes, full schema + RLS, auth, admin guard.
Now execute **Phase 2 — Books & Admin**. Work only inside this folder; the desktop app
at `../bilim hezinisi/bilim hezinisi pc` stays a read-only reference (port its parser
and metadata logic from `main.js` / `database.js`).

## 0. Small carry-overs first
- Read `supabase/migrations/0001_init.sql` and `lib/data.ts` before writing code so
  new work matches the existing column names exactly.
- Remind me at the END of your work (do not do it yourself): Vercel env `SITE_URL`
  must become `https://bilim-hezinisi-website.vercel.app`, and Supabase
  Authentication → Confirm email must be turned back ON before the site is shared
  publicly.

## 1. Category tree management (`/admin/categories`)
- Full CRUD over the hierarchical `categories` table: create (with parent), rename,
  change icon (pick from the existing SVG sprite), delete (block deletion when the
  category still has children or books — show a clear Uyghur message).
- Reorder and re-parent by drag-and-drop, persisting `sort_order` and `parent_id` in
  one batched Server Action. Provide keyboard/tap alternatives (up/down/indent
  buttons) — drag-and-drop must NOT be the only way, per the Mobile Rules.
- Seed the default Uyghur category tree from the desktop app if it defines one;
  otherwise create a small sensible starter tree in a new migration.

## 2. Book upload wizard (`/admin/books/new`) — admin/uploader only
Multi-step, all extraction in the BROWSER (never send big files to the server):
1. **Choose file(s)**: PDF, TXT, DOCX, DOC, HTML, MD, or a web URL. Drag-drop + file
   picker. Multiple files = queue them and process one by one with visible progress.
2. **Extract**: pdfjs-dist for PDF, mammoth for DOCX, plain read for TXT/MD,
   turndown for HTML. Web URL → server route using @mozilla/readability (small HTML
   only). `.doc` → server route, reject over 4 MB with a message telling me to convert
   it in the desktop app.
   - Detect scanned PDFs (no text layer): stop and tell me to OCR it in the desktop
     app first. Do NOT attempt OCR here.
   - Compute the SHA-256 `file_hash` like the desktop app and warn on duplicates
     BEFORE any upload happens.
3. **Chunk**: split the extracted text into `book_pages` of ~2,000–3,000 chars on
   paragraph boundaries (never mid-word/mid-sentence). Show the resulting page count.
4. **Metadata**: title, author, category (tree picker), date, description, language,
   status draft/published. Pre-fill from the file (PDF metadata / first heading /
   filename) exactly the way the desktop app guesses it.
5. **Cover**: optional image upload, or auto-generate the first PDF page as the cover
   in the browser (canvas → webp/jpeg, max ~800 px wide). Uploads DIRECTLY to the
   `covers` Storage bucket via a signed upload URL.
6. **Optional original file**: a checkbox "ئەسلى ھۆججەتنى ساقلاش" — when ticked, the
   original uploads DIRECTLY to the `book-files` bucket via a signed URL; otherwise
   only text is stored (this is my default: text-first).
7. **Save**: insert the book row, then the pages in batches of ≤500 rows per request,
   with a progress bar and a resumable/retry path if a batch fails. Roll back cleanly
   (delete the partial book) if the user cancels.

## 3. Book management (`/admin/books`)
- Paginated, searchable list: title, author, category, status, page count, date.
- Edit metadata; toggle draft/published; replace cover; delete book (cascades pages,
  and removes its Storage objects).
- Bulk actions: publish / unpublish / delete selected, move to category.

## 4. User & role management (`/admin/users`) — admin only
- List profiles (email, display name, role, created date).
- Change role between `reader` / `uploader` / `admin`. Server-side re-verification;
  I must not be able to demote myself to the point where no admin remains.

## 5. Quality bar
- Every mutating Server Action re-checks the role server-side; never trust the client.
- Sanitize any extracted HTML before storing/rendering (DOMPurify).
- All new UI in Uyghur, RTL, using existing design tokens and the Icons component —
  do not invent new colours or a new visual language.
- Mobile Rules apply to every new screen, especially the wizard: the step navigation
  and Save/Next buttons must stay visible and tappable after scrolling down and back
  up on a 375 px phone; no control hidden behind a sticky bar.
- New migrations only as NEW files in `supabase/migrations/` (do not edit applied ones).

## 6. Tests (mandatory before you call this done)
- `npm run typecheck && npm run lint && npm run build` all pass.
- Playwright at 375×667, 390×844, 1280×800: admin pages render for a staff session and
  redirect for anonymous; wizard steps navigate; no horizontal overflow; wizard
  buttons clickable after scroll down+up; category drag-and-drop has a working
  non-drag fallback.
- A unit test for the page-chunking function (paragraph boundaries respected, chunk
  size within range, no content lost).

## 7. Then walk me through it (Uyghur, one step at a time)
Apply any new migration in Supabase, then have me upload ONE real book from my
computer end-to-end while you watch for errors, and confirm it appears for a
logged-out visitor once published.

## Acceptance criteria
- I can create categories, upload a real PDF and a real DOCX, edit their metadata,
  publish them, and see them as an anonymous visitor.
- A duplicate upload is detected before any data is written.
- A `reader` account cannot reach `/admin` or call any admin action (test it).
- No secret in the client bundle; no book text sent through a Vercel function.
- Do NOT start Phase 3 (reader UI, search page) yet.

Commit per logical step with English conventional messages. Ask me only when a
decision is genuinely mine; otherwise follow CLAUDE.md defaults.
