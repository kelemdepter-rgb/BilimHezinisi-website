import { notFound } from "next/navigation";
import { getBookDetail } from "@/lib/library";

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
 * It costs nothing: getBookDetail is deduplicated per request, so this and
 * the page's own lookup are one query. Covers the reader at /read too, which
 * needs the same answer.
 */
export default async function BookLayout({ children, params }: LayoutProps<"/books/[id]">) {
  const { id } = await params;
  const bookId = Number(id);
  if (!Number.isInteger(bookId) || bookId <= 0) notFound();
  if (!(await getBookDetail(bookId))) notFound();
  return children;
}
