# PROMPT 10 — ئىملا تەكلىپلىرىنى «ئەڭ يېقىن سۆز» بويىچە رەتلەش + لۇغەتنى كىچىكلىتىش

## قانداق ئىشلىتىسىز
PROMPT-9 (ئىزدەش بوياش + خاتىرە خاتالىقى) تۈگىگەندىن كېيىن ئىجرا قىلىڭ.
Claude Code دا **BilimHezinisi-website** قىسقۇچىنى تاللاڭ، دېسكتوپ دېتال قىسقۇچىنىمۇ
(`bilim hezinisi pc`) قوشۇپ تاللاڭ. ئاندىن سىزىقتىن تۆۋەنكىنى چاپلاڭ.

---

You are continuing an existing, live project. Read `CLAUDE.md` FIRST (it always wins)
and use the **bilim-web** skill.

## Project context
`https://bilim-hezinisi-website.vercel.app` — a free public Uyghur digital library.
Next.js App Router + TypeScript + Tailwind on **Vercel Hobby**, data in **Supabase
Free**. Phases 1–8 are done: design system, auth + RLS, admin, library, reader,
Markdown-only content (no PDF, no OCR), Quran module, desktop-library migration, SEO,
exact-phrase search with match navigation, and the Notebook (`/notes`) with rich text,
autosave, DOCX export and Uyghur spellcheck.

**Non-negotiable constraints:** no budget ever (Supabase Free + Vercel Hobby, no paid
service, no new vendor account); search operators stay removed; anonymous reading and
search keep working; all Mobile Rules in `CLAUDE.md` apply; new migrations are NEW files.

This task has two parts, both about the Notebook's spellchecker.

---

# PART A — Suggestion quality: always offer the CLOSEST word first

## The problem
When the user right-clicks / taps a misspelled word, the correction list must be ordered
so the word they actually meant is at or near the top. Today it often is not.

## Why it happens — verify this before changing anything
Read the desktop implementation, which is the reference:
`../bilim hezinisi/bilim hezinisi pc/src/spellcheck.js` and `src/symspell.js`
(READ-ONLY — never modify that folder).

