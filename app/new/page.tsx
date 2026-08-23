import type { Metadata } from "next";
import { Icon } from "@/components/icons";
import { BookGrid, parsePageParam } from "@/components/library/book-grid";
import { getCategories } from "@/lib/data";
import { coverUrlMap, listNewBooks } from "@/lib/library";
import { LIBRARY_PAGE_SIZE } from "@/lib/library-types";
import { SITE_NAME } from "@/lib/seo";

export const metadata: Metadata = {
  title: "يېڭى كىتابلار",
  description: `${SITE_NAME}غا يېقىندا قوشۇلغان كىتابلار — ئەڭ يېڭىسى ئالدىدا.`,
  alternates: { canonical: "/new" },
  openGraph: {
    title: "يېڭى كىتابلار",
    description: `${SITE_NAME}غا يېقىندا قوشۇلغان كىتابلار.`,
    url: "/new",
  },
};

/** Everything that has been published, newest first. */
export default async function NewBooksPage({ searchParams }: PageProps<"/new">) {
  const params = await searchParams;
  const page = parsePageParam(params.p);

  const [{ books, total }, categories] = await Promise.all([
    listNewBooks({ limit: LIBRARY_PAGE_SIZE, offset: (page - 1) * LIBRARY_PAGE_SIZE }),
    getCategories(),
  ]);

  const covers = await coverUrlMap(books);
  const withCovers = books.map((book) => ({
    ...book,
    coverUrl: book.cover_path ? (covers.get(book.cover_path) ?? null) : null,
  }));

  return (
    <div className="px-3 py-5 sm:px-6 sm:py-7 lg:px-8">
      <h1 className="flex items-center gap-2.5 text-xl font-bold">
        <Icon name="sparkles" className="ic-lg text-am" />
        يېڭى كىتابلار
      </h1>
      <p className="mt-1.5 text-[13px] text-ink3" data-testid="new-count">
        {total > 0 ? `${total} كىتاب` : "تېخى كىتاب قوشۇلمىدى"}
        {" · "}
        <a href="/feed.xml" className="text-am hover:underline" data-testid="feed-link">
          RSS
        </a>
      </p>

      <div className="mt-5">
        <BookGrid
          books={withCovers}
          total={total}
          page={page}
          pageSize={LIBRARY_PAGE_SIZE}
          basePath="/new"
          categoryName={(id) => categories.find((category) => category.id === id)?.name ?? null}
          emptyMessage="يېڭى كىتاب تېخى يوق. سەل تۇرۇپ قايتا كېلىڭ."
        />
      </div>
    </div>
  );
}
