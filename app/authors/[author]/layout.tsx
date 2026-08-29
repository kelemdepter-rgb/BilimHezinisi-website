import { notFound } from "next/navigation";
import { authorHasBooks } from "@/lib/authors";

/**
 * A guessed author URL has to be a 404, not an empty shelf pretending to be
 * one — and after loading.tsx flushes its skeleton the status line has
 * already been sent, so the question has to be asked in front of the
 * boundary. A layout is the last place that can.
 */
export default async function AuthorLayout({ children, params }: LayoutProps<"/authors/[author]">) {
  const { author } = await params;
  if (!(await authorHasBooks(decodeURIComponent(author)))) notFound();
  return children;
}
