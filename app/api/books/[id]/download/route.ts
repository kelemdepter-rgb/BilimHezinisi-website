import { NextResponse, type NextRequest } from "next/server";
import { BOOK_DOWNLOAD_RULE, callerKey, isRateLimited } from "@/lib/rate-limit";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The gate in front of a whole-book download.
 *
 * The pages themselves are NOT served from here. They come straight out of
 * Supabase under RLS, the same way the reader already reads them, so the ones
 * already in the offline cache cost nothing to reuse and no Vercel function
 * ever holds a book in memory. What this route does is decide whether the
 * bulk read may start at all:
 *
 *   - the book has to be published, so a draft cannot be pulled out whole;
 *   - the caller has to be inside their allowance, because one download reads
 *     every row of a book and this project has 5 GB of egress a month.
 *
 * It answers with the metadata the file needs — title, author, page count —
 * which the browser would otherwise have to ask Supabase for separately.
 *
 * The limiter is in-process, as it is for the auth actions: a Postgres
 * counter would let an anonymous visitor make the site write a row per
 * attempt, turning the defence into its own cost. It holds per server
 * instance, which stops a burst from one address; Supabase's own limits are
 * what stand behind it.
 */
export async function GET(_request: NextRequest, context: RouteContext<"/api/books/[id]/download">) {
  const { id } = await context.params;
  const bookId = Number(id);
  if (!Number.isInteger(bookId) || bookId <= 0) {
    return NextResponse.json({ ok: false, reason: "not-found" }, { status: 404 });
  }

  if (isRateLimited(`download:${await callerKey()}`, BOOK_DOWNLOAD_RULE)) {
    return NextResponse.json(
      {
        ok: false,
        reason: "rate-limited",
        // Shown to the reader as-is; a bare 429 would say nothing in Uyghur.
        message: "بىر قانچە كىتابنى ئارقىمۇئارقا چۈشۈردىڭىز. سەل تۇرۇپ قايتا سىناڭ.",
      },
      { status: 429, headers: { "cache-control": "no-store" } },
    );
  }

  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json({ ok: false, reason: "not-configured" }, { status: 503 });
  }

  const { data } = await supabase
    .from("books")
    .select("id, title, author, page_count, content_format, status")
    .eq("id", bookId)
    .maybeSingle();

  // A draft is refused even for the editor who can see it: an unpublished
  // book is not something to hand out as a file.
  if (!data || data.status !== "published") {
    return NextResponse.json(
      {
        ok: false,
        reason: "not-published",
        message: "بۇ كىتاب تېخى ئېلان قىلىنمىغان، شۇڭا چۈشۈرگىلى بولمايدۇ.",
      },
      { status: 404, headers: { "cache-control": "no-store" } },
    );
  }

  return NextResponse.json(
    {
      ok: true,
      title: data.title as string,
      author: (data.author as string | null) ?? "",
      pageCount: Number(data.page_count) || 0,
      contentFormat: data.content_format === "markdown" ? "markdown" : "text",
    },
    { headers: { "cache-control": "no-store" } },
  );
}
