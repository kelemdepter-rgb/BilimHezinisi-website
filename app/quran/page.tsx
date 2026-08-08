import type { Metadata } from "next";
import Link from "next/link";
import { Icon } from "@/components/icons";
import { AyaSnippet } from "@/components/quran/aya-snippet";
import { SuraList } from "@/components/quran/sura-list";
import { getSuras, runQuranSearch } from "@/lib/quran/data";
import { toArabicNumerals } from "@/lib/quran/format";

export const metadata: Metadata = {
  title: "قۇرئان كەرىم",
  description:
    "قۇرئان كەرىمنىڭ ئوسمانىي خەت نۇسخىسى ۋە مۇھەممەد سالىھ ئۇيغۇرچە تەرجىمىسى — سۈرە بويىچە ئوقۇش ۋە ئىزدەش.",
};

const PAGE_SIZE = 20;

export default async function QuranPage({ searchParams }: PageProps<"/quran">) {
  const params = await searchParams;
  const query = typeof params.q === "string" ? params.q.trim() : "";
  const pageNo = Math.max(1, Number(params.p ?? 1) || 1);

  const [suras, search] = await Promise.all([
    getSuras(),
    runQuranSearch({ query, limit: PAGE_SIZE, offset: (pageNo - 1) * PAGE_SIZE }),
  ]);

  const pageHref = (next: number) =>
    `/quran?q=${encodeURIComponent(query)}${next > 1 ? `&p=${next}` : ""}`;

  return (
    <div className="px-3 py-5 sm:px-6 sm:py-7 lg:px-8">
      <h1 className="flex items-center gap-2.5 text-xl font-bold">
        <Icon name="mosque" className="ic-lg text-am" />
        قۇرئان كەرىم
      </h1>
      <p className="mt-2 text-[13px] leading-7 text-ink2">
        ئوسمانىي (ھەفس) ئەرەبچە مەتنى ۋە مۇھەممەد سالىھنىڭ ئۇيغۇرچە تەرجىمىسى.
      </p>

      <form className="mt-4 flex flex-wrap gap-2" role="search" action="/quran">
        <input
          className="field min-w-48 flex-1"
          type="search"
          name="q"
          defaultValue={query}
          placeholder="ئەرەبچە ئايەت ياكى ئۇيغۇرچە تەرجىمە بويىچە ئىزدەش…"
          aria-label="قۇرئاندىن ئىزدەش"
          data-testid="quran-search-input"
        />
        <button type="submit" className="btn-am" data-testid="quran-search-submit">
          <Icon name="search" />
          ئىزدەش
        </button>
      </form>

      <p className="mt-2.5 text-[12.5px] leading-6 text-ink3">
        ئىبارىنى پۈتۈن پېتى ئىزدەش ئۈچۈن قوش تىرناققا ئېلىڭ · ئىككى سۆزنىڭ بىرى ئۈچۈن{" "}
        <span dir="ltr">OR</span> · بىر سۆزنى چىقىرىۋېتىش ئۈچۈن ئالدىغا <span dir="ltr">-</span>{" "}
        قويۇڭ. ھەرىكەت (زەبەر ـ زەر) قويۇلغان ياكى قويۇلمىغان ھالەتتە ئوخشاش تېپىلىدۇ.
      </p>

      {query && (
        <section className="mt-6" aria-labelledby="quran-results-heading">
          <h2 id="quran-results-heading" className="text-[15px] font-bold">
            ئىزدەش نەتىجىسى
          </h2>

          {search.failed ? (
            <p role="alert" className="mt-3 rounded-[var(--radius)] border border-bd2 bg-ab2 px-3.5 py-3 text-[13px]">
              ئىزدەشتە خاتالىق كۆرۈلدى. سەل تۇرۇپ قايتا سىناڭ.
            </p>
          ) : search.hits.length === 0 ? (
            <p className="paper mt-3 p-6 text-center text-[13.5px] leading-7 text-ink2" data-testid="quran-search-empty">
              «{query}» بويىچە ئايەت تېپىلمىدى. باشقا سۆز بىلەن سىناپ كۆرۈڭ.
            </p>
          ) : (
            <>
              <p className="mt-2 text-[13px] text-ink3" data-testid="quran-search-meta">
                بۇ بەتتە {search.hits.length} ئايەت · {(search.elapsedMs / 1000).toFixed(2)} سېكۇنت
              </p>
              <ul className="mt-3 space-y-2" data-testid="quran-search-results">
                {search.hits.map((hit) => (
                  <li key={`${hit.sura}-${hit.aya}`}>
                    <Link
                      href={`/quran/${hit.sura}?aya=${hit.aya}`}
                      data-testid="quran-search-result"
                      data-sura={hit.sura}
                      data-aya={hit.aya}
                      className="paper block p-3.5 hover:shadow-[var(--shadow-2)]"
                    >
                      <span className="flex flex-wrap items-baseline gap-x-2 text-[12.5px] font-bold text-am">
                        <span className="quran-face text-[15px]">{hit.sura_name_ar}</span>
                        <span>{hit.sura_name_ug}</span>
                        <span className="text-ink3">
                          {toArabicNumerals(hit.aya)}-ئايەت
                        </span>
                      </span>
                      <span className="quran-face mt-1.5 block text-[19px] leading-9 text-ink">
                        <AyaSnippet snippet={hit.snippet_ar} />
                      </span>
                      {hit.snippet_ug && (
                        <span className="mt-1 block text-[13.5px] leading-7 text-ink2">
                          <AyaSnippet snippet={hit.snippet_ug} />
                        </span>
                      )}
                    </Link>
                  </li>
                ))}
              </ul>

              {(pageNo > 1 || search.moreAvailable) && (
                <nav className="mt-5 flex items-center justify-center gap-2" aria-label="بەت تەرتىپى">
                  {pageNo > 1 && (
                    <Link href={pageHref(pageNo - 1)} className="hbtn">
                      كەينىگە
                    </Link>
                  )}
                  <span className="text-[13px] text-ink2">{toArabicNumerals(pageNo)}-بەت</span>
                  {search.moreAvailable && (
                    <Link href={pageHref(pageNo + 1)} className="hbtn">
                      كېيىنكى
                    </Link>
                  )}
                </nav>
              )}
            </>
          )}
        </section>
      )}

      <section className="mt-7" aria-labelledby="sura-list-heading">
        <h2 id="sura-list-heading" className="mb-3 text-[15px] font-bold">
          بارلىق سۈرىلەر
        </h2>
        {suras.length === 0 ? (
          <p className="paper p-6 text-center text-[13.5px] leading-7 text-ink2" data-testid="quran-empty">
            قۇرئان مەلۇماتى تېخى قوشۇلمىغان.
          </p>
        ) : (
          <SuraList suras={suras} />
        )}
      </section>
    </div>
  );
}
