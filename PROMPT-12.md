# PROMPT 12 — ئىملا تەكشۈرۈشنى تاماملاش (تەكلىپ سۈپىتى + لۇغەت كىچىكلىتىش)

## قانداق ئىشلىتىسىز (يېڭى تۈر ئېچىپ)
1. Claude Code دا **BilimHezinisi-website** قىسقۇچىنى تاللاڭ، دېسكتوپ دېتال قىسقۇچىنىمۇ
   (`bilim hezinisi pc`) قوشۇپ تاللاڭ.
2. تۆۋەندىكى تېكىستنى چاپلاڭ — ئەمما ئاۋۋال «UyEdit findings» بۆلىكىگە ئۆزىڭىز
   سىناپ چىققان نەتىجىنى يېزىڭ. نەتىجە تېخى يوق بولسا شۇ بۆلەكنى «not yet collected»
   دەپ قالدۇرۇڭ — ئىش توختاپ قالمايدۇ، پەقەت تەڭشەش سەل كېيىنكە قالىدۇ.

---

You are continuing an existing, live project. Read `CLAUDE.md` FIRST (it always wins)
and use the **bilim-web** skill.

## Project context
`https://bilim-hezinisi-website.vercel.app` — a free public Uyghur digital library.
Next.js App Router + TypeScript + Tailwind on **Vercel Hobby**, Supabase **Free**.
Phases 1–9 are done and live: design system, auth + RLS, admin, library, reader,
Markdown-only content (no PDF, no OCR), Quran module, desktop-library migration, SEO,
exact-phrase search with match navigation, and the Notebook (`/notes`) with rich text,
autosave and DOCX export.

**Non-negotiable constraints:** no budget ever (Supabase Free + Vercel Hobby, no paid
service, no new vendor account); search operators stay removed; anonymous reading and
search keep working; all Mobile Rules in `CLAUDE.md` apply; new migrations are NEW files;
the spellcheck dictionary is served from `public/` via the Vercel CDN and downloaded only
when the user enables spellcheck.

## Exactly where the spellchecker stands
Done and committed:
- **Confusion table** derived from the 3,400 real pairs in `corrections.json`
  (`lib/spellcheck/confusion.ts`). 1,700 pure single-substitution pairs were mined; the
  top confusion is `ل ↔ م` (160×), which is the spoken «قىلالماي → قىلامماي»
  assimilation — derived from data, not intuition.
- **Inline underlining + anchored popup**, using the **CSS Custom Highlight API** so no
  `<span>` is ever inserted into the note. This was a deliberate choice: notes are saved
  as `innerHTML`, so DOM-inserted marks would be persisted into the document and the
  checker would end up editing what it is checking. Do not replace this approach.

Diagnosed and confirmed, not yet fixed:
- `تەۋەلەنگەن` and `قالدۇرمىغۇدەك` are **absent from the dictionary**, so no
  edit-distance engine can ever suggest them. `suggest()` returns *zero* candidates for
  both — the writer sees a flagged word with no help at all.
- Proof that enumeration cannot work: five inflected forms of `قالدۇر` are present and
  the sixth is not. 441,322 entries is an arbitrary sample of an unbounded set.
- The two failures need **different halves** of the fix:
  - `قالدورمىغۇدەك` — the **stem** is wrong (`قالدور` → `قالدۇر`, and `و↔ۇ` is the 5th
    most common confusion in the corrections data, 89×); re-attach `مىغۇدەك`.
  - `تەۋەلىنگەن` — the stem `تەۋە` is fine; the error is **inside the suffix**
    (`لىنگەن` vs `لەنگەن`). Correcting the stem does nothing for this class.
- `dictionary.ts` still sorts ties **alphabetically**, and there is no frequency data,
  so every same-distance candidate is tied.
- Distance-2 is only explored when distance-1 finds nothing (`dictionary.ts:310`).
- The stem-prefix fallback from the desktop is still absent from the web port.

Not started: the scorer, the suffix work, the corpus vocabulary, the evaluation sets,
and the byte encoding. That is this job.

## UyEdit findings — collected, and they change the plan
I tested in UyghurEdit++ (`_reference/Uyghur_Edit/UyEdit.exe`). Result:

> **UyghurEdit++ red-underlines BOTH `قالدۇرمىغۇدەك` and `تەۋەلەنگەن` — the correct
> forms — as misspellings.**

So the mature, widely-used Uyghur checker has exactly the same limitation we do: an
enumerated word list, no morphology, and therefore false alarms on perfectly ordinary
inflected words. Three consequences, all of which change how you work:

