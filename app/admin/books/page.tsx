import type { Metadata } from "next";
import Link from "next/link";
import { Icon } from "@/components/icons";
import { BookTable, type BookRow } from "@/components/admin/book-table";
import { getCategories } from "@/lib/data";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "كىتابلار" };

const PAGE_SIZE = 20;

export default async function AdminBooksPage({ searchParams }: PageProps<"/admin/books">) {
  const params = await searchParams;
  const query = typeof params.q === "string" ? params.q.trim() : "";
  const pageNo = Math.max(1, Number(params.p ?? 1) || 1);
  const from = (pageNo - 1) * PAGE_SIZE;

  const [categories, supabase] = await Promise.all([getCategories(), createSupabaseServerClient()]);

  let books: BookRow[] = [];
  let total = 0;
  if (supabase) {
    let request = supabase
      .from("books")
      .select("id, title, author, status, page_count, date, category_id", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(from, from + PAGE_SIZE - 1);
    if (query) request = request.or(`title.ilike.%${query}%,author.ilike.%${query}%`);
    const { data, count } = await request;
    books = (data as BookRow[] | null) ?? [];
    total = count ?? 0;
  }

  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="flex items-center gap-2.5 text-xl font-bold">
          <Icon name="book" className="ic-lg text-am" />
          كىتابلار
        </h1>
        <div className="flex flex-wrap gap-2">
          <Link href="/admin/books/batch" className="hbtn" data-testid="batch-import-link">
            <Icon name="layers" />
            توپلاپ قوشۇش
          </Link>
          <Link href="/admin/books/new" className="btn-am">
            <Icon name="plus" />
            يېڭى كىتاب
          </Link>
        </div>
      </div>

      <form className="mt-4 flex flex-wrap gap-2" role="search" autoComplete="off">
        <input
          autoComplete="off"
          className="field min-w-48 flex-1"
          type="search"
          name="q"
          defaultValue={query}
          placeholder="ماۋزۇ ياكى ئاپتور بويىچە ئىزدەش…"
          aria-label="كىتاب ئىزدەش"
        />
        <button type="submit" className="hbtn">
          <Icon name="search" />
          ئىزدەش
        </button>
      </form>

      <p className="mt-3 text-[13px] text-ink3">جەمئىي {total} كىتاب</p>

      <div className="mt-4">
        <BookTable books={books} categories={categories} />
      </div>

      {lastPage > 1 && (
        <nav className="mt-5 flex items-center justify-center gap-2" aria-label="بەت تەرتىپى">
          {pageNo > 1 && (
            <Link href={`/admin/books?${new URLSearchParams({ ...(query ? { q: query } : {}), p: String(pageNo - 1) })}`} className="hbtn">
              كەينىگە
            </Link>
          )}
          <span className="text-[13px] text-ink2">
            {pageNo} / {lastPage}
          </span>
          {pageNo < lastPage && (
            <Link href={`/admin/books?${new URLSearchParams({ ...(query ? { q: query } : {}), p: String(pageNo + 1) })}`} className="hbtn">
              كېيىنكى
            </Link>
          )}
        </nav>
      )}
    </>
  );
}
