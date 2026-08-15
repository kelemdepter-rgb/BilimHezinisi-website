# PROMPT 7 — ئىزدەش نەتىجىسىدىن كىتابقا بېرىش جەريانىنى دېتالدەك قىلىش

## قانداق ئىشلىتىسىز
1. Claude Code نى ئېچىپ **BilimHezinisi-website** قىسقۇچىنى تاللاڭ، ھەمدە
   دېسكتوپ دېتال قىسقۇچىنىمۇ قوشۇپ تاللاڭ (`bilim hezinisi pc`) — ئۇ پايدىلىنىش مەنبەسى.
2. سىزىقتىن تۆۋەنكى تېكىستنى پۈتۈنلەي كۆچۈرۈپ چاپلاڭ.

---

You are continuing an existing, live project. Read `CLAUDE.md` FIRST (it always wins)
and use the **bilim-web** skill. Phases 1–6 are done and deployed at
`https://bilim-hezinisi-website.vercel.app` on Vercel Hobby + Supabase Free.

**Hard constraints (unchanged):** no budget ever — nothing may require a paid plan or a
new vendor; **do not re-add the `pg_trgm` index on `book_pages`** (Phase 4 removed it to
fit the free tier); anonymous search and reading must keep working; all Mobile Rules
apply.

## The problem, in one sentence
The desktop app's "search → open the book → jump between hits → go back to results"
flow works well; the web version breaks it in four places. Fix all four so the web
behaves like the desktop.

**The desktop implementation is the specification.** Study it before writing code:
- `../bilim hezinisi/bilim hezinisi pc/database.js` →
  `getBookContentSnippets` (~lines 620–667): the needle is stripped of FTS operators and
  quotes, then matched with a plain case-insensitive `indexOf` over the book content;
  each hit returns `{ snip, pos }` where `pos` is the character offset of the hit.
- `../bilim hezinisi/bilim hezinisi pc/src/index.html` →
  `updateMatchNav(q, targetPos)` (~line 1817), `jumpToMatch(dir)` (~1854),
  `flashMatch(node)` (~1862), `hideMatchNav()` (~1852), and the `matchcount` / `prevM` /
  `nextM` controls. Note how `targetPos` selects the Nth occurrence by counting hits
  before that offset, then `scrollIntoView({block:'center'})` + a flash animation.

---

## BUG 1 — Multi-word search highlights only part of what I typed
**Now:** searching «قىيامەت كۈنى پىلسىرات» returns a result whose snippet highlights only
«قىيامەت كۈنى». It looks as if the site silently searched for something else, and the
user thinks they mistyped.

**Cause to verify:** the RPC uses `websearch_to_tsquery`, which ANDs the words, so a page
containing all three words anywhere matches, and `ts_headline` highlights whatever
fragment it chooses — not the phrase the user typed.

**Required behaviour (match the desktop):**
- An unquoted multi-word query is treated as an **exact phrase**, exactly like the
  desktop's `indexOf` over the book text. If the phrase does not occur, that page is not
  a result.
- Keep the existing operators working: `"quoted phrase"`, `OR`, and `-exclusion`.
  Only the *default* behaviour for plain multi-word input changes.
- Normalization still applies on both sides (`ug_normalize`), so tashkil/hamza/ya
  variants still match — a user typing without diacritics must still find the text.
- **Never show a highlight that does not correspond to what the user typed.** If a
  result matches by words-but-not-phrase (e.g. in an OR search), the UI must say so
  rather than implying an exact hit.
- The snippet must highlight the **whole matched phrase**, not one word of it.

**Performance (free tier, no trigram index):** do NOT scan every page. Use the existing
FTS index as a cheap pre-filter (`phraseto_tsquery` over the normalized text finds
candidate pages), then verify the exact phrase on those candidates only, computing the
real character offset there. Do this inside the `search_books` RPC in a NEW migration.
Show `explain analyze` proving the FTS index is still used, and report search timing
before/after.

## BUG 2 — Clicking a result does not land on the word
**Now:** clicking a search result opens the book slightly *above* the passage; the user
has to hunt for the word.

**Required behaviour:**
- `search_books` must return, for every hit, the `page_no` **and** the character offset
  of the match within that page (call it `match_pos`), the same idea as the desktop's
  `pos`.
