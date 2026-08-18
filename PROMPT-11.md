# PROMPT 11 — ئىملا تەكشۈرۈشنى دېتالدەك قىلىش: ئاستىغا سىزىش + توغرا تەكلىپ چىقىرىش

## قانداق ئىشلىتىسىز (يېڭى تۈر ئېچىپ)
Claude Code دا **BilimHezinisi-website** قىسقۇچىنى تاللاڭ، دېسكتوپ دېتال قىسقۇچىنىمۇ
(`bilim hezinisi pc`) قوشۇپ تاللاڭ. ئاندىن سىزىقتىن تۆۋەنكىنى پۈتۈنلەي چاپلاڭ.

---

You are continuing an existing, live project. Read `CLAUDE.md` FIRST (it always wins)
and use the **bilim-web** skill.

## Project context
`https://bilim-hezinisi-website.vercel.app` — a free public Uyghur digital library.
Next.js App Router + TypeScript + Tailwind on **Vercel Hobby**, data in **Supabase
Free**. Phases 1–10 are done: design system, auth + RLS, admin, library, reader,
Markdown-only content (no PDF, no OCR), Quran module, migration, SEO, exact-phrase
search with match navigation, Notebook (`/notes`) with rich text, autosave, DOCX export,
and a SymSpell-based Uyghur spellchecker with corpus frequencies and a data-derived
confusion table.

**Non-negotiable constraints:** no budget ever (Supabase Free + Vercel Hobby, no paid
service, no new vendor account); search operators stay removed; anonymous reading and
search keep working; all Mobile Rules in `CLAUDE.md` apply; new migrations are NEW files;
the dictionary artifact is served from `public/` via the Vercel CDN and downloaded only
when the user enables spellcheck.

The spellchecker has two serious problems in production. Fix both.

---

# PROBLEM 1 — The correction UI is wrong (it must match the desktop app)

## What the user sees now
Misspelled words are **not marked in the text at all**. Instead a panel appears at the
bottom of the page listing 27 chips of unknown words. The writer cannot see which word
in their paragraph is wrong, cannot see it in context, and has to match chips against
prose by eye. This is unusable for real writing.

## What it must be — copy the desktop
Study `../bilim hezinisi/bilim hezinisi pc/src/spellcheck.js` (the editor-integration
section from `window.notesRunSpellCheck`, ~line 216 onward) and `src/notes.css`
(READ-ONLY — never modify that folder).

Required behaviour:
- Every misspelled word is **underlined inline, in place, in the text itself** (red wavy
  underline, exactly like the desktop). The writer sees the error where they wrote it.
- **Clicking or tapping an underlined word** opens a small popup **anchored at that
  word** listing the ranked corrections, plus «لۇغەتكە قوش» (add to my dictionary) and
  a dismiss action. Choosing a suggestion replaces just that word and re-checks.
- The bottom chip panel is **removed as the primary interface**. If you keep any summary
  UI at all, it must be secondary, collapsed by default, and never the only way to see
  errors.
- Underlining must not break RTL text shaping, must not change line height or cause
  reflow while typing, and must survive editing (typing near a marked word must not
  corrupt the marks or move the caret).
- Performance: re-checking runs debounced in the existing Web Worker; typing must never
  stutter, and the whole document must not be re-marked on every keystroke.

### Mobile (HARD)
- The popup must appear near the tapped word, never clipped by the toolbar or the
  on-screen keyboard, and must be fully scrollable if the suggestion list is long.
- Touch targets ≥44 px; the popup closes cleanly on outside tap; no hover-only
  behaviour; no horizontal overflow at 360 px.

---

# PROBLEM 2 — The right correction is not offered at all

## Two real failures reported by the owner
| typed (flagged) | intended (never suggested) | difference |
|---|---|---|
| تەۋەلىنگەن | تەۋەلەنگەن | one substitution: ى → ە |
| قالدورمىغۇدەك | قالدۇرمىغۇدەك | one substitution: و → ۇ |

**Both are edit distance 1.** SymSpell with `maxEditDistance: 2` is mathematically
guaranteed to find an edit-distance-1 candidate **if that candidate exists in the
dictionary**. Therefore this is almost certainly **not a ranking problem — it is a
dictionary coverage problem.**

## Step 1 — Diagnose before building anything
Check directly and report the answers:
1. Are `تەۋەلەنگەن` and `قالدۇرمىغۇدەك` present in the dictionary artifact? (Very likely
   not.)
2. If they are present, why did SymSpell not return them — is the `prefixLength: 7`
   index dropping edits, is the candidate being cut by the 10-suggestion cap before
   ranking, or is the distance-2 pass being skipped? (You already found that distance-2
   is only explored when distance-1 finds nothing — fix that regardless: always generate
   both sets and score them together, then cut to 10 **after** scoring.)
3. Also port the **stem-prefix fallback** you found missing (desktop `spellcheck.js`
   ~line 174) — as a last resort only, never ahead of real candidates.

**Do not proceed to Step 2 until you have stated which of these is actually true.**

## Step 2 — Fix coverage, because a fixed word list cannot cover Uyghur
Uyghur is agglutinative: a stem takes long chains of suffixes, so the number of valid
forms is effectively unbounded. The shipped list has ~441k fully-inflected forms and the
desktop's own comments admit it does **no suffix stripping and no morphological
analysis** — which is exactly why a perfectly ordinary word like «قالدۇرمىغۇدەك» is
missing. Standard practice for agglutinative languages (Hunspell's twofold affix
stripping for Turkish/Hungarian/Finnish, FST-based analyzers for Kurdish) is to model
stems + affixes rather than enumerate forms. Implement both fixes below.

