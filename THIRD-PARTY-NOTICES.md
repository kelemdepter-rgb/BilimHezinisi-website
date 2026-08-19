# Third-Party Notices — بىلىم خەزىنىسى (Bilim Hezinisi), web edition

This site serves third-party fonts, texts and software libraries. Each item
below is redistributed under the licence stated for it. The MIT licence in
`LICENSE` applies only to the original source code of this project.

Last reviewed: 2026-08-19

---

## 1. Fonts

Everything in this section is what the site **actually serves** from
`public/fonts/`. A font that is offered in the reader but not listed here is
resolved from the visitor's own operating system and is never downloaded from
this site.

### UKIJ font family — LGPL
Served files: `ukijekran.woff2`, `ukij-tuz.woff2`, `ukij-tuz-bold.woff2`,
`ukij-tuz-tom.woff2`, `ukij-tuz-kitab.woff2`, `ukij-tuz-kitab-bold.woff2`

- Copyright: Uyghur Computer Science Association (UKIJ) — <http://www.ukij.org>
- Licence: GNU Lesser General Public License —
  <http://www.gnu.org/licenses/lgpl.html>
- Each file's own `name` table records `LGPL` as its licence; the licence was
  read from the font binaries, not assumed from their filenames.
- **Modification notice (LGPL):** the originals are TrueType (`.ttf`). They
  were converted to WOFF2 by `scripts/build-fonts.mjs` so that a reader on a
  phone downloads roughly half as much. WOFF2 is a lossless container: no
  glyph outline, metric, kerning or name-table record was altered. The
  converted files remain under the LGPL, and the unmodified originals are
  available from <http://www.ukij.org/fonts>.

### KFGQPC Uthmanic Hafs — free redistribution licence
Served files: `UthmanicHafs1-Ex1-Ver12.otf`, `UthmanicHafs1B-Ex1-Ver12.otf`

- Copyright (c) 2010 King Fahd Glorious Quran Printing Complex (KFGQPC),
  Al-Madinah Al-Munawwarah, Kingdom of Saudi Arabia. All rights reserved.
