"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icons";
import { chunkIntoPages } from "@/lib/books/chunk";
import { ExtractionError, extractFromFile, extractFromUrl, renderPdfCover } from "@/lib/books/extract";
import {
  createBookRow,
  deletePartialBook,
  findDuplicate,
  insertPages,
  setBookPaths,
  storagePath,
  uploadToBucket,
  type DuplicateHit,
} from "@/lib/books/save";
import type { BookStatus, ExtractedBook } from "@/lib/books/types";
import type { Category } from "@/lib/types";

const STEPS = ["مەنبە", "ئوقۇش", "بەتلەر", "ئۇچۇرلار", "مۇقاۋا", "ساقلاش"] as const;
type StepIndex = 0 | 1 | 2 | 3 | 4 | 5;

const ACCEPT = ".pdf,.txt,.docx,.doc,.md,.markdown,.html,.htm";

type QueueItem = {
  file: File;
  status: "pending" | "working" | "done" | "failed";
  error?: string;
  extracted?: ExtractedBook;
};

type Meta = {
  title: string;
  author: string;
  categoryId: string;
  date: string;
  description: string;
  language: string;
  status: BookStatus;
};

function flattenCategories(categories: Category[]): { category: Category; depth: number }[] {
  const byParent = new Map<number | null, Category[]>();
  for (const category of categories) {
    const list = byParent.get(category.parent_id) ?? [];
    list.push(category);
    byParent.set(category.parent_id, list);
  }
  for (const list of byParent.values()) {
    list.sort((a, b) => a.sort_order - b.sort_order || a.id - b.id);
  }
  const out: { category: Category; depth: number }[] = [];
  const walk = (parentId: number | null, depth: number) => {
    for (const category of byParent.get(parentId) ?? []) {
      out.push({ category, depth });
      walk(category.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

export function UploadWizard({ categories }: { categories: Category[] }) {
  const router = useRouter();
  const [step, setStep] = useState<StepIndex>(0);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [extractProgress, setExtractProgress] = useState(0);
  const [duplicate, setDuplicate] = useState<DuplicateHit | null>(null);
  const [pages, setPages] = useState<string[]>([]);
  const [meta, setMeta] = useState<Meta>({
    title: "",
    author: "",
    categoryId: "",
    date: "",
    description: "",
    language: "ug",
    status: "draft",
  });
  const [cover, setCoverState] = useState<{
    blob: Blob | null;
    fileName: string | null;
    url: string | null;
  }>({ blob: null, fileName: null, url: null });
  const coverUrlRef = useRef<string | null>(null);
  const [keepOriginal, setKeepOriginal] = useState(false);
  const [saveProgress, setSaveProgress] = useState<{ done: number; total: number } | null>(null);
  const [savedBookId, setSavedBookId] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const flatCategories = flattenCategories(categories);

  const current = queue[activeIndex];
  const extracted = current?.extracted;

  /** Owns the preview object URL so exactly one is alive at a time. */
  function setCover(next: Blob | File | null) {
    if (coverUrlRef.current) URL.revokeObjectURL(coverUrlRef.current);
    if (!next) {
      coverUrlRef.current = null;
      setCoverState({ blob: null, fileName: null, url: null });
      return;
    }
    const objectUrl = URL.createObjectURL(next);
    coverUrlRef.current = objectUrl;
    setCoverState({
      blob: next,
      fileName: next instanceof File ? next.name : "cover.jpg",
      url: objectUrl,
    });
  }

  useEffect(
    () => () => {
      if (coverUrlRef.current) URL.revokeObjectURL(coverUrlRef.current);
    },
    [],
  );

  function addFiles(files: FileList | File[]) {
    const items = Array.from(files).map((file) => ({ file, status: "pending" as const }));
    if (items.length === 0) return;
    setQueue((prev) => [...prev, ...items]);
    setError(null);
  }

  /** Step 1 → 2: extract the active file and check for a duplicate. */
  async function runExtraction(index: number) {
    const item = queue[index];
    if (!item) return;
    setBusy(true);
    setError(null);
    setExtractProgress(0);
    setDuplicate(null);
    setStep(1);
    try {
      const result = await extractFromFile(item.file, (fraction) =>
        setExtractProgress(Math.round(fraction * 100)),
      );
      if (result.scanned) {
        setQueue((prev) =>
          prev.map((q, i) => (i === index ? { ...q, status: "failed", error: "scanned" } : q)),
        );
        setError(
          "بۇ PDF سىكان قىلىنغان (تېكىست قەۋىتى يوق). ئالدى بىلەن كومپيۇتېر نۇسخىسىدا OCR قىلىڭ، ئاندىن قايتا يوللاڭ.",
        );
        setBusy(false);
        return;
      }
      // Duplicate check happens BEFORE anything is written.
      const hit = await findDuplicate(result.fileHash);
      setDuplicate(hit);
      setQueue((prev) =>
        prev.map((q, i) => (i === index ? { ...q, status: "done", extracted: result } : q)),
      );
      setMeta((prev) => ({
        ...prev,
        title: result.title,
        author: result.author,
        date: result.date,
      }));
      setPages(chunkIntoPages(result.text));
    } catch (caught) {
      const message =
        caught instanceof ExtractionError
          ? caught.message
          : "ھۆججەتنى ئوقۇغىلى بولمىدى. باشقا فورماتتا سىناپ كۆرۈڭ.";
      setQueue((prev) =>
        prev.map((q, i) => (i === index ? { ...q, status: "failed", error: message } : q)),
      );
      setError(message);
    } finally {
      setBusy(false);
    }
  }

  async function runUrlImport() {
    if (!url.trim()) return;
    setBusy(true);
    setError(null);
    setStep(1);
    try {
      const result = await extractFromUrl(url.trim());
      const hit = await findDuplicate(result.fileHash);
      setDuplicate(hit);
      setQueue([{ file: new File([], result.fileName), status: "done", extracted: result }]);
      setActiveIndex(0);
      setMeta((prev) => ({ ...prev, title: result.title, author: result.author, date: result.date }));
      setPages(chunkIntoPages(result.text));
    } catch (caught) {
      const message = caught instanceof ExtractionError ? caught.message : "تور بەتنى ئوقۇغىلى بولمىدى.";
      setError(message);
      setStep(0);
    } finally {
      setBusy(false);
    }
  }

  async function generateCoverFromPdf() {
    if (!current?.file || extracted?.format !== "PDF") return;
    setBusy(true);
    try {
      const blob = await renderPdfCover(current.file);
      if (blob) {
        setCover(blob);
      } else {
        setError("مۇقاۋا ياسىغىلى بولمىدى.");
      }
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (!extracted) return;
    setBusy(true);
    setError(null);
    let bookId: number | null = null;
    try {
      bookId = await createBookRow(
        {
          title: meta.title.trim() || extracted.title,
          author: meta.author.trim(),
          categoryId: meta.categoryId ? Number(meta.categoryId) : null,
          date: meta.date,
          description: meta.description.trim(),
          language: meta.language,
          status: meta.status,
        },
        { format: extracted.format, fileHash: extracted.fileHash, pageCount: pages.length },
      );

      setSaveProgress({ done: 0, total: pages.length });
      await insertPages(bookId, pages, (done, total) => setSaveProgress({ done, total }));

      const paths: { cover_path?: string | null; original_file_path?: string | null } = {};
      if (cover.blob) {
        paths.cover_path = await uploadToBucket(
          "covers",
          storagePath(bookId, cover.fileName ?? "cover.jpg", "cover"),
          cover.blob,
        );
      }
      if (keepOriginal && current?.file && current.file.size > 0) {
        paths.original_file_path = await uploadToBucket(
          "book-files",
          storagePath(bookId, current.file.name, "file"),
          current.file,
        );
      }
      if (Object.keys(paths).length > 0) await setBookPaths(bookId, paths);

      setSavedBookId(bookId);
      router.refresh();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? `ساقلاش مەغلۇپ بولدى: ${caught.message}`
          : "ساقلاش مەغلۇپ بولدى.",
      );
      // Leave the partial row in place so the admin can retry the page insert;
      // "بىكار قىلىش" removes it cleanly.
      if (bookId !== null) setSavedBookId(null);
    } finally {
      setBusy(false);
    }
  }

  async function cancelAndRollback() {
    if (savedBookId !== null) {
      setBusy(true);
      await deletePartialBook(savedBookId).catch(() => undefined);
      setBusy(false);
    }
    router.push("/admin/books");
  }

  const canLeaveSource = queue.length > 0;
  const canLeaveExtract = Boolean(extracted) && !busy;

  return (
    <div className="pb-28">
      <ol className="mb-5 flex flex-wrap gap-1.5" aria-label="باسقۇچلار">
        {STEPS.map((label, index) => (
          <li key={label}>
            <span
              data-testid={`wizard-step-${index}`}
              aria-current={index === step ? "step" : undefined}
              className={`inline-flex min-h-9 items-center gap-1.5 rounded-full px-3 text-[12.5px] font-semibold ${
                index === step
                  ? "bg-am text-at"
                  : index < step
                    ? "bg-ab text-ink"
                    : "border border-bd text-ink3"
              }`}
            >
              {index + 1}. {label}
            </span>
          </li>
        ))}
      </ol>

      {error && (
        <p role="alert" data-testid="wizard-error" className="mb-4 rounded-[var(--radius)] border border-bd2 bg-ab2 px-3.5 py-3 text-[13px] leading-6 text-ink">
          {error}
        </p>
      )}

      {step === 0 && (
        <SourceStep
          queue={queue}
          url={url}
          busy={busy}
          fileInputRef={fileInputRef}
          onAddFiles={addFiles}
          onUrlChange={setUrl}
          onUrlImport={runUrlImport}
          onRemove={(index) => setQueue((prev) => prev.filter((_, i) => i !== index))}
        />
      )}

      {step === 1 && (
        <ExtractStep
          item={current}
          progress={extractProgress}
          busy={busy}
          duplicate={duplicate}
          pageCount={pages.length}
        />
      )}

      {step === 2 && <ChunkStep pages={pages} />}

      {step === 3 && (
        <MetaStep meta={meta} setMeta={setMeta} categories={flatCategories} />
      )}

      {step === 4 && (
        <CoverStep
          isPdf={extracted?.format === "PDF"}
          busy={busy}
          preview={cover.url}
          keepOriginal={keepOriginal}
          hasOriginal={Boolean(current?.file && current.file.size > 0)}
          onPick={(file) => setCover(file)}
          onGenerate={generateCoverFromPdf}
          onClear={() => setCover(null)}
          onKeepOriginalChange={setKeepOriginal}
        />
      )}

      {step === 5 && (
        <SaveStep
          progress={saveProgress}
          savedBookId={savedBookId}
          pageCount={pages.length}
          busy={busy}
          onSave={save}
          onRetry={save}
        />
      )}

      {/* Sticky action bar. `pb-28` above reserves room so it never covers
          content, per the Mobile Rules. */}
      <div className="safe-bottom safe-x fixed inset-x-0 bottom-0 z-20 border-t border-bd bg-bg2/95 backdrop-blur">
        <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center justify-between gap-2 px-3 py-3 sm:px-6">
          <button
            type="button"
            className="hbtn"
            data-testid="wizard-cancel"
            onClick={cancelAndRollback}
            disabled={busy}
          >
            بىكار قىلىش
          </button>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="hbtn"
              data-testid="wizard-back"
              disabled={step === 0 || busy || savedBookId !== null}
              onClick={() => setStep((s) => Math.max(0, s - 1) as StepIndex)}
            >
              <Icon name="undo" />
              كەينىگە
            </button>
            {step < 5 ? (
              <button
                type="button"
                className="btn-am"
                data-testid="wizard-next"
                disabled={
                  busy ||
                  (step === 0 && !canLeaveSource) ||
                  (step === 1 && !canLeaveExtract) ||
                  (step === 2 && pages.length === 0) ||
                  (step === 3 && !meta.title.trim())
                }
                onClick={() => {
                  if (step === 0) {
                    void runExtraction(activeIndex);
                    return;
                  }
                  setStep((s) => Math.min(5, s + 1) as StepIndex);
                }}
              >
                كېيىنكى
                <Icon name="redo" />
              </button>
            ) : savedBookId !== null ? (
              <button
                type="button"
                className="btn-am"
                data-testid="wizard-finish"
                onClick={() => router.push("/admin/books")}
              >
                تامام
              </button>
            ) : (
              <button
                type="button"
                className="btn-am"
                data-testid="wizard-save"
                disabled={busy || pages.length === 0}
                onClick={save}
              >
                <Icon name="save" />
                ساقلاش
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function SourceStep({
  queue,
  url,
  busy,
  fileInputRef,
  onAddFiles,
  onUrlChange,
  onUrlImport,
  onRemove,
}: {
  queue: QueueItem[];
  url: string;
  busy: boolean;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  onAddFiles: (files: FileList | File[]) => void;
  onUrlChange: (value: string) => void;
  onUrlImport: () => void;
  onRemove: (index: number) => void;
}) {
  return (
    <section className="paper grain p-5">
      <h2 className="text-[16px] font-bold">كىتاب ھۆججىتىنى تاللاڭ</h2>
      <p className="mt-1.5 text-[13px] leading-6 text-ink3">
        PDF، TXT، DOCX، DOC، MD ياكى HTML. ھۆججەت كومپيۇتېرىڭىزدىلا ئوقۇلىدۇ — چوڭ
        ھۆججەتلەر سېرۋېرغا يوللانمايدۇ.
      </p>

      <div
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          if (event.dataTransfer.files.length) onAddFiles(event.dataTransfer.files);
        }}
        className="mt-4 rounded-[var(--radius-lg)] border-2 border-dashed border-bd2 p-6 text-center"
      >
        <Icon name="download" className="ic-lg mx-auto text-am" />
        <p className="mt-2 text-[13.5px] text-ink2">ھۆججەتنى بۇ يەرگە سۆرەپ تاشلاڭ</p>
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPT}
          multiple
          className="sr-only"
          data-testid="wizard-file-input"
          onChange={(event) => {
            if (event.target.files) onAddFiles(event.target.files);
          }}
        />
        <button
          type="button"
          className="btn-am mt-3"
          disabled={busy}
          onClick={() => fileInputRef.current?.click()}
        >
          <Icon name="folder" />
          ھۆججەت تاللاش
        </button>
      </div>

      {queue.length > 0 && (
        <ul className="mt-4 space-y-2" data-testid="wizard-queue">
          {queue.map((item, index) => (
            <li key={`${item.file.name}-${index}`} className="flex items-center gap-2 rounded-[var(--radius)] bg-bg2 px-3 py-2">
              <Icon name="file-text" className="text-am" />
              <span className="min-w-0 flex-1 truncate text-[13.5px]">{item.file.name}</span>
              <span className="text-[12px] text-ink3">
                {item.file.size > 0 ? `${Math.round(item.file.size / 1024)} KB` : ""}
              </span>
              <button type="button" className="ibtn" aria-label="تىزىمدىن چىقىرىش" onClick={() => onRemove(index)}>
                <Icon name="x" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-6 border-t border-bd pt-5">
        <h3 className="text-[14px] font-bold">ياكى تور بەتتىن ئەكىرىش</h3>
        <div className="mt-2 flex flex-wrap gap-2">
          <input
            className="field min-w-48 flex-1"
            type="url"
            dir="ltr"
            placeholder="https://example.com/article"
            value={url}
            onChange={(event) => onUrlChange(event.target.value)}
          />
          <button type="button" className="hbtn" disabled={busy || !url.trim()} onClick={onUrlImport}>
            <Icon name="globe" />
            ئەكىرىش
          </button>
        </div>
      </div>
    </section>
  );
}

function ExtractStep({
  item,
  progress,
  busy,
  duplicate,
  pageCount,
}: {
  item?: QueueItem;
  progress: number;
  busy: boolean;
  duplicate: DuplicateHit | null;
  pageCount: number;
}) {
  return (
    <section className="paper grain p-5">
      <h2 className="text-[16px] font-bold">ھۆججەت ئوقۇلىۋاتىدۇ</h2>
      <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-bg3">
        <div className="h-full bg-am transition-[width]" style={{ width: `${busy ? progress : 100}%` }} />
      </div>
      <p className="mt-2 text-[13px] text-ink2">
        {busy ? `${progress}% ئوقۇلدى` : item?.extracted ? "ئوقۇش تامام ✓" : "…"}
      </p>

      {item?.extracted && (
        <dl className="mt-4 grid gap-2 text-[13.5px] sm:grid-cols-2">
          <Row label="ھۆججەت" value={item.extracted.fileName} />
          <Row label="فورمات" value={item.extracted.format} />
          <Row label="ھەرپ سانى" value={String(item.extracted.text.length)} />
          <Row label="بەت سانى (تەخمىنى)" value={String(pageCount)} />
        </dl>
      )}

      {duplicate && (
        <p
          role="alert"
          data-testid="wizard-duplicate"
          className="mt-4 rounded-[var(--radius)] border border-bd2 bg-ab2 px-3.5 py-3 text-[13px] leading-6 text-ink"
        >
          ⚠ بۇ كىتاب ئاللىبۇرۇن بار: «{duplicate.title}». داۋاملاشتۇرسىڭىز تەكرار بولۇپ
          قالىدۇ — ساقلاش مەغلۇپ بولۇشى مۇمكىن.
        </p>
      )}
    </section>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2 rounded-[var(--radius)] bg-bg2 px-3 py-2">
      <dt className="text-ink3">{label}:</dt>
      <dd className="min-w-0 flex-1 truncate font-semibold">{value}</dd>
    </div>
  );
}

function ChunkStep({ pages }: { pages: string[] }) {
  return (
    <section className="paper grain p-5">
      <h2 className="text-[16px] font-bold">بەتلەرگە بۆلۈندى</h2>
      <p className="mt-1.5 text-[13.5px] text-ink2">
        جەمئىي <strong>{pages.length}</strong> بەت. ھەر بەت پاراگراف چېگرىسىدىن بۆلۈنگەن.
      </p>
      {pages[0] && (
        <div className="mt-4">
          <h3 className="text-[13px] font-semibold text-ink3">بىرىنچى بەتنىڭ بېشى</h3>
          <p className="mt-1.5 max-h-56 overflow-y-auto overscroll-contain whitespace-pre-wrap rounded-[var(--radius)] bg-bg2 p-3 text-[13.5px] leading-7">
            {pages[0].slice(0, 600)}
            {pages[0].length > 600 ? "…" : ""}
          </p>
        </div>
      )}
    </section>
  );
}

function MetaStep({
  meta,
  setMeta,
  categories,
}: {
  meta: Meta;
  setMeta: React.Dispatch<React.SetStateAction<Meta>>;
  categories: { category: Category; depth: number }[];
}) {
  const update = (patch: Partial<Meta>) => setMeta((prev) => ({ ...prev, ...patch }));
  return (
    <section className="paper grain space-y-4 p-5">
      <h2 className="text-[16px] font-bold">كىتاب ئۇچۇرلىرى</h2>
      <label className="block">
        <span className="mb-1.5 block text-[13px] font-semibold text-ink2">ماۋزۇ *</span>
        <input
          className="field"
          data-testid="meta-title"
          value={meta.title}
          onChange={(event) => update({ title: event.target.value })}
          required
          maxLength={200}
        />
      </label>
      <label className="block">
        <span className="mb-1.5 block text-[13px] font-semibold text-ink2">ئاپتور</span>
        <input className="field" value={meta.author} onChange={(event) => update({ author: event.target.value })} maxLength={120} />
      </label>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1.5 block text-[13px] font-semibold text-ink2">تۈر</span>
          <select
            className="field"
            data-testid="meta-category"
            value={meta.categoryId}
            onChange={(event) => update({ categoryId: event.target.value })}
          >
            <option value="">— تاللانمىدى —</option>
            {categories.map(({ category, depth }) => (
              <option key={category.id} value={category.id}>
                {"— ".repeat(depth)}
                {category.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1.5 block text-[13px] font-semibold text-ink2">چېسلا</span>
          <input className="field" type="date" dir="ltr" value={meta.date} onChange={(event) => update({ date: event.target.value })} />
        </label>
      </div>
      <label className="block">
        <span className="mb-1.5 block text-[13px] font-semibold text-ink2">قىسقىچە چۈشەندۈرۈش</span>
        <textarea
          className="field min-h-24"
          rows={3}
          value={meta.description}
          onChange={(event) => update({ description: event.target.value })}
          maxLength={2000}
        />
      </label>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1.5 block text-[13px] font-semibold text-ink2">تىل</span>
          <select className="field" value={meta.language} onChange={(event) => update({ language: event.target.value })}>
            <option value="ug">ئۇيغۇرچە</option>
            <option value="ar">ئەرەبچە</option>
            <option value="zh">خەنزۇچە</option>
            <option value="en">ئىنگلىزچە</option>
            <option value="tr">تۈركچە</option>
          </select>
        </label>
        <label className="block">
          <span className="mb-1.5 block text-[13px] font-semibold text-ink2">ھالىتى</span>
          <select
            className="field"
            data-testid="meta-status"
            value={meta.status}
            onChange={(event) => update({ status: event.target.value as BookStatus })}
          >
            <option value="draft">قارالما (كۆرۈنمەيدۇ)</option>
            <option value="published">ئېلان قىلىنغان (ھەممەيلەن كۆرىدۇ)</option>
          </select>
        </label>
      </div>
    </section>
  );
}

function CoverStep({
  isPdf,
  busy,
  preview,
  keepOriginal,
  hasOriginal,
  onPick,
  onGenerate,
  onClear,
  onKeepOriginalChange,
}: {
  isPdf: boolean;
  busy: boolean;
  preview: string | null;
  keepOriginal: boolean;
  hasOriginal: boolean;
  onPick: (file: File) => void;
  onGenerate: () => void;
  onClear: () => void;
  onKeepOriginalChange: (value: boolean) => void;
}) {
  return (
    <section className="paper grain p-5">
      <h2 className="text-[16px] font-bold">مۇقاۋا ۋە ئەسلى ھۆججەت</h2>
      <p className="mt-1.5 text-[13px] text-ink3">مۇقاۋا مەجبۇرىي ئەمەس.</p>

      <div className="mt-4 flex flex-wrap items-start gap-4">
        <div className="flex h-40 w-28 shrink-0 items-center justify-center overflow-hidden rounded-[var(--radius)] border border-bd bg-bg2">
          {preview ? (
            // Blob preview: next/image cannot optimize object URLs.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={preview} alt="مۇقاۋا كۆرۈنۈشى" className="h-full w-full object-cover" />
          ) : (
            <Icon name="book" className="ic-lg text-ink3" />
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <label className="hbtn cursor-pointer">
            <Icon name="camera" />
            رەسىم تاللاش
            <input
              type="file"
              accept="image/*"
              className="sr-only"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) onPick(file);
              }}
            />
          </label>
          {isPdf && (
            <button type="button" className="hbtn" disabled={busy} onClick={onGenerate}>
              <Icon name="sparkles" />
              PDF نىڭ بىرىنچى بېتىدىن ياساش
            </button>
          )}
          {preview && (
            <button type="button" className="hbtn" onClick={onClear}>
              <Icon name="x" />
              ئۆچۈرۈش
            </button>
          )}
        </div>
      </div>

      {hasOriginal && (
        <label className="mt-6 flex min-h-11 items-center gap-2.5 border-t border-bd pt-4 text-[13.5px]">
          <input
            type="checkbox"
            className="h-5 w-5 accent-[var(--am)]"
            checked={keepOriginal}
            onChange={(event) => onKeepOriginalChange(event.target.checked)}
          />
          ئەسلى ھۆججەتنى ساقلاش
          <span className="text-ink3">(ساقلاش بوشلۇقى ئىشلىتىدۇ)</span>
        </label>
      )}
    </section>
  );
}

function SaveStep({
  progress,
  savedBookId,
  pageCount,
  busy,
  onSave,
  onRetry,
}: {
  progress: { done: number; total: number } | null;
  savedBookId: number | null;
  pageCount: number;
  busy: boolean;
  onSave: () => void;
  onRetry: () => void;
}) {
  const percent = progress && progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;
  return (
    <section className="paper grain p-5">
      <h2 className="text-[16px] font-bold">ساقلاش</h2>
      {savedBookId !== null ? (
        <p role="status" data-testid="wizard-saved" className="mt-3 rounded-[var(--radius)] bg-ab px-3.5 py-3 text-[13.5px] leading-7">
          ✓ كىتاب ساقلاندى ({pageCount} بەت). «تامام» نى بېسىپ كىتابلار تىزىمىگە قايتىڭ.
        </p>
      ) : (
        <>
          <p className="mt-1.5 text-[13.5px] text-ink2">
            {pageCount} بەت ساقلىنىدۇ. بەتلەر توپ-توپ بولۇپ يوللىنىدۇ.
          </p>
          {progress && (
            <>
              <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-bg3">
                <div className="h-full bg-am transition-[width]" style={{ width: `${percent}%` }} />
              </div>
              <p className="mt-2 text-[13px] text-ink2">
                {progress.done} / {progress.total} بەت
              </p>
            </>
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" className="btn-am" disabled={busy} onClick={onSave}>
              <Icon name="save" />
              ھازىر ساقلاش
            </button>
            {progress && progress.done < progress.total && !busy && (
              <button type="button" className="hbtn" onClick={onRetry}>
                <Icon name="refresh" />
                قايتا سىناش
              </button>
            )}
          </div>
        </>
      )}
    </section>
  );
}
