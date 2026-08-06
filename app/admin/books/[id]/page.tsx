import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Icon } from "@/components/icons";
import { BookEditor, type EditableBook } from "@/components/admin/book-editor";
import { getCategories } from "@/lib/data";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "كىتابنى تەھرىرلەش" };

export default async function EditBookPage({ params }: PageProps<"/admin/books/[id]">) {
  const { id } = await params;
  const bookId = Number(id);
  if (!Number.isInteger(bookId) || bookId <= 0) notFound();

  const [categories, supabase] = await Promise.all([getCategories(), createSupabaseServerClient()]);
  if (!supabase) notFound();

  const { data } = await supabase
    .from("books")
    .select(
      "id, title, author, category_id, date, description, language, status, page_count, format, cover_path, original_file_path",
    )
    .eq("id", bookId)
    .maybeSingle();

  if (!data) notFound();
  const book = data as EditableBook;

  const coverUrl = book.cover_path
    ? supabase.storage.from("covers").getPublicUrl(book.cover_path).data.publicUrl
    : null;

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="flex min-w-0 items-center gap-2.5 text-xl font-bold">
          <Icon name="pencil" className="ic-lg shrink-0 text-am" />
          <span className="truncate">{book.title}</span>
        </h1>
        <Link href="/admin/books" className="hbtn">
          <Icon name="undo" />
          تىزىمغا قايتىش
        </Link>
      </div>

      <div className="mt-5">
        <BookEditor book={book} categories={categories} coverUrl={coverUrl} />
      </div>
    </>
  );
}