### 2A. Grow the vocabulary from our own corpus (free, domain-perfect)
We host hundreds of published Uyghur books — they are the best Uyghur corpus available
to this project, and they cost nothing.
- Extend the frequency script into `scripts/build-vocabulary.mjs`: scan `book_pages.content`
  of **published** books (service-role, read-only, batched), tokenise with the
  spellchecker's word regex, and collect words that are **not** in the dictionary.
- Admit a new word only if it is well attested — require at least **N occurrences across
  at least 2 different books** (tune N and report it), so OCR noise and one-off typos in
  a single book are not imported as "correct".
- Report how many words this adds, the artifact size delta, and — crucially — whether
  `تەۋەلەنگەن` and `قالدۇرمىغۇدەك` are now covered.
- Give me an admin-reviewable list of the top additions so I can spot obvious junk.

### 2B. Handle suffixes properly (this is the real fix)
Add morphological awareness to lookup and to suggestion generation:
- Build a **Uyghur suffix inventory** with vowel-harmony variants (derive it from the
  dictionary itself by finding productive stem/suffix splits, and from the alphabet and
  vowel set in the desktop's `Uyghur.cs` reference: `UEY_LETTERS`, `IsSozuq`). Document
  it in code with comments.
- **Acceptance:** if a word is not in the dictionary, try to decompose it as
  `stem + valid suffix chain`. If the stem is a dictionary word and the chain is valid
  under vowel harmony, treat the word as **correct** and do not flag it.
- **Suggestion:** if the stem is *not* a dictionary word, run the existing scored
  SymSpell lookup **on the stem**, then **re-attach the suffix chain** (re-applying
  vowel harmony to the suffixes if the corrected stem changes the harmony class).
  For the two failures above this yields the intended word directly:
  `قالدور|مىغۇدەك` → stem `قالدور` → `قالدۇر` → `قالدۇرمىغۇدەك`.
- Rank suffix-derived candidates inside the same scoring function as everything else —
  do not append them blindly at the end.

### 2C. Do not trade one error for another
Over-permissive suffix acceptance would silently stop flagging genuinely wrong words,
which is worse than a missing suggestion. Therefore measure **both** directions:
- **Recall** — intended word present in the suggestions (target: ~100 %) and ranked #1
  (target ≥80 %) / top-3 (target ≥95 %).
- **False-accept rate** — how many genuinely misspelled words are now silently accepted
  because a bogus stem+suffix split succeeded. Build a negative test set (real
  misspellings that must still be flagged) and report this number explicitly. If
  accepting more valid forms pushes false-accepts up, say so and show the trade-off
  rather than quietly choosing.

## Step 3 — Keep the honest measurement discipline
Keep the held-out evaluation split agreed earlier: the pairs used to derive the
confusion table, suffix inventory or any weight must **not** appear in the measurement
set. Report the three sets separately (held-out `corrections.json`, the owner's real
field examples, synthetic systematic cases) and add these two field cases to the field
set:
```
تەۋەلىنگەن → تەۋەلەنگەن
قالدورمىغۇدەك → قالدۇرمىغۇدەك
```

## Reference material
The desktop's code comments cite `_reference/UyghurSpell/` and `_reference/UyghurEditPP/`
by Gheyret Kenji, but that folder is **not** present in the copy on this machine, so do
not assume you can read it. If you can reach the public repositories, study how
UyghurEdit generates and orders suggestions and adopt what is better than what we have;
if you cannot reach them, proceed with the approach above and say so. Do not block on it,
and do not add any runtime dependency on an external service.
(Note: the `UyghurOCR` release the owner linked is the OCR project — the spellchecking
logic lives in UyghurSpell / UyghurEditPP.)

---

# Testing and reporting (mandatory)
- `npm run typecheck && npm run lint && npm run build` pass; all existing unit and
  Playwright suites stay green at 375×667, 390×844 and 1280×800.
- Unit tests: both reported failures now produce the intended word as suggestion #1;
  suffix decomposition accepts valid forms and rejects invalid ones; distance-2
  candidates are always considered; the 10-suggestion cap is applied after scoring.
- Playwright, mobile and desktop: a misspelled word is underlined **inline**; tapping it
  opens the popup anchored at that word; choosing a suggestion replaces only that word;
  the popup is not clipped by the toolbar or the keyboard; adding a word to the personal
  dictionary removes the underline immediately.
- Report artifact size, cold-load time, phone memory, and suggestion latency before and
  after — the free-tier and typing-performance rules still apply.
- Final report in simple Uyghur: what the real cause of the missing suggestions was,
  what changed in the UI, the measured recall / rank-1 / top-3 / false-accept numbers,
  and anything I must do myself.

# Acceptance criteria
- Misspelled words are underlined in the text, and tapping one shows corrections right
  there — the bottom chip panel is no longer the way this works.
- Typing «تەۋەلىنگەن» offers «تەۋەلەنگەن», and «قالدورمىغۇدەك» offers «قالدۇرمىغۇدەك»,
  each as the first suggestion.
- Ordinary inflected Uyghur words are no longer flagged just because that exact form was
  missing from the word list — and genuinely wrong words are still flagged, with the
  false-accept rate measured and reported.
- Nothing from Phases 1–10 regressed; no paid service and no new vendor account was
  added; spellcheck still loads only for people who enable it.
- Do NOT start the AI layer — that is the final phase.

Commit per logical step with English conventional messages. If fixing coverage properly
would require something that breaks the free-tier, performance or mobile rules, stop and
explain the trade-off instead of choosing silently.
