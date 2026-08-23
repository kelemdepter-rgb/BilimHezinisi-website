import { createSupabaseServerClient } from "@/lib/supabase/server";
import { SITE_DESCRIPTION, SITE_NAME, absoluteUrl } from "@/lib/seo";

export const runtime = "nodejs";

/**
 * How many books the feed carries. A feed is a "what is new" list, not an
 * archive — /new is the archive — and every extra entry is bytes every reader
 * downloads on every poll.
 */
const FEED_SIZE = 30;

/**
 * Rebuilt at most once every half hour.
 *
 * NOT a cron job: Vercel Hobby allows one cron run a day and the daily
 * /api/health ping already holds that slot. Caching the route instead means a
 * feed reader polling every fifteen minutes costs one Supabase query per half
 * hour however many readers there are.
 */
export const revalidate = 1800;

type FeedBook = {
  id: number;
  title: string;
  author: string;
  description: string;
  published_at: string | null;
  updated_at: string;
};

/**
 * Control characters XML 1.0 cannot represent at all.
 *
 * Built from escapes rather than written as literals, so the source stays
 * readable and an editor cannot silently eat one.
 */
const CONTROL_CHARS = new RegExp("[\u0000-\u0008\u000B\u000C\u000E-\u001F]", "g");

/**
 * XML text escaping.
 *
 * Book titles and descriptions are typed by people and go into element
 * content, so `&`, `<` and `>` all have to be escaped or one ampersand in a
 * title makes the whole feed unparseable. Quotes are escaped too, cheaply,
 * so the same helper is safe in an attribute.
 */
function xml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
    // A stray NUL from an old import would make the whole feed unparseable.
    .replace(CONTROL_CHARS, "");
}

function rfc3339(value: string | null | undefined, fallback: Date): string {
  const date = value ? new Date(value) : null;
  return (date && !Number.isNaN(date.getTime()) ? date : fallback).toISOString();
}

export async function GET() {
  const now = new Date();
  const self = absoluteUrl("/feed.xml");
  const home = absoluteUrl("/");

  let books: FeedBook[] = [];
  const supabase = await createSupabaseServerClient();
  if (supabase) {
    // Fails soft, like every other reader of published_at: until the migration
    // is pasted in, the feed is valid and empty rather than a 500.
    const { data } = await supabase
      .from("books")
      .select("id, title, author, description, published_at, updated_at")
      .eq("status", "published")
      .not("published_at", "is", null)
      .order("published_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(FEED_SIZE);
    books = (data as FeedBook[] | null) ?? [];
  }

  // The feed's own <updated> is the newest thing in it — a reader that has
  // seen this timestamp knows there is nothing to fetch.
  const newest = books[0] ? rfc3339(books[0].published_at, now) : now.toISOString();

  const entries = books
    .map((book) => {
      const url = absoluteUrl(`/books/${book.id}`);
      const published = rfc3339(book.published_at, now);
      const summary = book.description?.trim() || `${book.title}${book.author ? ` — ${book.author}` : ""}`;
      return [
        "  <entry>",
        `    <title type="text">${xml(book.title)}</title>`,
        `    <link rel="alternate" type="text/html" href="${xml(url)}"/>`,
        // A permanent, never-reused identifier. The book's URL is exactly that.
        `    <id>${xml(url)}</id>`,
        `    <published>${published}</published>`,
        `    <updated>${rfc3339(book.updated_at, now)}</updated>`,
        book.author ? `    <author><name>${xml(book.author)}</name></author>` : "",
        `    <summary type="text">${xml(summary)}</summary>`,
        "  </entry>",
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n");

  const feed = [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<feed xmlns="http://www.w3.org/2005/Atom" xml:lang="ug">',
    `  <title type="text">${xml(SITE_NAME)}</title>`,
    `  <subtitle type="text">${xml(SITE_DESCRIPTION)}</subtitle>`,
    `  <link rel="self" type="application/atom+xml" href="${xml(self)}"/>`,
    `  <link rel="alternate" type="text/html" href="${xml(home)}"/>`,
    `  <id>${xml(home)}</id>`,
    `  <updated>${newest}</updated>`,
    `  <author><name>${xml(SITE_NAME)}</name></author>`,
    entries,
    "</feed>",
    "",
  ]
    .filter((line) => line !== "")
    .join("\n");

  return new Response(feed, {
    headers: {
      "Content-Type": "application/atom+xml; charset=utf-8",
      // Half an hour fresh, and a whole day of staleness is better than a
      // missing feed if the database is unreachable.
      "Cache-Control": "public, max-age=1800, s-maxage=1800, stale-while-revalidate=86400",
    },
  });
}
