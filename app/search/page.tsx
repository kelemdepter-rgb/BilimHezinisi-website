import type { Metadata } from "next";
import Link from "next/link";
import { Icon } from "@/components/icons";
import { Snippet } from "@/components/search/snippet";
import { getCategories } from "@/lib/data";
import { highlightTermsFromQuery } from "@/lib/reader/highlight";
import { runBookSearch } from "@/lib/search";

/**
 * Result pages are thin and endless in number, so they stay out of the index
 * while their links are still followed — the books themselves are what should
 * rank. The search page itself remains indexable.
 */
export const metadata: Metadata = {
  title: "ئىزدەش",
  description: "«بىلىم خەزىنىسى» كۇتۇپخانىسىدىكى بارلىق كىتابلارنىڭ ئىچىدىن سۆز ۋە ئىبارە ئىزدەڭ.",
  alternates: { canonical: "/search" },
  robots: { index: true, follow: true },
};

const PAGE_SIZE = 20;

export default async function SearchPage({ searchParams }: PageProps<"/search">) {
  const params = await searchParams;
  const query = typeof params.q === "string" ? params.q.trim() : "";
  const categoryId = typeof params.cat === "string" && params.cat ? Number(params.cat) : null;
  const pageNo = Math.max(1, Number(params.p ?? 1) || 1);
  const offset = (pageNo - 1) * PAGE_SIZE;

  const categories = await getCategories();

  const { hits, elapsedMs, failed, moreAvailable } = await runBookSearch({
    query,
    categoryId: categoryId && Number.isFinite(categoryId) ? categoryId : null,
    limit: PAGE_SIZE,
    offset,
  });

  const term = highlightTermsFromQuery(query);
  const linkParams = (next: Record<string, string | null>) => {
    const search = new URLSearchParams();
    if (query) search.set("q", query);
    if (categoryId) search.set("cat", String(categoryId));
    for (const [key, value] of Object.entries(next)) {
      if (value === null) search.delete(key);
      else search.set(key, value);
    }
    return search.toString();
  };

  return (
    <div className="px-3 py-5 sm:px-6 sm:py-7 lg:px-8">
      <h1 className="flex items-center gap-2.5 text-xl font-bold">
        <Icon name="search" className="ic-lg text-am" />
        ئىزدەش
      </h1>

      <form className="mt-4 flex flex-wrap gap-2" role="search" action="/search">
        <input
          className="field min-w-48 flex-1"
          type="search"
          name="q"
          defaultValue={query}
          placeholder="سۆز، ئىبارە ياكى ئاپتور…"
          aria-label="كۇتۇپخانىدىن ئىزدەش"
          data-testid="search-input"
        />
        <select className="field w-auto" name="cat" defaultValue={categoryId ? String(categoryId) : ""} aria-label="تۈر">
          <option value="">ھەممە تۈرلەر</option>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </select>
        <button type="submit" className="btn-am" data-testid="search-submit">
          <Icon name="search" />
          ئىزدەش
        </button>
      </form>

      <p className="mt-2.5 text-[12.5px] leading-6 text-ink3">
        ئىبارە ئۈزۈن ئىزدەش ئۈچۈن &laquo;<span dir="ltr">&quot;ئۇيغۇر تىلى&quot;</span>&raquo; دەپ
        قوش تىرناققا ئېلىڭ · ئىككى سۆزنىڭ بىرى ئۈچۈن <span dir="ltr">OR</span> ·
        بىر سۆزنى چىقىرىۋېتىش ئۈچۈن ئالدىغا <span dir="ltr">-</span> قويۇڭ.
      </p>

      {/* Book search and Quran search stay separate: this page only ever
          returns books, and the Quran has its own page and its own RPC. */}
      <p className="mt-2 text-[12.5px] text-ink3">
        بۇ بەت پەقەت كىتابلاردىن ئىزدەيدۇ.{" "}
        <Link
          href={query ? `/quran?q=${encodeURIComponent(query)}` : "/quran"}
          className="text-am underline underline-offset-2"
          data-testid="search-quran-link"
        >
          قۇرئاندىن ئىزدەش
        </Link>
      </p>

      {!query ? (
        <p className="paper mt-5 p-6 text-center text-[13.5px] text-ink2" data-testid="search-idle">
          ئىزدەش ئۈچۈن يۇقىرىدىكى رامكىغا سۆز كىرگۈزۈڭ.
        </p>
      ) : failed ? (
        <p role="alert" className="mt-5 rounded-[var(--radius)] border border-bd2 bg-ab2 px-3.5 py-3 text-[13px]">
          ئىزدەشتە خاتالىق كۆرۈلدى. سەل تۇرۇپ قايتا سىناڭ.
        </p>
      ) : hits.length === 0 ? (
        <div className="paper mt-5 p-6 text-center" data-testid="search-empty">
          <Icon name="search" className="ic-lg mx-auto text-am" />
          <h2 className="mt-3 text-[15px] font-bold">ھېچنېمە تېپىلمىدى</h2>
          <p className="mx-auto mt-2 max-w-md text-[13.5px] leading-7 text-ink2">
            «{query}» بويىچە نەتىجە چىقمىدى. باشقا سۆز بىلەن سىناپ كۆرۈڭ ياكى تۈر
            چەكلىمىسىنى ئېلىۋېتىڭ.
          </p>
        </div>
      ) : (
        <>
          <p className="mt-4 text-[13px] text-ink3" data-testid="search-meta">
            بۇ بەتتە {hits.length} نەتىجە · {(elapsedMs / 1000).toFixed(2)} سېكۇنت
          </p>

          <ul className="mt-3 space-y-2" data-testid="search-results">
            {hits.map((hit) => (
              <li key={`${hit.book_id}-${hit.page_no}`}>
                <Link
                  href={`/books/${hit.book_id}/read?page=${Math.max(1, hit.page_no)}&q=${encodeURIComponent(term)}`}
                  data-testid="search-result"
                  className="paper block p-3.5 hover:shadow-[var(--shadow-2)]"
                >
                  <span className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                    <span className="text-[14.5px] font-bold text-ink">{hit.title}</span>
                    {hit.author && <span className="text-[12.5px] text-ink3">{hit.author}</span>}
                    {hit.page_no > 0 && (
                      <span className="ms-auto rounded-full bg-bg2 px-2.5 py-0.5 text-[11.5px] text-ink2">
                        {hit.page_no}-بەت
                      </span>
                    )}
                  </span>
                  <span className="mt-1.5 block text-[13.5px] leading-7 text-ink2">
                    <Snippet snippet={hit.snippet} />
                  </span>
                </Link>
              </li>
            ))}
          </ul>

          {(pageNo > 1 || moreAvailable) && (
            <nav className="mt-5 flex items-center justify-center gap-2" aria-label="بەت تەرتىپى">
              {pageNo > 1 && (
                <Link href={`/search?${linkParams({ p: String(pageNo - 1) })}`} className="hbtn">
                  كەينىگە
                </Link>
              )}
              <span className="text-[13px] text-ink2">{pageNo}-بەت</span>
              {moreAvailable && (
                <Link href={`/search?${linkParams({ p: String(pageNo + 1) })}`} className="hbtn">
                  كېيىنكى
                </Link>
              )}
            </nav>
          )}
        </>
      )}
    </div>
  );
}
