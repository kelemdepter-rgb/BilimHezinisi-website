import type { Category } from "@/lib/types";

/**
 * The category tree as a flat list with a depth for each entry, so a `<select>`
 * can show the hierarchy by indenting rather than by nesting (optgroups only
 * go one level deep, and this tree does not).
 *
 * Shared by the single-book wizard and the batch importer, which is the point:
 * a category picked in one has to mean the same thing in the other.
 */
export function flattenCategories(categories: Category[]): { category: Category; depth: number }[] {
  const byParent = new Map<number | null, Category[]>();
  for (const category of categories) {
    const list = byParent.get(category.parent_id) ?? [];
    list.push(category);
    byParent.set(category.parent_id, list);
  }
  for (const list of byParent.values()) {
    list.sort((a, b) => a.sort_order - b.sort_order || a.id - b.id);
  }

  const out: { category: Category; depth: number }[] = [];
  const walk = (parentId: number | null, depth: number) => {
    for (const category of byParent.get(parentId) ?? []) {
      out.push({ category, depth });
      walk(category.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

/** The indented label a picker shows for one entry. */
export function categoryOptionLabel(entry: { category: Category; depth: number }): string {
  return `${"— ".repeat(entry.depth)}${entry.category.name}`;
}
