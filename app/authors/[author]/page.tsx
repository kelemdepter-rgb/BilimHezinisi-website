import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Icon } from "@/components/icons";
import { BookGrid, parsePageParam } from "@/components/library/book-grid";
import { getCategories } from "@/lib/data";
import { AUTHOR_BOOKS_PAGE_SIZE, booksByAuthor } from "@/lib/authors";
import { coverUrlMap } from "@/lib/library";
import { SITE_NAME } from "@/lib/seo";

/** The URL segment is ug_normalize(author) — the same key the database groups on. */
async function resolve(params: Promise<{ author: string }>) {
  const { author } = await params;
  return decodeURIComponent(author);
}

export async function generateMetadata({
  params,
}: PageProps<"/authors/[author]">): Promise<Metadata> {
  const key = await resolve(params);
  const { name, total } = await booksByAuthor(key, { limit: 1 });
  if (!name) return { title: "ئاپتور تېپىلمىدى", robots: { index: false, follow: false } };

  const description = `${name} — ${SITE_NAME}دىكى ${total} كىتاب. ھېساباتسىز ئوقۇڭ.`;
  const canonical = `/authors/${encodeURIComponent(key)}`;
  return {
    title: name,
    description,
    alternates: { canonical },
    openGraph: { type: "profile", title: name, description, url: canonical },
  };
}

export default async function AuthorPage({
  params,
  searchParams,
}: PageProps<"/authors/[author]">) {
  const key = await resolve(params);
  const query = await searchParams;
  const page = parsePageParam(query.p);

  const [{ books, total, name }, categories] = await Promise.all([
    booksByAuthor(key, {
      limit: AUTHOR_BOOKS_PAGE_SIZE,
      offset: (page - 1) * AUTHOR_BOOKS_PAGE_SIZE,
    }),
    getCategories(),
  ]);

  // An author with no published books is not a page — it is a guessed URL.
  if (books.length === 0 && page === 1) notFound();

  const covers = await coverUrlMap(books);
  const withCovers = books.map((book) => ({
    ...book,
    coverUrl: book.cover_path ? (covers.get(book.cover_path) ?? null) : null,
  }));

  return (
    <div className="px-3 py-5 sm:px-6 sm:py-7 lg:px-8">
      <nav aria-label="يول" className="mb-4 flex flex-wrap items-center gap-1.5 text-[12.5px] text-ink3">
        <Link href="/" className="hover:text-ink">
          كۇتۇپخانا
        </Link>
        <span aria-hidden="true">‹</span>
        <Link href="/authors" className="hover:text-ink" data-testid="authors-breadcrumb">
          ئاپتورلار
        </Link>
      </nav>

      <h1 className="flex items-center gap-2.5 text-xl font-bold" data-testid="author-name">
        <Icon name="feather" className="ic-lg text-am" />
        {name || key}
      </h1>
      <p className="mt-1.5 text-[13px] text-ink3" data-testid="author-book-count">
        {total} كىتاب
      </p>

      <div className="mt-5">
        <BookGrid
          books={withCovers}
          total={total}
          page={page}
          pageSize={AUTHOR_BOOKS_PAGE_SIZE}
          basePath={`/authors/${encodeURIComponent(key)}`}
          categoryName={(id) => categories.find((category) => category.id === id)?.name ?? null}
          emptyMessage="بۇ ئاپتورنىڭ بۇ بەتتە كىتابى يوق."
        />
      </div>
    </div>
  );
}
