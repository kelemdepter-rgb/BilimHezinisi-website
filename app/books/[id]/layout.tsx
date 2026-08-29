import { notFound } from "next/navigation";
import { getSessionInfo } from "@/lib/data";
import { publishedBookExists } from "@/lib/library";

/**
 * Does this book exist? Asked here, and not only in the page, because of
 * where a loading boundary sits.
 *
 * `loading.tsx` wraps the page and everything below it, but NOT the layout in
 * its own segment. Once that boundary has flushed the skeleton, the response
 * has already gone out with its status line on it, and a notFound() in the
 * page can no longer make it a 404 — the reader still sees the right page,
 * but a crawler is told 200 for a book that is not there. The check belongs
 * in front of the boundary, which is here.
 *
 * publishedBookExists and not the full lookup: this runs before the skeleton
 * can flush, so it has to be quick. It is a counted head request out of the
 * shared cache and answers in about a millisecond; doing the same job with
 * getBookDetail blocked the boundary long enough that the book page lost its
 * loading state altogether.
 *
 * A draft is invisible to that sessionless check, so a staff member is let
 * through to the page, which resolves it against their own session — the same
 * answer as before, from the same place. Covers /read too, which needs the
 * book to exist for the same reason.
 */
export default async function BookLayout({ children, params }: LayoutProps<"/books/[id]">) {
  const { id } = await params;
  const bookId = Number(id);
  if (!Number.isInteger(bookId) || bookId <= 0) notFound();
  if (await publishedBookExists(bookId)) return children;
  // Not published. Either it does not exist, or it is a draft — and only
  // staff may be shown a draft, so only staff go any further.
  const session = await getSessionInfo();
  if (!session || session.role === "reader") notFound();
  return children;
}