- The desktop already replaced an old wildcard engine with **SymSpell (Symmetric
  Delete), `maxEditDistance: 2`, `prefixLength: 7`, `Verbosity.ALL`** — see the comment
  at `spellcheck.js` ~line 156 ("Replaces the previous wildcard-pattern engine, which
  missed insertion typos like ئەۋىج → ئەۋج"). Confirm the web port uses the same engine
  and parameters; if it silently uses something weaker, that is bug number one.
- `symspell.js` sorts by **(distance ASC, count DESC, alphabetical)** — see ~line 195.
- **The dictionary is a plain word list with no frequency column, so every `count`
  defaults to 1** (`symspell.js` ~line 73–86). That means every candidate at the same
  edit distance is tied, and the final tie-break is *alphabetical* — which is
  meaningless to a human. With 441,322 inflected forms, edit distance 1 alone can yield
  dozens of ties, and the obvious correction gets buried below alphabetically-earlier
  nonsense. **This is the root cause to fix.**

## The fix — rank by a real score, not by the alphabet

### A1. Give the dictionary real frequencies, for free, from our own corpus
We already host hundreds of Uyghur books. Use them:
- Add `scripts/build-word-frequencies.mjs` that reads `book_pages.content` (service-role,
  batched, read-only), tokenises with the same Uyghur word regex the spellchecker uses,
  and produces a frequency table for words that exist in the dictionary.
- Merge those counts into the shipped dictionary artifact as the SymSpell `count`
  column, so `(distance ASC, count DESC)` becomes genuinely meaningful — and the
  frequencies match the exact domain our users write in (Islamic and scholarly Uyghur),
  which no generic frequency list would.
- Words absent from the corpus keep a small non-zero default so they are still
  suggested, just ranked lower.
- This must not grow the artifact much: store counts compactly (e.g. a log-scaled or
  bucketed integer, not raw counts). Report the size delta.

### A2. Score candidates instead of relying on raw edit distance alone
Rank with an explicit, testable scoring function, best first:
1. **`corrections.json` exact match wins outright** (this is the desktop's
   `Toghrisi()` behaviour — keep it first, always).
2. **Edit distance** (Damerau–Levenshtein, so transpositions cost 1) — the dominant term.
3. **Uyghur-specific confusion weighting**: substitutions between letters that Uyghur
   writers genuinely confuse must cost *less* than an arbitrary substitution. At
   minimum treat these pairs as near-free: ئۇ/ئۆ/ئۈ, ې/ى/ئې, ھ/خ, ك/ق, گ/غ, ژ/ج/چ,
   ە/ا, و/ۇ, ۋ/ف. Derive the full set from the Uyghur alphabet in the desktop's
   `Uyghur.cs` reference (`UEY_LETTERS`, `IsSozuq` vowel set) and from
   `uyghur_corrections.json`, and document the table in code with comments.
4. **Prefix preservation**: real typos cluster at the end of a word, so candidates that
   share a longer prefix with what the user typed rank higher.
5. **Corpus frequency** from A1 as the tie-break.
6. **Length similarity** as the final tie-break. Never fall back to alphabetical order.

### A3. Use context when it is cheap
The desktop ships `src/ngram.js`. If the web port already loads an n-gram model, use the
**previous and next word** to re-rank the top candidates (a candidate that forms a seen
bigram with its neighbours moves up). If loading an n-gram model would cost meaningful
bandwidth or memory on a phone, skip it and say so — correctness of A1/A2 matters more.

### A4. Keep the safety nets from the desktop
- The stem-prefix fallback when nothing is found within edit distance 2
  (`spellcheck.js` ~line 174).
- Compound words joined with `-` handled as one token.
- The user's personal dictionary always suppresses a word from being flagged.
- Cap the popup at ~10 suggestions, but choose the best 10 by score, not the first 10
  found.

### A5. Prove it with a real test set
Create `tests/spellcheck-cases.ts` with **at least 40 real Uyghur misspelling → intended
word pairs**, covering: a missing letter, an extra letter, a transposition, a wrong
vowel, a wrong consonant from the confusion table, and a long inflected form. Include
the desktop's known case `ئەۋىج → ئەۋج`. Assert:
- the intended word appears in the suggestions for **100 %** of cases;
- it is **rank 1 for at least 80 %** and within the **top 3 for at least 95 %**;
- print a ranking report so the numbers are visible, and fail the build if they regress.
Ask me for more real-world examples if you want a larger set — I can supply them.

### A6. Speed
Suggestion lookup must stay under ~50 ms on a phone for a typical word. Keep the work in
the Web Worker; do not block typing. Report measured timings.

---

# PART B — Shrink the dictionary artifact, losslessly

Today the artifact is ~777 KB over the wire (Vercel brotli) and uses ~9.7 MB of memory
on a phone. A single-byte encoding of the Uyghur alphabet was proposed, bringing it to
~620 KB and ~5.5 MB of memory.

**Do it — but only as a strictly lossless encoding change, and prove it.**
- The Uyghur alphabet is small enough to map each character to one byte; this changes
  only *how* the words are stored, never *which* words exist. Word quality must be
  identical afterwards.
- The mapping table must cover **every** character that occurs anywhere in the
  dictionary — including tatweel/Sozghuch (U+0640), hyphen for compounds, any Arabic or
  Latin characters or digits that slipped into the list. **Any unmapped character is a
  build-time error**, never a silently dropped or corrupted word.
- Verification is mandatory before shipping:
  - round-trip every entry (encode → decode) and assert byte-for-byte equality;
  - assert the entry count is unchanged (**441,322**);
  - run the full A5 test set against the new artifact and confirm identical results.
- Report: artifact size before/after (raw and brotli), phone memory before/after, and
  cold-load time before/after.
- Keep the existing loading rules: served as a static asset from `public/` (Vercel CDN,
  NOT Supabase Storage, so it never touches the 5 GB egress budget), one-year
  `Cache-Control`, cached in the browser, and **downloaded only when the user actually
  turns spellcheck on** — never on the library, reader or Quran pages.

---

# Testing and reporting (mandatory)
- `npm run typecheck && npm run lint && npm run build` pass; all existing unit and
  Playwright suites stay green at 375×667, 390×844 and 1280×800.
- The A5 ranking report is printed and its thresholds enforced.
- Playwright, on mobile and desktop: type a known misspelled word in a note, open the
  suggestion popup, and assert the intended correction is the first option and that
  tapping it replaces the word correctly; the popup is fully visible, not clipped by the
  toolbar or the on-screen keyboard.
- Confirm no new network request appears on pages that do not use spellcheck.
- Final report in simple Uyghur: what was wrong with the ordering, what the new ranking
  does, the measured accuracy numbers, the new artifact size and memory use, and
  anything I must do myself (run the frequency script, apply a migration).

# Acceptance criteria
- For a misspelled Uyghur word, the word I actually meant is the first suggestion in the
  large majority of cases, and effectively always within the top three.
- Suggestions are never ordered alphabetically as a fallback.
- The dictionary is smaller and lighter on phone memory, with provably identical
  contents and identical suggestion quality.
- Spellcheck still loads only for people who open the notebook and enable it.
- Nothing from Phases 1–9 regressed; no paid service and no new vendor account was added.
- Do NOT start the AI layer — that is the final phase.

Commit per logical step with English conventional messages. If a ranking improvement
would slow typing noticeably or would require a paid service, stop and explain the
trade-off instead of choosing silently.
