import type { Category } from "@/lib/types";

/**
 * Types and pure helpers shared by server and client code.
 *
 * Kept separate from lib/library.ts because that module imports the
 * cookie-bound Supabase client, which cannot be pulled into a client bundle.
 */

export type BookSort = "new" | "title" | "author";

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
