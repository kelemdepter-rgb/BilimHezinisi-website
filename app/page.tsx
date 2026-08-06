import { cookies } from "next/headers";
import { Icon } from "@/components/icons";
import { LibraryBrowser, VIEW_COOKIE } from "@/components/library/library-browser";
import { RecentStrip } from "@/components/library/recent-strip";
import { getCategories, getSessionInfo } from "@/lib/data";
import {
  LIBRARY_PAGE_SIZE,
  coverUrlMap,
  getRecentReads,
  listBooks,
  type BookSort,
} from "@/lib/library";

function parseSort(value: unknown): BookSort {
  return value === "title" || value === "author" ? value : "new";
}

export default async function HomePage({ searchParams }: PageProps<"/">) {
  const params = await searchParams;
  const categoryId = typeof params.cat === "string" && params.cat ? Number(params.cat) : null;
  const sort = parseSort(params.sort);

  const cookieStore = await cookies();
  const view = cookieStore.get(VIEW_COOKIE)?.value === "list" ? "list" : "grid";

  const [{ books, total }, categories, session, recent] = await Promise.all([
    listBooks({
      categoryId: Number.isFinite(categoryId) ? categoryId : null,
      sort,
      limit: LIBRARY_PAGE_SIZE,
      offset: 0,
    }),
    getCategories(),
    getSessionInfo(),
    getRecentReads(),
  ]);

  const covers = await coverUrlMap([...books, ...recent]);
  const withCovers = books.map((book) => ({
    ...book,
    coverUrl: book.cover_path ? (covers.get(book.cover_path) ?? null) : null,
  }));

  return (
    <div className="px-3 py-5 sm:px-6 sm:py-7 lg:px-8">
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
