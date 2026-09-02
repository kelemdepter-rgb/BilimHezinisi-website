import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { Icon } from "@/components/icons";
import { LibraryBrowser } from "@/components/library/library-browser";
import { BookStrip } from "@/components/library/book-strip";
import { RecentStrip } from "@/components/library/recent-strip";
import { getCategories, getSessionInfo } from "@/lib/data";
import { coverUrlMap, getRecentReads, listBooks, listNewBooks } from "@/lib/library";
import { LIBRARY_PAGE_SIZE, VIEW_COOKIE, type BookSort } from "@/lib/library-types";
import { SITE_DESCRIPTION, SITE_NAME, absoluteUrl, jsonLd } from "@/lib/seo";
import { timed } from "@/lib/perf/timing";

/** Enough to be worth a look, few enough to stay one screen. */
const NEW_STRIP_SIZE = 12;

function parseSort(value: unknown): BookSort {
  return value === "title" || value === "author" ? value : "new";
}

/**
 * A category view is the same page with ?cat=, so it needs its own title and
 * its own canonical — otherwise every category competes with the home page
 * for the same URL.
 */
export async function generateMetadata({ searchParams }: PageProps<"/">): Promise<Metadata> {
  const params = await searchParams;
  const categoryId = typeof params.cat === "string" && params.cat ? Number(params.cat) : null;
  if (!categoryId || !Number.isFinite(categoryId)) return { alternates: { canonical: "/" } };

  const category = (await getCategories()).find((item) => item.id === categoryId);
  if (!category) return { alternates: { canonical: "/" } };

  const description = `«${category.name}» تۈرىدىكى ئۇيغۇرچە كىتابلار — ${SITE_NAME}دىن ھېساباتسىز ئوقۇڭ.`;
  return {
    title: category.name,
    description,
    alternates: { canonical: `/?cat=${category.id}` },
    openGraph: { title: category.name, description, url: `/?cat=${category.id}` },
  };
}

export default async function HomePage({ searchParams }: PageProps<"/">) {
  const params = await searchParams;
  const categoryId = typeof params.cat === "string" && params.cat ? Number(params.cat) : null;
  const sort = parseSort(params.sort);

  const cookieStore = await cookies();
  const view = cookieStore.get(VIEW_COOKIE)?.value === "list" ? "list" : "grid";
  // Inline <script>, so the CSP nonce the proxy minted has to travel with it.
  const nonce = (await headers()).get("x-nonce") ?? undefined;

  const [{ books, total }, categories, session, recent, newest] = await timed("page.queries", () => Promise.all([
    listBooks({
      categoryId: Number.isFinite(categoryId) ? categoryId : null,
      sort,
      limit: LIBRARY_PAGE_SIZE,
      offset: 0,
    }),
    getCategories(),
    getSessionInfo(),
    getRecentReads(),
    // Only on the unfiltered home page: inside a category, "new" would mean
    // something the strip is not showing.
    categoryId ? Promise.resolve({ books: [], total: 0 }) : listNewBooks({ limit: NEW_STRIP_SIZE }),
  ] as const));

  const covers = await timed("page.covers", () => coverUrlMap([...books, ...recent, ...newest.books]));
  const withCovers = books.map((book) => ({
    ...book,
    coverUrl: book.cover_path ? (covers.get(book.cover_path) ?? null) : null,
  }));

  return (
    <div className="px-3 py-5 sm:px-6 sm:py-7 lg:px-8">
      {/* Tells search engines what this site is and how to search it, so a
          result can offer the library's own search box. */}
      {!categoryId && (
        <script
          nonce={nonce}
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: jsonLd({
              "@context": "https://schema.org",
              "@type": "WebSite",
              name: SITE_NAME,
              url: absoluteUrl("/"),
              description: SITE_DESCRIPTION,
              inLanguage: "ug",
              potentialAction: {
                "@type": "SearchAction",
                target: {
                  "@type": "EntryPoint",
                  urlTemplate: absoluteUrl("/search?q={search_term_string}"),
                },
                "query-input": "required name=search_term_string",
              },
            }),
          }}
        />
      )}

      {/* Confirmation for someone who just deleted their account: they are
          signed out, so this is the only page left to say it on. */}
      {params.uqtur === "account_deleted" && (
        <p
          role="status"
          data-testid="account-deleted"
          className="mb-5 rounded-[var(--radius)] bg-ab px-3.5 py-3 text-[13px] leading-6 text-ink"
        >
          ھېساباتىڭىز ۋە ئۇنىڭغا باغلانغان بارلىق ئۇچۇرلار ئۆچۈرۈلدى. كىتاب ئوقۇشنى
          ھېساباتسىزمۇ داۋاملاشتۇرالايسىز.
        </p>
      )}

      {!session && total === 0 && (
        <section className="paper grain relative mb-6 overflow-hidden p-6 sm:p-8">
          <div className="absolute inset-x-0 top-0 h-1 bg-[linear-gradient(90deg,var(--gold),var(--am),var(--gold))]" />
          <p className="flex items-center gap-2 text-[13px] font-semibold text-am">
            <Icon name="sparkles" />
            ئۇيغۇرچە رەقەملىك كۇتۇپخانا
          </p>
          <h1 className="mt-2 text-2xl font-bold leading-relaxed">بىلىم خەزىنىسىگە خۇش كەپسىز</h1>
          <p className="mt-3 max-w-2xl text-[15px] leading-8 text-ink2">
            ھېسابات ئاچمىسىڭىزمۇ بارلىق ئېلان قىلىنغان كىتابلارنى ئەركىن ئوقۇيالايسىز ۋە
            ئىزدىيەلەيسىز.
          </p>
        </section>
      )}

      {/* Recent reads are personal — nothing renders for anonymous visitors. */}
      <RecentStrip books={recent} covers={covers} />

      {/* One sideways row, not a grid: on a 375 px phone a grid of new books
          would push the library's own controls off the screen, and the point
          of this page is the library. */}
      <BookStrip
        testId="new-strip"
        heading="بۇ ئايدىكى يېڭى كىتابلار"
        icon="sparkles"
        books={newest.books}
        covers={covers}
        hrefFor={(book) => `/books/${book.id}`}
        moreHref="/new"
        /* The library grows every week, and a first-time visitor has no way to
           know that from a page of covers. It says so and nothing more: the
           new books are in the row directly below it. */
        note="يېڭى كىتابلار قوشۇلۇۋاتىدۇ، زىيارەت قىلىپ تۇرۇڭ…"
      />

      <LibraryBrowser
        initialBooks={withCovers}
        total={total}
        categories={categories}
        categoryId={Number.isFinite(categoryId) ? categoryId : null}
        sort={sort}
        initialView={view}
      />
    </div>
  );
}
