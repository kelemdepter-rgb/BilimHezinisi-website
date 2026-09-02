import { ug_normalize_client } from "@/lib/reader/normalize";
import type { Category } from "@/lib/types";

/**
 * Types and pure helpers shared by server and client code.
 *
 * Kept separate from lib/library.ts because that module imports the
 * cookie-bound Supabase client, which cannot be pulled into a client bundle.
 */

export type BookSort = "new" | "title" | "author";

/**
 * The key an author is grouped under — the JavaScript twin of the generated
 * `books.author_key` column (migration 0021).
 *
 * It exists so a page that already has a book's author can link to that
 * author without asking the database for the column. The two must agree
 * exactly or the link would lead to an empty shelf, so
 * tests/unit/authors-sql.test.ts runs both over the same names.
 */
export function authorKey(author: string): string {
  return ug_normalize_client(author).replace(/\s+/g, " ").trim();
}

export type LibraryBook = {
  id: number;
  title: string;
  author: string;
  category_id: number | null;
  page_count: number;
  date: string;
  cover_path: string | null;
  status: string;
};

export type BookDetail = LibraryBook & {
  description: string;
  language: string;
  format: string;
  /** 'markdown' | 'text' — how the reader must render this book's pages. */
  content_format: string;
  original_file_path: string | null;
  created_at: string;
};

export const LIBRARY_PAGE_SIZE = 24;

/**
 * Cookie holding the grid/list choice.
 *
 * Must live in a plain module: a Server Component importing this from a
 * "use client" file would receive a client reference instead of the string,
 * and silently look up the wrong cookie.
 */
export const VIEW_COOKIE = "bh-library-view";

/** A category plus every category nested under it. */
export function categoryWithDescendants(categories: Category[], rootId: number): number[] {
  const ids = [rootId];
  const walk = (parentId: number) => {
    for (const category of categories) {
      if (category.parent_id === parentId && !ids.includes(category.id)) {
        ids.push(category.id);
        walk(category.id);
      }
    }
  };
  walk(rootId);
  return ids;
}

/** Trail from the root down to `categoryId`, for breadcrumbs. */
export function categoryTrail(categories: Category[], categoryId: number | null): Category[] {
  const trail: Category[] = [];
  let current = categories.find((category) => category.id === categoryId);
  const guard = new Set<number>();
  while (current && !guard.has(current.id)) {
    guard.add(current.id);
    trail.unshift(current);
    current = categories.find((candidate) => candidate.id === current!.parent_id);
  }
  return trail;
}

/**
 * Published-book counts per category, rolled up the tree.
 *
 * A parent's number includes everything nested beneath it, because that is
 * what opening the parent actually shows — listBooks resolves a category
 * through categoryWithDescendants, and after migration 0023 so does
 * search_books. A number that disagreed with the shelf behind it would be
 * worse than no number at all.
 *
 * `direct` holds only the books whose own category_id is that category.
 */
export function rollUpCategoryCounts(
  categories: Category[],
  direct: Record<number, number>,
): Record<number, number> {
  const totals: Record<number, number> = {};
  for (const category of categories) {
    let sum = 0;
    for (const id of categoryWithDescendants(categories, category.id)) sum += direct[id] ?? 0;
    totals[category.id] = sum;
  }
  return totals;
}
