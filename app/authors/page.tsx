import type { Metadata } from "next";
import Link from "next/link";
import { Icon } from "@/components/icons";
import { pageHref, parsePageParam } from "@/components/library/book-grid";
import { AUTHORS_PAGE_SIZE, authorStats, listAuthors } from "@/lib/authors";
import { SITE_NAME } from "@/lib/seo";

export const metadata: Metadata = {
  title: "ئاپتورلار",
  description: `${SITE_NAME}دىكى بارلىق ئاپتورلار — ھەر بىر ئاپتورنىڭ كىتابلىرىنى بىر يەردىن كۆرۈڭ.`,
  alternates: { canonical: "/authors" },
  openGraph: {
    title: "ئاپتورلار",
    description: `${SITE_NAME}دىكى بارلىق ئاپتورلار.`,
    url: "/authors",
  },
};

/**
 * The author index.
 *
 * Sorted in Uyghur alphabetical order, which Postgres cannot do on its own —
 * ug_sort_key in migration 0021 maps the letters onto a run that sorts
 * correctly. Books with nobody credited cannot appear here, so their number is
 * printed instead of being quietly dropped.
 */
export default async function AuthorsPage({ searchParams }: PageProps<"/authors">) {
  const params = await searchParams;
  const page = parsePageParam(params.p);

  const [{ authors, total }, stats] = await Promise.all([
    listAuthors({ limit: AUTHORS_PAGE_SIZE, offset: (page - 1) * AUTHORS_PAGE_SIZE }),
    authorStats(),
  ]);
  const pages = Math.max(1, Math.ceil(total / AUTHORS_PAGE_SIZE));

  return (
    <div className="px-3 py-5 sm:px-6 sm:py-7 lg:px-8">
      <h1 className="flex items-center gap-2.5 text-xl font-bold">
        <Icon name="feather" className="ic-lg text-am" />
        ئاپتورلار
      </h1>
      <p className="mt-1.5 text-[13px] text-ink3" data-testid="authors-summary">
        {total > 0 ? `${total} ئاپتور` : "ئاپتور تېپىلمىدى"}
        {stats.unattributed > 0 && ` · ${stats.unattributed} كىتابنىڭ ئاپتورى كۆرسىتىلمىگەن`}
      </p>

      {authors.length === 0 ? (
        <div className="paper grain mt-5 p-8 text-center" data-testid="authors-empty">
          <Icon name="feather" className="ic-lg mx-auto text-ink3" />
          <p className="mt-3 text-[13.5px] leading-7 text-ink2">
            تېخى ئاپتورى كۆرسىتىلگەن كىتاب يوق.
          </p>
        </div>
      ) : (
        <ul
          data-testid="author-list"
          className="mt-5 grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3"
        >
          {authors.map((author) => (
            <li key={author.key}>
              <Link
                href={`/authors/${encodeURIComponent(author.key)}`}
                data-testid="author-card"
                className="paper grain flex min-h-14 items-center gap-3 px-3.5 py-3 hover:border-am"
              >
                <Icon name="feather" className="shrink-0 text-am" />
                <span className="min-w-0 flex-1 break-words text-[14px] font-semibold text-ink">
                  {author.name}
                </span>
                <span
                  className="shrink-0 rounded-full bg-ab px-2.5 py-1 text-[12px] tabular-nums text-ink2"
                  dir="ltr"
                >
                  {author.bookCount}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {pages > 1 && (
        <nav
          aria-label="بەت تىزىملىكى"
          data-testid="authors-pager"
          className="mt-6 flex flex-wrap items-center justify-center gap-3"
        >
          {page > 1 ? (
            <Link href={pageHref("/authors", page - 1)} className="hbtn" data-testid="pager-prev">
              ئالدىنقى
            </Link>
          ) : (
            <span className="hbtn opacity-40" aria-disabled="true">
              ئالدىنقى
            </span>
          )}
          <span className="text-[12.5px] text-ink3" dir="ltr" data-testid="pager-position">
            {page} / {pages}
          </span>
          {page < pages ? (
            <Link href={pageHref("/authors", page + 1)} className="hbtn" data-testid="pager-next">
              كېيىنكى
            </Link>
          ) : (
            <span className="hbtn opacity-40" aria-disabled="true">
              كېيىنكى
            </span>
          )}
        </nav>
      )}
    </div>
  );
}