1. **There is no external tool to calibrate acceptance against.** Do not treat UyEdit's
   behaviour as ground truth for what should be accepted — it over-flags. The suffix
   inventory has to be justified from our own data and our own measurements.
2. **This is novel work, so rigour matters more, not less.** We are trying to do
   something the reference implementation does not do. That is exactly the situation in
   which over-acceptance creeps in unnoticed. The false-accept constraint stays binding.
3. **We now have a large, free source of ground truth for coverage** — see Task C1.

UyEdit may still be worth consulting for *ranking* of words that ARE in its dictionary,
but that is optional and not blocking. Do not decompile anything.

---

# TASK A — Ranking: a real scorer (this is the safe half)

Ranking changes cannot increase the false-accept rate, so do this first.

## A1. Frame it explicitly as a noisy-channel model
`score(candidate) = P(candidate) × P(typed | candidate)`, where `P(candidate)` is corpus
frequency and `P(typed | candidate)` comes from learned edit weights. State this
structure in code comments so the pieces stay coherent instead of becoming a pile of
ad-hoc bonuses. Never fall back to alphabetical order.

## A2. Brill & Moore style multi-character edit weights
Single-character edit distance has no idea that `لىن → لەن` is a *common* rewrite.
Extend the mining you already did on `corrections.json` from single substitutions to
**aligned 2- and 3-character segments**, and weight each rewrite by how often it is
actually observed. A frequently-seen rewrite (`لىن→لەن`, `دور→دۇر`) should cost almost
nothing; a rare one stays expensive. This attacks the `تەۋەلىنگەن` class directly at the
string level, without requiring the morphology to be perfect.

## A3. Corpus frequency (PROMPT 10's A1, still undone)
`scripts/build-word-frequencies.mjs`: read `book_pages.content` of **published** books
(service-role, read-only, batched), tokenise with the spellchecker's word regex, and
produce frequency counts for dictionary words. Store them compactly (log-scaled or
bucketed, not raw counts) and report the artifact size delta. Words absent from the
corpus keep a small non-zero default so they are still suggested, just ranked lower.

## A4. Fix candidate generation
Always generate edit-1 **and** edit-2 candidates, score them together, and only then cut
to 10. Never cut before scoring. Port the desktop's stem-prefix fallback
(`spellcheck.js` ~line 174) as a last resort only, never ahead of real candidates.

---

# TASK B — Coverage: morphology (this is the risky half)

## B1. Suffix inventory
Build a Uyghur suffix inventory with vowel-harmony variants, derived from the dictionary
itself by finding productive stem/suffix splits, plus the alphabet and vowel set from the
desktop reference (`UEY_LETTERS`, `IsSozuq`). Document it in code with comments.

## B2. Decomposition, in both directions
- **Acceptance:** a word not in the dictionary that decomposes into
  `dictionary stem + valid suffix chain` is treated as correct and not flagged.
- **Suggestion, wrong stem:** run the scored lookup on the stem, re-attach the chain,
  re-applying harmony if the corrected stem changes harmony class
  (`قالدور|مىغۇدەك` → `قالدۇرمىغۇدەك`).
- **Suggestion, wrong suffix:** correct the chain to the nearest **known suffix form**
  (`لىنگەن` → `لەنگەن`). Treat this as suffix-inventory matching, not as a general
  harmony normaliser — narrower and far less likely to over-accept.
- Rank suffix-derived candidates inside the same scoring function as everything else.

## B3. False-accept is the binding constraint
Build the negative test set **first** — real misspellings that must still be flagged.
Tighten the suffix inventory until the false-accept target holds, then report whatever
recall falls out. Do not maximise recall and report whatever false-accept number falls
out of it. If both targets cannot be met, give me the numbers and let me decide.

## B4. Corpus vocabulary — only what morphology cannot reach
Extend the frequency script into `scripts/build-vocabulary.mjs`: collect words from
published books that are **not** in the dictionary **and not accepted by B2**. Admit one
only if well attested — at least N occurrences across at least 2 different books (tune N
and report it) — so OCR noise and single-book typos are not imported as "correct". Give
me a reviewable list of the top additions. Report whether `تەۋەلەنگەن` and
`قالدۇرمىغۇدەك` are now covered, and by which mechanism.

---

# TASK C — Evaluation (honest numbers or it did not happen)

## C1. Build both test sets automatically from the book corpus
Since no external checker can be trusted as ground truth, generate the evaluation data
from our own published books — hundreds of edited Uyghur volumes, effectively free.

