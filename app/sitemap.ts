import type { MetadataRoute } from "next";
import { getCategories } from "@/lib/data";
import { AUTHORS_PAGE_SIZE, listAuthors } from "@/lib/authors";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { absoluteUrl } from "@/lib/seo";

/**
 * Rebuilt at most once an hour. A crawler can ask for this often, and every
 * request would otherwise be two Supabase queries — the free tier's egress is
 * the thing being protected here.
 */
export const revalidate = 3600;

/** 114 suras, always. */
const SURA_COUNT = 114;

/** As many authors as the sitemap will ever list. Far beyond today's shelf. */
const AUTHOR_LIMIT = 3000;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();

  const staticPages: MetadataRoute.Sitemap = [
    { url: absoluteUrl("/"), lastModified: now, changeFrequency: "daily", priority: 1 },
    { url: absoluteUrl("/quran"), lastModified: now, changeFrequency: "monthly", priority: 0.9 },
    { url: absoluteUrl("/authors"), lastModified: now, changeFrequency: "weekly", priority: 0.6 },
    { url: absoluteUrl("/search"), lastModified: now, changeFrequency: "monthly", priority: 0.3 },
    { url: absoluteUrl("/about"), lastModified: now, changeFrequency: "yearly", priority: 0.4 },
    { url: absoluteUrl("/privacy"), lastModified: now, changeFrequency: "yearly", priority: 0.3 },
  ];

  const suraPages: MetadataRoute.Sitemap = Array.from({ length: SURA_COUNT }, (_, index) => ({
    url: absoluteUrl(`/quran/${index + 1}`),
    lastModified: now,
    changeFrequency: "yearly",
    priority: 0.6,
  }));

  const supabase = await createSupabaseServerClient();
  if (!supabase) return [...staticPages, ...suraPages];

  // Only the columns the sitemap needs, and read in pages: migration 0009 caps
  // an anonymous request at 1,000 rows, so a single query would quietly stop
  // listing books once the library outgrew it. Drafts are excluded here AND by
  // RLS — the anon key is what runs this.
  const PAGE = 500;
  const books: { id: number; updated_at: string }[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("books")
      .select("id, updated_at")
      .eq("status", "published")
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error || !data || data.length === 0) break;
    books.push(...(data as { id: number; updated_at: string }[]));
    if (data.length < PAGE) break;
  }

  const categories = await getCategories();

  /**
   * Author pages, read the same way the books are: the RPC caps a page at 100,
   * so a single call would silently stop listing once the shelf outgrew it.
   * Bounded, because a sitemap that walks forever is its own outage.
   */
  const authors: { key: string }[] = [];
  for (let offset = 0; offset < AUTHOR_LIMIT; offset += AUTHORS_PAGE_SIZE) {
    const { authors: batch, total } = await listAuthors({ limit: AUTHORS_PAGE_SIZE, offset });
    authors.push(...batch.map((author) => ({ key: author.key })));
    if (batch.length < AUTHORS_PAGE_SIZE || authors.length >= total) break;
  }

  const authorPages: MetadataRoute.Sitemap = authors.map((author) => ({
    url: absoluteUrl(`/authors/${encodeURIComponent(author.key)}`),
    lastModified: now,
    changeFrequency: "weekly",
    priority: 0.5,
  }));

  const bookPages: MetadataRoute.Sitemap = books
    .flatMap((book) => [
      {
        url: absoluteUrl(`/books/${book.id}`),
        lastModified: new Date(book.updated_at),
        changeFrequency: "monthly" as const,
        priority: 0.8,
      },
      {
        url: absoluteUrl(`/books/${book.id}/read`),
        lastModified: new Date(book.updated_at),
        changeFrequency: "monthly" as const,
        priority: 0.7,
      },
    ]);

  const categoryPages: MetadataRoute.Sitemap = categories.map((category) => ({
    url: absoluteUrl(`/?cat=${category.id}`),
    lastModified: now,
    changeFrequency: "weekly",
    priority: 0.5,
  }));

  return [...staticPages, ...categoryPages, ...authorPages, ...bookPages, ...suraPages];
}