- Clicking a result opens the reader at that page with the query and offset in the URL
  (e.g. `/books/12/read?q=...&page=7&pos=1843`), and the reader **scrolls that exact
  occurrence into the centre of the viewport and flashes it**, like `flashMatch`.
- If several identical words appear on the page, the offset decides which one — count
  occurrences before `match_pos` exactly as `updateMatchNav` does.
- It must land correctly on a 375 px phone too, with the sticky toolbar accounted for:
  the highlighted word must be visibly centred, never hidden under a bar.

## BUG 3 — No next / previous match navigation inside a book
**Now:** if the searched word appears many times in the book, there is no way to step
through the occurrences. The desktop has this and it works well.

**Required behaviour (port the desktop's match navigation):**
- When the reader is opened with a search query, show a compact match navigator in the
  reader toolbar: **«ئالدىنقى» / «كېيىنكى» buttons and a counter «3/17»**, mirroring
  `prevM` / `nextM` / `matchcount`. Hide it when there are no matches; show «تېپىلمىدى»
  when the query has no hits in this book.
- Every occurrence of the query **in the whole book** must be reachable, not just those
  on the currently loaded page. The web reader lazy-loads pages, so:
  - add an RPC (NEW migration) that returns the ordered list of all matches in one book
    as `(page_no, match_pos)` — one cheap call, capped at a sane maximum with a clear
    "more than N" indication;
  - «كېيىنكى» / «ئالدىنقى» walk that list, loading the target page if it is not loaded
    yet, then scroll + flash the exact occurrence;
  - the counter always reflects position in the full-book list, e.g. «12/47».
- Wrap around at the ends, like `jumpToMatch` does.
- Keyboard shortcuts on desktop (Enter / Shift+Enter or F3 / Shift+F3) as a bonus, but
  the buttons are the requirement.
- **Mobile:** the two buttons and the counter must be ≥44 px, always visible and
  tappable, and must still be reachable after scrolling down and back up. They must not
  cover the text they are helping the user read.

## BUG 4 — "Back" goes to the book info page instead of the search results
**Now:** pressing «قايتىش» in the reader lands on the book detail page. Someone
searching a term wants to go back to the **results list** and open the next source —
they do not care which book they were just in.

**Required behaviour:**
- When the reader was opened from a search result, «قايتىش» returns to `/search` with
  the **same query, filters, page of results and scroll position** restored, so the next
  result is right there.
- When the reader was opened normally (from the library or a book page), «قايتىش» keeps
  its current behaviour.
- Make it work for the browser/phone hardware back button too, not just the in-app
  button — no history traps, no double-back needed.
- Restoring the results list must not re-run an expensive query if it can be served from
  cache/history state (free-tier discipline).

---

## Also check while you are in there
- The same four behaviours for **Quran search** results, where they apply.
- The in-book search box that already exists in the reader must share this match
  navigator instead of having a second, inconsistent implementation.

## Tests (mandatory)
- `npm run typecheck && npm run lint && npm run build` pass; all existing unit and
  Playwright suites still green at 375×667, 390×844, 1280×800.
- New unit tests: phrase-vs-words query building; occurrence counting by offset
  (the `targetPos` logic) including repeated identical words.
- New Playwright tests, on mobile and desktop viewports:
  1. searching a three-word phrase either highlights the whole phrase or returns no
     result — never a partial highlight presented as a match;
  2. clicking a result scrolls the exact word into view, visible and not covered by any
     bar;
  3. «كېيىنكى» moves to the next occurrence — including one on a different page — and
     the counter increments; «ئالدىنقى» goes back;
  4. «قايتىش» from a search-opened reader lands back on the results list with the query
     and scroll position intact.
- Verify on real data: search a phrase that exists in an imported book and one that does
  not, and report what the user sees in both cases.

## Acceptance criteria
- Searching «قىيامەت كۈنى پىلسىرات» either finds that exact phrase and highlights all of
  it, or reports honestly that it was not found — no misleading partial highlight.
- Clicking any result lands precisely on the highlighted word, on a phone too.
- I can step through every occurrence in a book with «ئالدىنقى» / «كېيىنكى» and see
  «3/17»-style counting, like the desktop app.
- «قايتىش» brings me back to my search results, ready to open the next source.
- No trigram index was re-added, search is not slower, and nothing else regressed.

Commit per logical step with English conventional messages. If matching the desktop
behaviour exactly would require something that breaks the free-tier rules, stop and
explain the trade-off to me instead of choosing silently.
