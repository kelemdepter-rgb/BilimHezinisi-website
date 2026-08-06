"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icons";
import { deleteMyAnnotationAction } from "@/app/my/actions";

export type MyAnnotation = {
  id: number;
  bookId: number;
  bookTitle: string;
  pageNo: number;
  text: string;
  createdAt: string;
};

export function AnnotationList({
  groups,
  kind,
}: {
  groups: { bookId: number; bookTitle: string; items: MyAnnotation[] }[];
  kind: "bookmark" | "note";
}) {
  const router = useRouter();
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function remove(id: number) {
    const formData = new FormData();
    formData.set("kind", kind);
    formData.set("id", String(id));
    startTransition(async () => {
      const result = await deleteMyAnnotationAction(formData);
      setNotice(result.ok ? (result.message ?? "ئۆچۈرۈلدى.") : result.error);
      router.refresh();
    });
  }

  return (
    <div>
      {notice && (
        <p role="status" className="mb-4 rounded-[var(--radius)] bg-ab px-3.5 py-3 text-[13px]">
          {notice}
        </p>
      )}

      <div className="space-y-6">
        {groups.map((group) => (
          <section key={group.bookId}>
            <h2 className="mb-2 flex items-center gap-2 text-[15px] font-bold">
              <Icon name="book" className="text-am" />
              <Link href={`/books/${group.bookId}`} className="hover:underline">
                {group.bookTitle}
              </Link>
              <span className="text-[12px] font-normal text-ink3">({group.items.length})</span>
            </h2>
            <ul className="space-y-2">
              {group.items.map((item) => (
                <li key={item.id} className="paper flex items-start gap-2 p-3">
                  <Link
                    href={`/books/${item.bookId}/read?page=${item.pageNo}`}
                    className="min-w-0 flex-1"
                    data-testid="annotation-jump"
                  >
                    <span className="block text-[12px] font-semibold text-am">
                      {item.pageNo}-بەت
                    </span>
                    <span className="mt-0.5 block whitespace-pre-wrap text-[13.5px] leading-7">
                      {item.text}
                    </span>
                  </Link>
                  <button
                    type="button"
                    className="ibtn shrink-0"
                    aria-label="ئۆچۈرۈش"
                    disabled={pending}
                    onClick={() => remove(item.id)}
                  >
                    <Icon name="trash" />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
