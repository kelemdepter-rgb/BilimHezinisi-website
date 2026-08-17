# UyEdit.exe ground-truth run

**Purpose.** Our web spellchecker cannot suggest `قالدۇرمىغۇدەك` or `تەۋەلەنگەن` because
**neither word is in the 441,322-word dictionary** — verified, not assumed. That is a
coverage problem, not a ranking problem, and the fix (morphological suffix handling) has a
dangerous failure mode: suffix rules that are too permissive silently stop flagging real
errors. The owner has made **false-accept rate the binding constraint and recall the
objective**, so before tuning suffix rules we want to know how a mature, shipped Uyghur
checker behaves on the same words.

**How to run.** Type each word into UyEdit.exe. For each one record two things:

- `flagged:` — `yes` or `no` (does it mark the word as wrong?)
- `suggestions:` — the first three offered, **in the order shown**. Write `—` if none.

Leave a line blank if you are not sure; a blank is more useful than a guess.

---

## GROUP 1 — the two reported failures

The whole point of the exercise. We need to know both halves: does UyEdit flag the wrong
spelling *and* offer the right one, and does it accept the right one as correct?

### قالدورمىغۇدەك
*(what the owner typed; ours flags it and offers nothing at all)*

- flagged:
- suggestions:

### قالدۇرمىغۇدەك
*(what was meant. Ours does NOT have this word, so it can never suggest it)*

- flagged:
- suggestions:

### تەۋەلىنگەن
*(what the owner typed; ours flags it and offers nothing at all)*

- flagged:
- suggestions:

### تەۋەلەنگەن
*(what was meant. Ours does NOT have this word either)*

- flagged:
- suggestions:

---

## GROUP 2 — one paradigm, the whole family

The decisive evidence for morphology. In **our** dictionary five of these are present and
`قالدۇرمىغۇدەك` is missing — same stem, same productive suffixes, one arbitrary gap. If
UyEdit accepts all seven, it is doing suffix analysis rather than enumerating forms, and
that tells us to build 2B properly rather than just add words.

### قالدۇرماق

- flagged:
- suggestions:

### قالدۇردى

- flagged:
- suggestions:

### قالدۇرغان

- flagged:
- suggestions:

### قالدۇرمىغان

- flagged:
- suggestions:

### قالدۇرمىغۇدەك
*(the one our list is missing — repeated here deliberately, in family context)*

- flagged:
- suggestions:

### قالدۇرالمىغۇدەك

- flagged:
- suggestions:

### قالدۇرۇۋاتىدۇ

- flagged:
- suggestions:

---

## GROUP 3 — deep agglutination, where the ceiling is

How long a suffix chain the checker still accepts. Ours has `كىتابلىرىمىزدىن` but not
`يازغۇچىلىرىمىزنىڭكىدەك`, which is an ordinary word.

### كىتابلىرىمىزدىن

- flagged:
- suggestions:

### يازغۇچىلىرىمىزنىڭكىدەك

- flagged:
- suggestions:

### كىتابخانىلىرىمىزدىكىلەرگە

- flagged:
- suggestions:

---

## GROUP 4 — must STAY flagged (the most important group after Group 1)

These are genuinely wrong words taken from the desktop's own `uyghur_corrections.json`,
so there is no doubt they are errors. This group calibrates the false-accept target.

`كانداقتۇر` is the one that matters most: a **wrong stem carrying a valid suffix**. If
suffix acceptance is naive, `كانداق` + `تۇر` parses cleanly and the misspelling is
silently accepted. If even UyEdit accepts it, that failure mode is what a shipped Uyghur
checker tolerates and we can calibrate against reality instead of against a guess.

### كانداق
*(should be قانداق)*

- flagged:
- suggestions:

### يۇراك
*(should be يۈرەك)*

- flagged:
- suggestions:

### توخكان
*(should be توشقان)*

- flagged:
- suggestions:

### بۇلامماي
*(should be بولالماي)*

- flagged:
- suggestions:

### كانداقتۇر
*(wrong stem + valid suffix — the false-accept probe)*

- flagged:
- suggestions:

---

## GROUP 5 — the تەۋەلىنگەن class: right stem, wrong suffix

Distinct from Group 1's other half. Here the stem is a real word and the error is inside
the suffix chain (`لىنگەن` where `لەنگەن` belongs). Correcting the stem achieves nothing;
the suffix itself has to be matched against a known inventory.

### تەۋەلىنمەك

- flagged:
- suggestions:

### تەۋەلەنمەك

- flagged:
- suggestions:

### ئىشلىتىلىنگەن

- flagged:
- suggestions:

### ئىشلىتىلگەن

- flagged:
- suggestions:

---

## What the next session should do with the results

- **Group 2 mostly accepted** → UyEdit does morphology; build 2B (stem + suffix
  decomposition) as the primary fix and treat corpus vocabulary (2A) as a supplement
  for genuinely new stems only.
- **Group 2 mostly flagged** → even a mature checker enumerates forms; corpus vocabulary
  carries more of the load, and suffix rules stay conservative.
- **Group 4 all flagged, including `كانداقتۇر`** → the false-accept target is strict;
  the suffix inventory must reject chains attached to non-dictionary stems.
- **`كانداقتۇر` accepted** → a shipped checker tolerates this failure mode; record the
  target against that rather than against zero.
- **Group 5 suggestions** → whether the correction comes from string edits or from
  suffix-inventory matching, which decides how much Brill–Moore weighting can carry on
  its own.

Do not decompile the DLLs. This file records observed behaviour only.
