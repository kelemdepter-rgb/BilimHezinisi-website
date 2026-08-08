"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icons";
import { deleteMyAnnotationAction } from "@/app/my/actions";
import { toArabicNumerals } from "@/lib/quran/format";

export type MyQuranBookmark = {
  id: number;
  sura: number;
  aya: number;
  suraNameAr: string;
  suraNameUg: string;
  createdAt: string;
};

export function QuranBookmarkList({ items }: { items: MyQuranBookmark[] }) {
  const router = useRouter();
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function remove(id: number) {
    const formData = new FormData();
    formData.set("kind", "quran-bookmark");
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
      <ul className="space-y-2" data-testid="quran-bookmark-list">
        {items.map((item) => (
          <li key={item.id} className="paper flex items-center gap-2 p-3">
            <Link
              href={`/quran/${item.sura}?aya=${item.aya}`}
              className="min-w-0 flex-1"
              data-testid="quran-bookmark-jump"
            >
              <span className="flex flex-wrap items-baseline gap-x-2">
                <span className="quran-face text-[16px] text-ink">{item.suraNameAr}</span>
                <span className="text-[13.5px] text-ink2">{item.suraNameUg}</span>
                <span className="text-[12px] font-semibold text-am">
                  {toArabicNumerals(item.aya)}-ئايەت
                </span>
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
    </div>
  );
}
