import type { Metadata } from "next";
import Link from "next/link";
import { Icon } from "@/components/icons";
import { BookResults, type BookGroup } from "@/components/search/book-results";
import { getCategories } from "@/lib/data";
import { runBookSearch, type SearchHit } from "@/lib/search/books";

/**
 * Results arrive one page-hit per row. A book that mentions the word forty
 * times would fill the whole screen and still hide the other thirty-seven, so
 * they are gathered under their book — best-ranked book first, which the RPC's
 * order already gives.
 */
function groupByBook(hits: SearchHit[]): BookGroup[] {
  const groups = new Map<number, BookGroup>();
  for (const hit of hits) {
    const group = groups.get(hit.book_id) ?? {
      bookId: hit.book_id,
      title: hit.title,
      author: hit.author,
      hits: [],
    };
    group.hits.push(hit);
    groups.set(hit.book_id, group);
  }
  return [...groups.values()];
}

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
/**
 * Anonymous visitors control `p`, and a deep OFFSET makes Postgres walk every
 * row before it. The ceiling also matches what search_books actually ranks —
 * 300 candidate pages (migration 0014) — so paging cannot run past the end of
 * the ranked set into empty pages.
 */
const MAX_PAGE = 15;
/** A pathological query string costs tokenizing time; nothing useful is this long. */
const MAX_QUERY_CHARS = 200;

export default async function SearchPage({ searchParams }: PageProps<"/search">) {
  const params = await searchParams;
  const query = typeof params.q === "string" ? params.q.trim().slice(0, MAX_QUERY_CHARS) : "";
  const categoryId = typeof params.cat === "string" && params.cat ? Number(params.cat) : null;
  const pageNo = Math.min(MAX_PAGE, Math.max(1, Number(params.p ?? 1) || 1));
  const offset = (pageNo - 1) * PAGE_SIZE;

  const categories = await getCategories();

  const { hits, elapsedMs, failed, moreAvailable, tooCommon } = await runBookSearch({
    query,
    categoryId: categoryId && Number.isFinite(categoryId) ? categoryId : null,
    limit: PAGE_SIZE,
    offset,
  });

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
        سۆزنىڭ بېشىنى يازسىڭىزمۇ تېپىلىدۇ — «ناماز» دېسىڭىز «نامازغا»، «نامازنى»مۇ چىقىدۇ.
        كۆپ سۆز يازسىڭىز، دەل شۇ ئىبارە قاتار كەلگەن يەرلەر تېپىلىدۇ.
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
          {/* The word matched more pages than the database ranks. Results are
              still shown — they are simply the best of an early slice, not of
              everything — and the reader is told how to narrow it. */}
          {tooCommon && (
            <p
              className="mt-4 flex items-start gap-2 rounded-[var(--radius)] bg-ab px-3.5 py-3 text-[13px] leading-7"
              data-testid="search-too-common"
            >
              <Icon name="info" className="mt-1 shrink-0 text-am" />
              <span>
                «{query}» بەك كۆپ بەتتە بار. تۆۋەندىكىسى دەسلەپكى نەتىجىلەر — تېخىمۇ ئېنىق
                تېپىش ئۈچۈن يەنە بىر سۆز قوشۇڭ.
              </span>
            </p>
          )}

          <p className="mt-4 text-[13px] text-ink3" data-testid="search-meta">
            بۇ بەتتە {hits.length} نەتىجە · {(elapsedMs / 1000).toFixed(2)} سېكۇنت
          </p>

          {/* The query goes through untouched: it is one literal phrase, and
              the matcher that highlights it is the same one the reader uses. */}
          <BookResults groups={groupByBook(hits)} term={query} />

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
