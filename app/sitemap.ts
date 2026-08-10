import type { MetadataRoute } from "next";
import { getCategories } from "@/lib/data";
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

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();

  const staticPages: MetadataRoute.Sitemap = [
    { url: absoluteUrl("/"), lastModified: now, changeFrequency: "daily", priority: 1 },
    { url: absoluteUrl("/quran"), lastModified: now, changeFrequency: "monthly", priority: 0.9 },
    { url: absoluteUrl("/search"), lastModified: now, changeFrequency: "monthly", priority: 0.3 },
  ];

  const suraPages: MetadataRoute.Sitemap = Array.from({ length: SURA_COUNT }, (_, index) => ({
    url: absoluteUrl(`/quran/${index + 1}`),
    lastModified: now,
    changeFrequency: "yearly",
    priority: 0.6,
  }));

  const supabase = await createSupabaseServerClient();
  if (!supabase) return [...staticPages, ...suraPages];

  // Only the columns the sitemap needs, so this stays small at hundreds of
  // books. Drafts are excluded here AND by RLS — the anon key is what runs it.
  const [{ data: books }, categories] = await Promise.all([
    supabase
      .from("books")
      .select("id, updated_at")
      .eq("status", "published")
      .order("id", { ascending: true }),
    getCategories(),
  ]);

  const bookPages: MetadataRoute.Sitemap = ((books as { id: number; updated_at: string }[] | null) ?? [])
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

  return [...staticPages, ...categoryPages, ...bookPages, ...suraPages];
}
