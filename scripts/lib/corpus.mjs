/**
 * The published library, tokenised — the shared input to word frequencies,
 * the corpus vocabulary and the evaluation sets.
 *
 * Scanning is network-bound (every page of every published book), so the
 * result is cached on disk and the three build scripts reuse it instead of
 * re-reading the database three times. Pass --rescan to refresh it.
 *
 * Two numbers are kept per word, and the second is the important one:
 *
 *   total  how often the word occurs across the whole library
 *   books  how many DIFFERENT books it occurs in
 *
 * A word repeated 40 times in one book is usually a proper noun, a house
 * spelling or an OCR artefact of that one volume. The same word in three books
 * is Uyghur. Every decision downstream — which words count as known-good, which
 * are admitted to the dictionary, which seed the evaluation sets — is gated on
 * the book count, never on the raw total.
 */
import { createClient } from "@supabase/supabase-js";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { wordsOf } from "./uyghur.mjs";

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const dataDir = join(repoRoot, "spellcheck-data");
const cachePath = join(dataDir, "corpus-counts.tsv");

/** Supabase returns at most 1,000 rows per request whatever the range asks for. */
const PAGE_BATCH = 1000;

function client() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
    console.error("Run with:  node --env-file=.env.local scripts/<name>.mjs");
    process.exit(1);
  }
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

/**
 * Read every published book once, counting words.
 *
 * Books are processed one at a time and the distinct words of each book are
 * collected before merging, which is what makes the book count exact without
 * holding a per-word set for all 400k+ words at once.
 */
async function scan() {
  const supabase = client();
  const { data: books, error } = await supabase
    .from("books")
    .select("id,title")
    .eq("status", "published")
    .order("id");
  if (error) throw new Error(`books: ${error.message}`);

  /** word → [total occurrences, books containing it] */
  const counts = new Map();
  let pagesRead = 0;
  let charsRead = 0;

  for (const [index, book] of books.entries()) {
    const inThisBook = new Map();
    for (let from = 0; ; from += PAGE_BATCH) {
      const { data: pages, error: pageError } = await supabase
        .from("book_pages")
        .select("content")
        .eq("book_id", book.id)
        .order("page_no")
        .range(from, from + PAGE_BATCH - 1);
      if (pageError) throw new Error(`pages of ${book.title}: ${pageError.message}`);
      if (!pages || pages.length === 0) break;

      for (const page of pages) {
        pagesRead++;
        charsRead += page.content.length;
        for (const word of wordsOf(page.content)) {
          inThisBook.set(word, (inThisBook.get(word) ?? 0) + 1);
        }
      }
      if (pages.length < PAGE_BATCH) break;
    }

    for (const [word, n] of inThisBook) {
      const entry = counts.get(word);
      if (entry) {
        entry[0] += n;
        entry[1] += 1;
      } else {
        counts.set(word, [n, 1]);
      }
    }
    process.stdout.write(
      `\r  scanned ${index + 1}/${books.length} books · ${pagesRead} pages · ${counts.size.toLocaleString("en-US")} distinct words`,
    );
  }
  process.stdout.write("\n");

  return { counts, books: books.length, pages: pagesRead, chars: charsRead };
}

function serialise(scan) {
  const lines = [`# books=${scan.books} pages=${scan.pages} chars=${scan.chars}`];
  // Sorted so the cache file is stable and diffable between runs.
  for (const word of [...scan.counts.keys()].sort()) {
    const [total, books] = scan.counts.get(word);
    lines.push(`${word}\t${total}\t${books}`);
  }
  return lines.join("\n");
}

function parse(text) {
  const counts = new Map();
  let meta = { books: 0, pages: 0, chars: 0 };
  for (const line of text.split("\n")) {
    if (!line) continue;
    if (line.startsWith("#")) {
      for (const part of line.slice(1).trim().split(" ")) {
        const [key, value] = part.split("=");
        if (key in meta) meta[key] = Number(value);
      }
      continue;
    }
    const [word, total, books] = line.split("\t");
    counts.set(word, [Number(total), Number(books)]);
  }
  return { counts, ...meta };
}

/** The corpus counts, from disk when they are there and from the database when not. */
export async function corpusCounts({ rescan = false } = {}) {
  if (!rescan && existsSync(cachePath)) {
    const parsed = parse(await readFile(cachePath, "utf-8"));
    console.log(
      `corpus: ${parsed.counts.size.toLocaleString("en-US")} distinct words ` +
        `from ${parsed.books} books (cached — pass --rescan to refresh)`,
    );
    return parsed;
  }

  console.log("Scanning the published library…");
  const result = await scan();
  await mkdir(dataDir, { recursive: true });
  await writeFile(cachePath, serialise(result), "utf-8");
  console.log(
    `corpus: ${result.counts.size.toLocaleString("en-US")} distinct words ` +
      `from ${result.books} books, ${result.pages} pages, ` +
      `${(result.chars / 1048576).toFixed(1)} MB of text`,
  );
  return result;
}

/** Words attested widely enough to be treated as correct Uyghur without review. */
export function attested(counts, { minTotal, minBooks }) {
  const out = new Set();
  for (const [word, [total, books]] of counts) {
    if (total >= minTotal && books >= minBooks) out.add(word);
  }
  return out;
}
