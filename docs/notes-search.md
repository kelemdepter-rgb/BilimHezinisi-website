# Searching one's own notes (PROMPT-47)

`/notes` has a search box. It asks `search_my_notes` (migration
`0031_note_list.sql`), which finds the writer's notes — outside the trash —
whose `ug_normalize(title || E'\n' || content_text)` contains
`ug_normalize(query)`: one literal phrase, no operators, hamza forms, tashkil,
tatweel, whitespace and letter case folded the way the library search folds
them. The task's requirement: **at most 1 s** for one writer holding **200
notes of 60,000 characters**, measured on the local stack, never on
production.

## The copy it was measured on

`node scripts/flood/stack.mjs up` — Supabase's Postgres image 17.6.1.143 and
PostgREST 14.5, every migration applied (0031 included), the database
container held to 0.66 CPU. On this stack a single library search takes about
**half** its live time (docs/search-flood.md, docs/search-common-words.md), so
a live estimate below is the local number × 2.2.

`node scripts/flood/notes-search.mjs` then makes one invented writer with 200
notes of exactly 60,000 characters each (random words from a fixed list; every
note ends in «خەزىنە», every tenth holds «يېشىل باغ» in its middle), each with
a matching HTML copy as the editor stores it, and asks PostgREST as that
writer, seven times per query after one warm-up. Nothing here is anyone's
real writing.

That notebook is **42 MB** — about eight times what the quota lets one
account hold (5 MB, migration 0030, counted over title + HTML + text). No real
writer can reach it; it is the bound the task named, and a generous one.

## Measured (2026-10-13)

| Query | Rows | min | median | max |
|---|---:|---:|---:|---:|
| a word in every note («خەزىنە») | 50 (cap) | 87 ms | 102 ms | 107 ms |
| a word in none («زىمىستان») | 0 | 100 ms | 101 ms | 107 ms |
| a two-word phrase («يېشىل باغ») | 20 | 97 ms | 102 ms | 169 ms |
| a 99-character phrase | 0 | 102 ms | 105 ms | 112 ms |
| hamza forms and tashkil («أَنَا بِلِيمْ») | 0 | 94 ms | 103 ms | 145 ms |

End to end through PostgREST. **About 0.1 s locally; live, about 0.2–0.4 s.**
A query outside 2–100 characters is answered in ~7 ms without reading a note.

## Why not plain `strpos`

The first version did exactly what the definition says — `strpos` over
`ug_normalize` of every note — and took **1.94–2.06 s** on the same notes: it
normalizes the whole notebook on every search. Timed step by step over the 200
notes:

| Step of `ug_normalize` | Time |
|---|---:|
| reading the 200 texts | 86 ms |
| deleting tashkil (`regexp_replace`, class) | 197 ms |
| unifying alif forms (`translate`) | 486 ms |
| collapsing whitespace (`regexp_replace '\s+'`) | 1,105 ms |
| `lower` | 234 ms |
| **all of `ug_normalize`** | **2,064 ms** |

The regular expression engine itself is fast; what costs is producing a new
60,000-character string with ten thousand replacements in it, per note, per
search.

So the notes are left as they are, and the query is turned round instead: the
normalized phrase becomes a pattern that accepts exactly what `ug_normalize`
would have folded into it — ا also as ٱ آ أ إ; any tashkil or tatweel between
two letters; a space as any run of whitespace (marks among it); either case
(`~*`); every other character escaped, so nothing typed is read as an
operator. One pass of the regular expression over each note, nothing copied.

**The same notes are found.** `tests/unit/note-list-sql.test.ts` compares the
two ways on 220 generated queries over 40 generated notes — alif forms, tashkil,
tatweel, tabs, newlines, ideographic spaces, Latin case and every character a
pattern could misread — and fails on the first note where they differ; it
fails, too, if the alif forms, the marks between letters, the whitespace rule
or the case rule is taken out of the pattern (each checked by breaking it).

## Not chosen

- **A stored, normalized copy of each note** (a generated column): searching
  it would be a plain `strpos`, but it stores every note's text twice inside
  the 500 MB free database — the kind of copy 0014 removed from the books.
- **A trigram index**: larger still than the copy.
- **Title and preview only** (the task's named fallback): fast, but a word
  past the first 160 characters would never be found. Not needed at ~0.1 s.
