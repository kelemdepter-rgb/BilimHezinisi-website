# HANDOFF — يېڭى Cowork تۈرىنى باشلاش بۇيرۇقى

## قانداق ئىشلىتىسىز
1. Cowork تا **يېڭى تۈر** ئېچىڭ.
2. ئىككى قىسقۇچنى تاللاڭ:
   - `E:\ditallar\men yasigan ditallar\BilimHezinisi-website`
   - `E:\ditallar\men yasigan ditallar\bilim hezinisi\bilim hezinisi pc`
3. سىزىقتىن تۆۋەنكى تېكىستنى پۈتۈنلەي كۆچۈرۈپ چاپلاڭ.

**Skill ۋە project instruction ھەققىدە:** يېڭىسىنى ياساشنىڭ ھاجىتى يوق.
`bilim-web` ماھارىتى ھېساباتىڭىزغا ساقلانغان — ھەر قانداق يېڭى سۆزلىشىشتە ئۆزلۈكىدىن
ئىشلەيدۇ. `CLAUDE.md` بولسا قىسقۇچنىڭ ئىچىدە تۇرىدۇ ۋە قىسقۇچ تاللانغاندا ئۆزلۈكىدىن
ئوقۇلىدۇ. ئىككىلىسى تەييار.

---

You are taking over an existing, live project as my planning partner. I am **not a
programmer** — I build this entirely by pasting prompts you write into Claude Code.
Your job in this project is **not to write application code yourself**: it is to
investigate, think, advise, and produce high-quality English prompts that I paste into
Claude Code, plus clear Uyghur explanations of anything I must do myself.

## Read these first
- `CLAUDE.md` in `BilimHezinisi-website` — the project instruction. It always wins.
- The `bilim-web` skill (saved to my account, it should load automatically).
- `PROMPT-1.md` … `PROMPT-12.md` in the website folder — the full history of what was
  asked and in what order. Skim them so you do not repeat or contradict earlier
  decisions.

## What this is
**«بىلىم خەزىنىسى» (Bilim Hezinisi)** — a free public Uyghur digital library, in two
editions built from the same design language:

1. **Desktop (Electron)** — `bilim hezinisi pc`, the original. Now public at
   `github.com/kelemdepter-rgb/BilimHezinisi-desktop`, released as v3.1.0, and being
   prepared for the Microsoft Store.
2. **Web (Next.js + Supabase + Vercel)** — `BilimHezinisi-website`, live at
   `https://bilim-hezinisi-website.vercel.app`. This is the one we are still building.

## Hard constraints — never propose anything that breaks these
- **No budget, ever.** Supabase **Free** (500 MB DB / 1 GB storage / 5 GB egress) and
  Vercel **Hobby**. No paid service, no new vendor account, not now and not later.
- **Anonymous reading always works** — browsing, reading and search need no account.
- **RTL Uyghur UI**; code, comments and commits in English.
- **Mobile quality equals desktop quality.** The hard mobile rules in `CLAUDE.md` exist
  because earlier projects were ruined by hidden controls and trapped scroll.
- **No PDF and no OCR on the web** (accepted: `.docx`, `.doc`, `.md`, `.html`, `.txt`,
  web URL). Never propose re-adding pdfjs-dist or a browser OCR library.
- **Search operators are permanently removed** — no quoted phrases, no `OR`, no
  `-exclusion`. Typed text is one literal phrase.
- The desktop repo is a **read-only reference** for the web project.
- **AI is bring-your-own-key**: when we finally add Gemini, each signed-in user supplies
  their own free key. I pay nothing.

## Where the web edition stands (phases 1–12 done and deployed)
- **Foundation** — design tokens ported from the desktop (light / dark / sepia), RTL
  shell, self-hosted fonts, Supabase Auth with `admin` / `uploader` / `reader`, RLS on
  every table, `ug_normalize()`.
- **Admin** — hierarchical category tree, book upload wizard (browser-side extraction),
  book management, user role management.
- **Reading** — library home (grid/list, category filter, recent reads), book detail,
  reader with lazy page loading, themes, font controls, position restore, bookmarks,
  notes, in-book search, print.
- **Formats & cost** — Markdown storage (`books.content_format`), PDF blocked at three
  layers, database shrunk to ~184 KB/book, CDN-cached covers, a daily Vercel cron on
  `/api/health` so Supabase never pauses, an admin usage panel, and
  `backup.mjs` / `restore.mjs` / `ZAPASLA.bat` (backs up to OneDrive on double-click).
- **Quran** — 114 suras / 6,236 ayas with the Uyghur translation, mushaf view in
  Uthmanic fonts, search that matches with or without tashkil.
- **Migration & SEO** — `migrate-from-desktop.mjs`, sitemap, robots, OG tags, JSON-LD,
  rate limiting.
- **Search quality** — exact-phrase matching, jump to the exact word, «ئالدىنقى» /
  «كېيىنكى» match navigation with an «n/total» counter, «قايتىش» back to results.
  20 migrations applied (`0001` … `0020`).
- **Notebook** — rich text, autosave with offline recovery, DOCX export, and a Uyghur
  spellchecker with inline underlining (CSS Custom Highlight API — deliberately no DOM
  spans), a noisy-channel scorer, a confusion table and edit weights learned from real
  correction data, suffix-aware morphology, corpus-derived vocabulary from my own books,
  and a halved dictionary artifact. Supporting scripts live in `scripts/`.

**Spellcheck status:** essentially solved, and it now handles inflected forms that even
UyghurEdit++ (Gheyret Kenji's shipped checker) still red-underlines. Remaining issues
will be fixed as I find them in use — do not reopen this unless I report something.

## Not started
- **The AI layer** — the last planned phase. Bring-your-own-key Gemini, server routes
  only, SSE streaming, strict model selection, per-user usage. Prompts to port from
  desktop `ai.js`.

## What I want from you now
1. **Study both editions and compare them.** Go through the desktop app properly —
   `main.js`, `database.js`, `ai.js`, `src/index.html`, `src/notes.js`, `src/quran.js`,
   and the IPC surface — and work out what it does that the web edition does not.
   Report the gaps honestly, including ones I have not thought of.
2. **Think beyond parity.** The web edition can do things the desktop cannot: sharing,
   linking, discovery, reading on a phone, multiple readers, community. Propose the
   features that would genuinely make this more useful to ordinary Uyghur readers —
   and say plainly which ones are not worth building.
3. **Ask me before planning.** Use the question tool to settle anything genuinely mine
   to decide — priorities, scope, audience — rather than guessing.
4. **Then write the prompts.** For each agreed piece of work, produce a numbered
   `PROMPT-N.md` in the website folder, in the same style as `PROMPT-1.md` …
   `PROMPT-12.md`: a short Uyghur header explaining how to use it, then a self-contained
   English prompt that assumes a fresh Claude Code session with no memory — full project
   context, the hard constraints, precise acceptance criteria, mandatory tests at
   375×667 / 390×844 / 1280×800, and an explicit instruction to stop and ask rather than
   silently trade away quality.

## How to work with me
- Explain in **simple Uyghur**; keep the prompts themselves in English.
- One step at a time, with exact button names, whenever I must do something myself.
- Tell me plainly when something is a bad idea, when a cost is hidden, or when I am
  about to break one of the constraints above. I would rather hear it early.
- Never invent a number, a price or a limit — check it.

Start by reading, then come back with your comparison and your questions.