- ISBN 978-603-8010-15-0, Accession No. 1430/7278
- Designer: Alif Lam Mim Tech. (Ashfaq A. Niazi)
- Source: <http://fonts.qurancomplex.gov.sa/>
- Licence (from the font's embedded EULA): permission is granted, free of
  cost, to use, copy and distribute the font, subject to the condition that
  the font software is not sold, modified, altered, translated, reverse
  engineered, decompiled or disassembled.
- These two files are served **byte-for-byte unmodified**. They are
  deliberately NOT converted to WOFF2, because a format conversion is a
  modification of the font software and the licence does not permit one.

### Traditional Arabic — NOT served
`'Traditional Arabic'` is offered as a reading font and is named in the site's
font stacks, but **no file is served and no `@font-face` declares it**. It is
resolved from the visitor's own operating system, where it ships with Windows
as a Microsoft-supplied Monotype font whose licence does not permit
redistribution by third parties. Visitors who do not have it fall through to
UKIJ Ekran, which this site does serve.

### Bahij Nazanin — removed
Previously served, now removed entirely. Its own licence record reads: *"For
personal, educational and non-commercial use only. Not for reproduction,
distribution or commercial use."* Serving it was redistribution. Readers who
had selected it are migrated to the default font automatically.

### UKIJ Esliye — not served
Offered by the desktop app but not by this site. `UKIJEsliye.ttf` carries
"Copyright (c) 2003-2005 Adiljan.Abliz(Uqkur),Turghun(Bilge) All Rights
Reserved" with no licence grant of any kind — only the Bold cut of that family
carries the UKIJ/LGPL record. Because the regular weight cannot be
redistributed, the family is left out.

---

## 2. Qur'an text and translation

### Arabic text — Tanzil Qur'an Text (Uthmani, Hafs)
Stored in the `quran_ayas` table, seeded by `scripts/seed-quran.mjs`.

- Copyright (C) 2007-2025 Tanzil Project — <https://tanzil.net>
- Licence: Creative Commons Attribution 3.0 — <https://tanzil.net/docs/text_license>
- Permission is granted to copy and distribute **verbatim** copies of this
  text, but **changing it is not allowed**. The text is stored and displayed
  unmodified, the source is identified as the Tanzil Project, and a link to
  <https://tanzil.net> is shown on `/quran` and under every sura so readers
  can track changes.

### Uyghur translation — Shaykh Muhammad Salih
- Translation of the meanings of the Noble Qur'an into Uyghur.
- Publisher / source: **QuranEnc.com** — Encyclopedia of the Noble Qur'an,
  <https://quranenc.com/en/browse/uyghur_saleh>
- Version redistributed: **v1.0.2-xml.1** (updated 2025-09-03)
- Redistributed under QuranEnc's publishing terms: the text is reproduced
  without alteration or deletion, the publisher, translator and version are
  credited on every page that shows it, and no advertising is displayed
  anywhere on this site.
- Updates: <https://quranenc.com/check/uyghur_saleh/v1.0.2-xml.1>

---

## 3. Language data

### Uyghur spell-check word list
Served file: `public/spellcheck/uyghur-dict.bin`,
`public/spellcheck/corrections.json`

- Derived from **UyghurSpell** — <https://github.com/gheyret/UyghurSpell>,
  MIT License, Copyright (c) 2022 Uyghur — by way of the desktop edition's
  `assets/spellcheck/`, and extended with words admitted from this library's
  own published books (`data/spellcheck/vocabulary.txt`, reviewed by hand).
- The `.bin` file is a packed index built by `scripts/build-spelldict.mjs`; it
  contains the same words, one byte per letter, and no other content.

### SymSpell algorithm
`lib/spellcheck/dictionary.ts` implements the SymSpell symmetric-delete
algorithm by Wolf Garbe (<https://github.com/wolfgarbe/SymSpell>), MIT
License. The implementation is this project's own; the algorithm is the
borrowed part.

---

## 4. npm dependencies (runtime)

| Package | Version | Licence |
| --- | --- | --- |
| @mozilla/readability | ^0.6.0 | Apache-2.0 |
| @supabase/ssr | ^0.12.4 | MIT |
| @supabase/supabase-js | ^2.112.0 | MIT |
| docx | ^9.7.1 | MIT |
| dompurify | ^3.4.13 | MPL-2.0 OR Apache-2.0 |
| jsdom | ^30.0.1 | MIT |
| mammoth | ^1.12.0 | BSD-2-Clause |
| markdown-it | ^15.0.0 | MIT |
| next | 16.3.0 | MIT |
| parse5 | ^8.0.1 | MIT |
| react | 19.2.8 | MIT |
| react-dom | 19.2.8 | MIT |
| server-only | ^0.0.1 | MIT |
| turndown | ^7.2.4 | MIT |
| turndown-plugin-gfm | ^1.0.2 | MIT |
| word-extractor | ^1.0.4 | MIT |

Build- and test-time only (never served to a visitor): @electric-sql/pglite
(Apache-2.0), @playwright/test (Apache-2.0), @tailwindcss/postcss and
tailwindcss (MIT), cross-env (MIT), eslint and eslint-config-next (MIT),
typescript (Apache-2.0), vitest (MIT), wawoff2 (MIT — the WOFF2 encoder used
by `scripts/build-fonts.mjs`), and the `@types/*` packages (MIT).

---

## 5. Services

- **Vercel** hosts the site (Hobby plan). <https://vercel.com/legal/privacy-policy>
- **Supabase** stores the database, accounts and files (Free plan).
  <https://supabase.com/privacy>

No third-party script, font, analytics or advertising service is loaded at
runtime. Everything the browser downloads comes from this site's own origin
and from Supabase Storage for book covers.

---

## 6. The books

The books in this library remain the property of their authors and
publishers. They are made available for reading, free of charge and without
advertising, as a public library service.

---

If you believe any material on this site is used in a way that infringes your
rights, write to **kelemdepter@gmail.com** — it will be corrected or removed
promptly.
