import type { Metadata } from "next";
import Link from "next/link";
import { Icon } from "@/components/icons";
import { SearchField } from "@/components/search/search-field";
import { AyaText } from "@/components/quran/aya-text";
import { QuranSourceNote } from "@/components/quran/source-note";
import { SuraList } from "@/components/quran/sura-list";
import { getSuras, quranCards, runQuranSearch, type QuranSearchOutcome } from "@/lib/quran/data";
import { toArabicNumerals } from "@/lib/quran/format";
import { SEARCH_BUSY_TEXT } from "@/lib/search/busy";
import { SEARCH_RULE, callerKey, isRateLimited } from "@/lib/rate-limit";

/** What an address past SEARCH_RULE gets, without a database call. */
const BUSY_OUTCOME: QuranSearchOutcome = {
  hits: [],
  elapsedMs: 0,
  failed: true,
  busy: true,
  moreAvailable: false,
};

export const metadata: Metadata = {
  title: "قۇرئان كەرىم",
  description:
    "قۇرئان كەرىمنىڭ ئوسمانىي خەت نۇسخىسى ۋە مۇھەممەد سالىھ ئۇيغۇرچە تەرجىمىسى — سۈرە بويىچە ئوقۇش ۋە ئىزدەش.",
  alternates: { canonical: "/quran" },
  openGraph: {
    title: "قۇرئان كەرىم",
    description: "ئوسمانىي خەت نۇسخىسى ۋە ئۇيغۇرچە تەرجىمىسى بىلەن، ھېساباتسىز.",
    url: "/quran",
  },
};

const PAGE_SIZE = 20;
/** Same reasoning as the book search: `p` and `q` come from the visitor. */
const MAX_PAGE = 50;
const MAX_QUERY_CHARS = 200;

export default async function QuranPage({ searchParams }: PageProps<"/quran">) {
  const params = await searchParams;
  const query = typeof params.q === "string" ? params.q.trim().slice(0, MAX_QUERY_CHARS) : "";
  const pageNo = Math.min(MAX_PAGE, Math.max(1, Number(params.p ?? 1) || 1));

  // The library search's allowance, in a bucket of its own: an address past it
  // is told "busy" without the database being asked (PROMPT-40).
  const limited = query !== "" && isRateLimited(`quran-search:${await callerKey()}`, SEARCH_RULE);
  const [suras, search] = await Promise.all([
    getSuras(),
    limited
      ? Promise.resolve(BUSY_OUTCOME)
      : runQuranSearch({ query, limit: PAGE_SIZE, offset: (pageNo - 1) * PAGE_SIZE }),
  ]);

  // One card per translation group: a group found three times shows its
  // translation once, with its label, and each found verse's Arabic.
  const cards = search.hits.length > 0 ? await quranCards(search.hits) : [];

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

      <form className="mt-4 flex flex-wrap gap-2" role="search" action="/quran" autoComplete="off">
        {/* No history here: the Qur'an is a different corpus from the
            library, and mixing the two lists would offer a reader a search
            that finds nothing where they are standing. */}
        <SearchField
          defaultValue={query}
          placeholder="ئەرەبچە ئايەت ياكى ئۇيغۇرچە تەرجىمە بويىچە ئىزدەش…"
          ariaLabel="قۇرئاندىن ئىزدەش"
          testId="quran-search-input"
          history={false}
        />
        <button type="submit" className="btn-am" data-testid="quran-search-submit">
          <Icon name="search" />
          ئىزدەش
        </button>
      </form>

      <p className="mt-2.5 text-[12.5px] leading-6 text-ink3">
        سۆزنىڭ بېشىنى يازسىڭىزمۇ تېپىلىدۇ · كۆپ سۆز يازسىڭىز، ھەممىسى بار ئايەتلەر تېپىلىدۇ ·
        ھەرىكەت (زەبەر ـ زەر) قويۇلغان ياكى قويۇلمىغان ھالەتتە ئوخشاش تېپىلىدۇ.
      </p>

      {query && (
        <section className="mt-6" aria-labelledby="quran-results-heading">
          <h2 id="quran-results-heading" className="text-[15px] font-bold">
            ئىزدەش نەتىجىسى
          </h2>

          {search.busy ? (
            /* Every Qur'an search slot in use, or this address past its
               allowance: a calm note and the same search again. */
            <div role="status" className="paper mt-3 p-5 text-center sm:p-6" data-testid="quran-search-busy">
              <Icon name="info" className="ic-lg mx-auto text-am" />
              <p className="mx-auto mt-3 max-w-md text-[14px] leading-7 text-ink2">{SEARCH_BUSY_TEXT}</p>
              <Link
                href={pageHref(pageNo)}
                prefetch={false}
                className="btn-am mt-4"
                data-testid="quran-search-busy-retry"
              >
                <Icon name="redo" />
                قايتا سىناش
              </Link>
            </div>
          ) : search.failed ? (
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
                بۇ بەتتە {cards.length} نەتىجە · {(search.elapsedMs / 1000).toFixed(2)} سېكۇنت
              </p>
              <ul className="mt-3 space-y-2" data-testid="quran-search-results">
                {cards.map((card) => (
                  <li key={`${card.sura}-${card.from}`}>
                    <Link
                      href={`/quran/${card.sura}?aya=${card.verses[0].aya}`}
                      data-testid="quran-search-result"
                      data-sura={card.sura}
                      data-aya={card.verses[0].aya}
                      data-group={card.to > card.from ? `${card.from}-${card.to}` : undefined}
                      className="paper block p-3.5 hover:shadow-[var(--shadow-2)]"
                    >
                      <span className="flex flex-wrap items-baseline gap-x-2 text-[12.5px] font-bold text-am">
                        <span className="quran-face text-[15px]">{card.sura_name_ar}</span>
                        <span>{card.sura_name_ug}</span>
                        <span className="text-ink3">
                          {card.verses.map((verse) => toArabicNumerals(verse.aya)).join("، ")}-ئايەت
                        </span>
                      </span>
                      {/* The full Uthmani verse, tashkil and all — each verse
                          of the group that matched, in order. */}
                      {card.verses.map((verse) => (
                        <span
                          key={verse.aya}
                          className="quran-face mt-1.5 block text-[21px] leading-[2.1] text-ink"
                          data-testid="quran-hit-arabic"
                        >
                          <AyaText text={verse.text_ar} query={query} />
                          {card.verses.length > 1 && <> {toArabicNumerals(verse.aya)}</>}
                        </span>
                      ))}
                      {card.text_ug && (
                        <span className="mt-1 block text-[13.5px] leading-7 text-ink2" data-testid="quran-hit-uyghur">
                          <AyaText text={card.text_ug} query={query} />{" "}
                          <span className="quran-aya-label">{card.label}</span>
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

      <QuranSourceNote className="mt-8" />
    </div>
  );
}