- **Positive set (coverage).** Words that occur frequently across several published
  books are overwhelmingly correct Uyghur. Take words with at least N occurrences in at
  least 2 books, and treat every one the checker **rejects** as a coverage failure.
  This gives a large, automatic, honest measure of "how often do we red-underline a
  perfectly good word" — which is precisely the failure UyghurEdit++ exhibits and the
  one we are trying to beat. Report this rate before and after, and report it separately
  for words reachable by morphology versus words that needed the vocabulary addition.
- **Negative set (false accept).** Take frequent corpus words (known good) and apply
  realistic single edits drawn from the confusion table — these mutations are almost
  certainly misspellings. **Discard any mutation that happens to land on another real
  word** (present in the dictionary or attested in the corpus), so the set stays clean.
  Anything the checker then **accepts** is a false accept. This set must exist and be
  measured before the suffix inventory is widened even once.
- Keep both sets versioned in the repo with the script that regenerates them, and print
  the sizes so the numbers can be interpreted.

## C2. Reporting rules
- Keep the **held-out split**: pairs used to derive the confusion table, the edit
  weights or the suffix inventory must never appear in the measurement set.
- Report **three sets separately**, never merged: (a) held-out `corrections.json` pairs,
  (b) my real field examples, (c) synthetic systematic cases (clearly labelled).
  Targets for (a) and (b): intended word present ~100 %, rank-1 ≥80 %, top-3 ≥95 %.
- Report the **false-accept rate** on the negative set as a first-class number.
- **Evaluate by paradigm, not by word.** Take several stems, generate the full
  inflection family, and report the fraction accepted before and after. The `قالدۇر`
  case — five forms accepted, the sixth not — is the real test; 5-out-of-6 is broken.
- Field cases that must pass:
  ```
  تەۋەلىنگەن   → تەۋەلەنگەن
  قالدورمىغۇدەك → قالدۇرمىغۇدەك
  ```
- Latency: suggestion lookup under ~50 ms on a phone, in the existing Web Worker.
  Typing must never stutter.

---

# TASK D — Shrink the dictionary artifact, losslessly (PROMPT 10 Part B)

The dictionary contains exactly **34 distinct characters, all inside the Uyghur
alphabet** (no tatweel, no Latin, no digits) — already verified — so a single-byte
encoding is clean and provably total.

- Implement it as a strictly **lossless encoding change**: same words, smaller storage.
- Any character outside the mapping table is a **build-time error**, never a silently
  dropped or corrupted word.
- Verify before shipping: round-trip every entry and assert byte-for-byte equality;
  assert the entry count is unchanged; re-run the full Task C evaluation and confirm
  identical results.
- Report artifact size before/after (raw and brotli), phone memory before/after, and
  cold-load time before/after. Expected ~777 KB → ~620 KB and ~9.7 MB → ~5.5 MB memory.
- Keep the loading rules: static asset from `public/`, one-year `Cache-Control`, cached
  in the browser, downloaded **only** when the user enables spellcheck.

---

# Testing and final report (mandatory)
- `npm run typecheck && npm run lint && npm run build` pass; all existing unit and
  Playwright suites stay green at 375×667, 390×844 and 1280×800.
- Playwright, mobile and desktop: a misspelled word is underlined inline; tapping it
  opens the anchored popup; the intended correction is the first option for the two
  field cases; choosing it replaces only that word; adding to the personal dictionary
  clears the underline; the popup is never clipped by the toolbar or the keyboard.
- No new network request on pages that do not use spellcheck.
- Final report in simple Uyghur: what changed, the measured rank-1 / top-3 /
  false-accept / paradigm numbers, artifact size and memory, and anything I must do
  myself (run a script, apply a migration, re-run `ZAPASLA.bat`).

# Acceptance criteria
- Typing `تەۋەلىنگەن` offers `تەۋەلەنگەن`, and `قالدورمىغۇدەك` offers `قالدۇرمىغۇدەك`,
  each as the first suggestion.
- Ordinary inflected Uyghur words are no longer flagged merely because that exact form
  was missing from the list — and genuinely wrong words are still flagged, with the
  false-accept rate measured and reported.
- Suggestions are never ordered alphabetically.
- The dictionary is smaller and lighter, with provably identical contents.
- Nothing from earlier phases regressed; no paid service, no new vendor account.
- Do NOT start the AI layer — that is the final phase.

Commit per logical step with English conventional messages. If the false-accept
constraint and the recall targets cannot both be met, stop and give me the numbers
rather than choosing silently.
