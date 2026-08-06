"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icons";
import {
  bulkMoveCategoryAction,
  bulkStatusAction,
  deleteBooksAction,
} from "@/app/admin/books/actions";
import type { Category } from "@/lib/types";

export type BookRow = {
  id: number;
  title: string;
  author: string;
  status: string;
  page_count: number;
  date: string;
  category_id: number | null;
};

export function BookTable({
  books,
  categories,
}: {
  books: BookRow[];
  categories: Category[];
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const categoryName = (id: number | null) =>
    categories.find((c) => c.id === id)?.name ?? "—";

  function toggle(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function run(action: (fd: FormData) => Promise<{ ok: boolean; error?: string; message?: string }>, extra?: Record<string, string>) {
    if (selected.size === 0) return;
    const formData = new FormData();
    for (const id of selected) formData.append("ids", String(id));
    for (const [key, value] of Object.entries(extra ?? {})) formData.set(key, value);
    startTransition(async () => {
      const result = await action(formData);
      if (result.ok) {
        setNotice({ ok: true, text: result.message ?? "ساقلاندى." });
        setSelected(new Set());
        router.refresh();
      } else {
        setNotice({ ok: false, text: result.error ?? "مەشغۇلات مەغلۇپ بولدى." });
      }
    });
  }

  return (
    <div>
      {notice && (
        <p
          role={notice.ok ? "status" : "alert"}
          className={`mb-4 rounded-[var(--radius)] px-3.5 py-3 text-[13px] leading-6 ${
            notice.ok ? "bg-ab text-ink" : "border border-bd2 bg-ab2 text-ink"
          }`}
        >
          {notice.text}
        </p>
      )}

      {selected.size > 0 && (
        <div
          data-testid="bulk-bar"
          className="paper mb-4 flex flex-wrap items-center gap-2 p-3"
        >
          <span className="text-[13px] font-semibold">{selected.size} تاللاندى</span>
          <button type="button" className="hbtn" disabled={pending} onClick={() => run(bulkStatusAction, { status: "published" })}>
            <Icon name="globe" />
            ئېلان قىلىش
          </button>
          <button type="button" className="hbtn" disabled={pending} onClick={() => run(bulkStatusAction, { status: "draft" })}>
            <Icon name="eraser" />
            قارالما قىلىش
          </button>
          <select
            className="field w-auto"
            aria-label="تۈرگە يۆتكەش"
            disabled={pending}
            defaultValue=""
            onChange={(event) => {
              if (!event.target.value) return;
              run(bulkMoveCategoryAction, { category_id: event.target.value === "none" ? "" : event.target.value });
              event.target.value = "";
            }}
          >
            <option value="">تۈرگە يۆتكەش…</option>
            <option value="none">— تۈرسىز —</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="hbtn"
            disabled={pending}
            onClick={() => {
              if (window.confirm(`${selected.size} كىتاب ئۆچۈرۈلسۇنمۇ؟ بۇنى قايتۇرغىلى بولمايدۇ.`)) {
                run(deleteBooksAction);
              }
            }}
          >
            <Icon name="trash" />
            ئۆچۈرۈش
          </button>
        </div>
      )}

      <ul className="space-y-2" data-testid="book-list">
        {books.map((book) => (
          <li key={book.id} className="paper flex flex-wrap items-center gap-3 p-3">
            <input
              type="checkbox"
              className="h-5 w-5 shrink-0 accent-[var(--am)]"
              aria-label={`${book.title} — تاللاش`}
              checked={selected.has(book.id)}
              onChange={() => toggle(book.id)}
            />
            <div className="min-w-40 flex-1">
              <p className="truncate text-[14.5px] font-bold">{book.title}</p>
              <p className="mt-0.5 truncate text-[12.5px] text-ink3">
                {book.author || "ئاپتور يوق"} · {categoryName(book.category_id)} · {book.page_count} بەت
                {book.date ? ` · ${book.date}` : ""}
              </p>
            </div>
            <span
              className={`rounded-full px-2.5 py-1 text-[12px] font-semibold ${
                book.status === "published" ? "bg-am text-at" : "bg-bg3 text-ink2"
              }`}
            >
              {book.status === "published" ? "ئېلان قىلىنغان" : "قارالما"}
            </span>
            <Link href={`/admin/books/${book.id}`} className="hbtn">
              <Icon name="pencil" />
              تەھرىر
            </Link>
          </li>
        ))}
      </ul>

      {books.length === 0 && (
        <p className="paper p-6 text-center text-[13.5px] text-ink2">
          كىتاب تېپىلمىدى.
        </p>
      )}
    </div>
  );
}
