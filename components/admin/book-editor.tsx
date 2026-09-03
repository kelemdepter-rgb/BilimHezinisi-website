"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icons";
import { deleteBooksAction, updateBookAction } from "@/app/admin/books/actions";
import { setBookPaths, storagePath, uploadToBucket } from "@/lib/books/save";
import type { Category } from "@/lib/types";

export type EditableBook = {
  id: number;
  title: string;
  author: string;
  category_id: number | null;
  date: string;
  description: string;
  language: string;
  status: string;
  page_count: number;
  format: string;
  cover_path: string | null;
  original_file_path: string | null;
};

export function BookEditor({
  book,
  categories,
  coverUrl,
}: {
  book: EditableBook;
  categories: Category[];
  coverUrl: string | null;
}) {
  const router = useRouter();
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState<string | null>(coverUrl);
  const previewUrlRef = useRef<string | null>(null);

  function save(formData: FormData) {
    startTransition(async () => {
      const result = await updateBookAction(formData);
      setNotice(
        result.ok
          ? { ok: true, text: result.message ?? "ساقلاندى." }
          : { ok: false, text: result.error ?? "مەشغۇلات مەغلۇپ بولدى." },
      );
      if (result.ok) router.refresh();
    });
  }

  /** Cover replacement uploads straight to Storage, never through a function. */
  async function replaceCover(file: File) {
    setUploading(true);
    setNotice(null);
    try {
      const path = await uploadToBucket("covers", storagePath(book.id, file.name, "cover"), file);
      await setBookPaths(book.id, { cover_path: path });
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
      const objectUrl = URL.createObjectURL(file);
      previewUrlRef.current = objectUrl;
      setPreview(objectUrl);
      setNotice({ ok: true, text: "مۇقاۋا يېڭىلاندى." });
      router.refresh();
    } catch (error) {
      setNotice({
        ok: false,
        text: error instanceof Error ? `مۇقاۋا يوللانمىدى: ${error.message}` : "مۇقاۋا يوللانمىدى.",
      });
    } finally {
      setUploading(false);
    }
  }

  function remove() {
    if (!window.confirm(`«${book.title}» ئۆچۈرۈلسۇنمۇ؟ بەتلىرى بىلەن قوشۇپ ئۆچىدۇ.`)) return;
    const formData = new FormData();
    formData.append("ids", String(book.id));
    startTransition(async () => {
      const result = await deleteBooksAction(formData);
      if (result.ok) router.push("/admin/books");
      else setNotice({ ok: false, text: result.error ?? "ئۆچۈرگىلى بولمىدى." });
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

      <div className="grid gap-5 lg:grid-cols-[1fr_260px]">
        <form action={save} className="paper grain space-y-4 p-5">
          <input type="hidden" name="id" value={book.id} />
          <label className="block">
            <span className="mb-1.5 block text-[13px] font-semibold text-ink2">ماۋزۇ *</span>
            <input autoComplete="off" className="field" name="title" defaultValue={book.title} required maxLength={200} />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-[13px] font-semibold text-ink2">ئاپتور</span>
            <input autoComplete="off" className="field" name="author" defaultValue={book.author} maxLength={120} />
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1.5 block text-[13px] font-semibold text-ink2">تۈر</span>
              <select className="field" name="category_id" defaultValue={book.category_id ?? ""}>
                <option value="">— تاللانمىدى —</option>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1.5 block text-[13px] font-semibold text-ink2">چېسلا</span>
              <input autoComplete="off" className="field" type="date" dir="ltr" name="date" defaultValue={book.date} />
            </label>
          </div>
          <label className="block">
            <span className="mb-1.5 block text-[13px] font-semibold text-ink2">چۈشەندۈرۈش</span>
            <textarea autoComplete="off" className="field min-h-24" name="description" rows={3} defaultValue={book.description} maxLength={2000} />
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1.5 block text-[13px] font-semibold text-ink2">تىل</span>
              <select className="field" name="language" defaultValue={book.language}>
                <option value="ug">ئۇيغۇرچە</option>
                <option value="ar">ئەرەبچە</option>
                <option value="zh">خەنزۇچە</option>
                <option value="en">ئىنگلىزچە</option>
                <option value="tr">تۈركچە</option>
              </select>
            </label>
            <label className="block">
              <span className="mb-1.5 block text-[13px] font-semibold text-ink2">ھالىتى</span>
              <select className="field" name="status" defaultValue={book.status} data-testid="edit-status">
                <option value="draft">قارالما</option>
                <option value="published">ئېلان قىلىنغان</option>
              </select>
            </label>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="submit" className="btn-am" disabled={pending}>
              <Icon name="save" />
              ساقلاش
            </button>
            <button type="button" className="hbtn" onClick={remove} disabled={pending}>
              <Icon name="trash" />
              كىتابنى ئۆچۈرۈش
            </button>
          </div>
        </form>

        <aside className="paper grain h-fit p-5">
          <h2 className="text-[14px] font-bold">مۇقاۋا</h2>
          <div className="mt-3 flex h-52 items-center justify-center overflow-hidden rounded-[var(--radius)] border border-bd bg-bg2">
            {preview ? (
              // Remote/blob cover: next/image cannot optimize these paths.
              // eslint-disable-next-line @next/next/no-img-element
              <img src={preview} alt="مۇقاۋا" className="h-full w-full object-cover" />
            ) : (
              <Icon name="book" className="ic-lg text-ink3" />
            )}
          </div>
          <label className="hbtn mt-3 w-full cursor-pointer">
            <Icon name="camera" />
            {uploading ? "يوللىنىۋاتىدۇ…" : "مۇقاۋا ئالماشتۇرۇش"}
            <input
              type="file"
              accept="image/*"
              className="sr-only"
              disabled={uploading}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void replaceCover(file);
              }}
            />
          </label>

          <dl className="mt-4 space-y-1.5 text-[12.5px] text-ink2">
            <div className="flex justify-between gap-2">
              <dt>فورمات</dt>
              <dd className="font-semibold">{book.format}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt>بەت سانى</dt>
              <dd className="font-semibold">{book.page_count}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt>ئەسلى ھۆججەت</dt>
              <dd className="font-semibold">{book.original_file_path ? "بار" : "يوق"}</dd>
            </div>
          </dl>
        </aside>
      </div>
    </div>
  );
}
