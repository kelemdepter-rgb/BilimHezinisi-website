"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icons";
import { chunkIntoPages } from "@/lib/books/chunk";
import {
  ACCEPT_ATTRIBUTE,
  ExtractionError,
  assertAcceptedFile,
  extractFromFile,
  extractFromUrl,
} from "@/lib/books/extract";
import { MarkdownContent } from "@/components/reader/markdown-content";
import {
  countStoredPages,
  createBookRow,
  failedPageIndex,
  findDuplicate,
  insertPages,
  setBookPaths,
  setBookStatus,
  storagePath,
  uploadToBucket,
  type DuplicateHit,
} from "@/lib/books/save";
import type { BookStatus, ExtractedBook } from "@/lib/books/types";
import { flattenCategories } from "@/lib/categories";
import { MSG, bookSaveFailureMessage, type ActionResult } from "@/lib/admin/messages";
import type { Category } from "@/lib/types";
import { deleteBooksAction, revalidateLibraryAction } from "@/app/admin/books/actions";

const STEPS = ["مەنبە", "ئوقۇش", "بەتلەر", "ئۇچۇرلار", "مۇقاۋا", "ساقلاش"] as const;
type StepIndex = 0 | 1 | 2 | 3 | 4 | 5;

const ACCEPT = ACCEPT_ATTRIBUTE;

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

/**
 * How far a save got before it stopped, kept from the moment the book row
 * exists. «قايتا سىناش» carries on from here — the same row, the first page
 * not yet confirmed written, and which Storage objects are already recorded
 * on the row — instead of creating a second book, which the unique index on
 * `file_hash` would refuse anyway. «بىكار قىلىش» removes the row it names.
 */
type Checkpoint = {
  bookId: number;
  nextPageIndex: number;
  coverDone: boolean;
  originalDone: boolean;
};

/** A failure whose message was written for the admin and is shown as it is. */
class SaveFailure extends Error {}

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
  const [checkpoint, setCheckpoint] = useState<Checkpoint | null>(null);
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
    const accepted: QueueItem[] = [];
    let rejection: string | null = null;
    // Reject unsupported files (notably PDF) before anything is parsed, so a
    // drag-drop or renamed file cannot slip past the picker's accept filter.
    for (const file of Array.from(files)) {
      try {
        assertAcceptedFile(file);
        accepted.push({ file, status: "pending" });
      } catch (caught) {
        rejection = caught instanceof ExtractionError ? caught.message : "بۇ ھۆججەت قوللانمايدۇ.";
      }
    }
    setError(rejection);
    if (accepted.length > 0) setQueue((prev) => [...prev, ...accepted]);
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

  /**
   * Draft → pages → cover and original → verify → the status the admin chose.
   *
   * The same order as the batch importer, for the same reason: a book is
   * published only after its pages have been counted back out of the
   * database, so a connection that drops halfway through can leave a draft
   * behind but never a published book with pages missing. Called for the
   * first attempt and for every «قايتا سىناش» alike — a retry picks up at the
   * checkpoint the failed attempt left, inside the same row.
   */
  async function save() {
    if (!extracted) return;
    setBusy(true);
    setError(null);
    let bookId = checkpoint?.bookId ?? null;
    let nextPageIndex = checkpoint?.nextPageIndex ?? 0;
    let coverDone = checkpoint?.coverDone ?? false;
    let originalDone = checkpoint?.originalDone ?? false;
    try {
      if (bookId === null) {
        bookId = await createBookRow(
          {
            title: meta.title.trim() || extracted.title,
            author: meta.author.trim(),
            categoryId: meta.categoryId ? Number(meta.categoryId) : null,
            date: meta.date,
            description: meta.description.trim(),
            language: meta.language,
            // Always a draft first, whatever the admin chose. Their choice is
            // applied at the end, once every page is known to be there.
            status: "draft",
          },
          {
            format: extracted.format,
            fileHash: extracted.fileHash,
            pageCount: pages.length,
            contentFormat: extracted.contentFormat,
          },
        );
        // Remembered the moment it exists, so a failure anywhere below can be
        // retried into it or cancelled out of it.
        setCheckpoint({ bookId, nextPageIndex, coverDone, originalDone });
      }

      setSaveProgress({ done: nextPageIndex, total: pages.length });
      await insertPages(
        bookId,
        pages,
        (done, total) => {
          nextPageIndex = done;
          setSaveProgress({ done, total });
        },
        nextPageIndex,
      );

      // Each object is recorded on the row as soon as it is uploaded, so
      // «بىكار قىلىش» — which reads the row — finds and removes it.
      if (cover.blob && !coverDone) {
        const coverPath = await uploadToBucket(
          "covers",
          storagePath(bookId, cover.fileName ?? "cover.jpg", "cover"),
          cover.blob,
        );
        await setBookPaths(bookId, { cover_path: coverPath });
        coverDone = true;
      }
      if (keepOriginal && current?.file && current.file.size > 0 && !originalDone) {
        const originalPath = await uploadToBucket(
          "book-files",
          storagePath(bookId, current.file.name, "file"),
          current.file,
        );
        await setBookPaths(bookId, { original_file_path: originalPath });
        originalDone = true;
      }

      const stored = await countStoredPages(bookId);
      if (stored !== pages.length) {
        // A batch was acknowledged but did not all land. The retry writes
        // every page again — upserts, so nothing is doubled — and the book
        // stays a draft until the count agrees.
        nextPageIndex = 0;
        throw new SaveFailure(MSG.pageCountMismatch(stored, pages.length));
      }
      if (meta.status === "published") await setBookStatus(bookId, "published");

      setCheckpoint(null);
      setSavedBookId(bookId);
      // The book was written from this browser, so no Server Action has run and
      // nothing has told the cached library that it exists. Without this the
      // owner publishes a book and does not find it on the home page.
      await revalidateLibraryAction().catch(() => undefined);
      router.refresh();
    } catch (caught) {
      const failedAt = failedPageIndex(caught);
      if (failedAt !== null) nextPageIndex = failedAt;
      if (bookId !== null) setCheckpoint({ bookId, nextPageIndex, coverDone, originalDone });
      setError(caught instanceof SaveFailure ? caught.message : bookSaveFailureMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  /**
   * Leave the wizard. A book that was begun and not finished goes with it —
   * through the Server Action, so the role is re-checked on the server, the
   * row's Storage objects are removed with it and the cached library is
   * dropped. Offered only until the save succeeds: removing a saved book is
   * what /admin/books is for.
   */
  async function cancel() {
    if (checkpoint) {
      setBusy(true);
      const form = new FormData();
      form.append("ids", String(checkpoint.bookId));
      const result = await deleteBooksAction(form).catch(
        (): ActionResult => ({ ok: false, error: MSG.unknown }),
      );
      setBusy(false);
      if (!result.ok) {
        // The partial book is still there; say so rather than leave it behind.
        setError(result.error);
        return;
      }
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

      {step === 2 && (
        <ChunkStep pages={pages} isMarkdown={extracted?.contentFormat === "markdown"} />
      )}

      {step === 3 && (
        <MetaStep meta={meta} setMeta={setMeta} categories={flatCategories} />
      )}

      {step === 4 && (
        <CoverStep
          preview={cover.url}
          keepOriginal={keepOriginal}
          hasOriginal={Boolean(current?.file && current.file.size > 0)}
          onPick={(file) => setCover(file)}
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
          canRetry={checkpoint !== null}
          onSave={save}
          onRetry={save}
        />
      )}

      {/* Sticky action bar. `pb-28` above reserves room so it never covers
          content, per the Mobile Rules. */}
      <div className="safe-bottom safe-x fixed inset-x-0 bottom-0 z-20 border-t border-bd bg-bg2/95 backdrop-blur">
        <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center justify-between gap-2 px-3 py-3 sm:px-6">
          {/* Gone once the book is saved: the only thing left to do is finish,
              and nothing in this bar may delete a saved book. */}
          {savedBookId === null && (
            <button
              type="button"
              className="hbtn"
              data-testid="wizard-cancel"
              onClick={cancel}
              disabled={busy}
            >
              بىكار قىلىش
            </button>
          )}
          <div className="ms-auto flex items-center gap-2">
            <button
              type="button"
              className="hbtn"
              data-testid="wizard-back"
              // Once the row exists the earlier steps describe a book that is
              // already written; the way back is «بىكار قىلىش».
              disabled={step === 0 || busy || checkpoint !== null || savedBookId !== null}
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
        DOCX، DOC، MD، HTML ياكى TXT. ھۆججەت كومپيۇتېرىڭىزدىلا ئوقۇلىدۇ — چوڭ
        ھۆججەتلەر سېرۋېرغا يوللانمايدۇ.
      </p>
      <p className="mt-1.5 text-[12.5px] leading-6 text-ink3">
        <strong>DOCX</strong> تەۋسىيە قىلىنىدۇ — ماۋزۇ، توم خەت، تىزىم ۋە جەدۋەللەر
        ساقلىنىپ قالىدۇ. كونا <strong>.doc</strong> بولسا Word دا ئېچىپ .docx قىلىپ
        ساقلىسىڭىز فورماتلاش يوقالمايدۇ.
      </p>
      <p className="mt-1.5 text-[12.5px] leading-6 text-ink3">
        PDF قوبۇل قىلىنمايدۇ — ئۇنى كومپيۇتېردىكى «بىلىم خەزىنىسى» دېتالىدا ئېچىپ
        DOCX قىلىپ ساقلاڭ، ئاندىن شۇنى يوللاڭ.
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
            autoComplete="off"
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

function ChunkStep({ pages, isMarkdown }: { pages: string[]; isMarkdown: boolean }) {
  const [showRaw, setShowRaw] = useState(false);
  return (
    <section className="paper grain p-5">
      <h2 className="text-[16px] font-bold">بەتلەرگە بۆلۈندى</h2>
      <p className="mt-1.5 text-[13.5px] text-ink2">
        جەمئىي <strong>{pages.length}</strong> بەت. ھەر بەت پاراگراف چېگرىسىدىن بۆلۈنگەن.
        {isMarkdown ? " فورماتلاش (ماۋزۇ، توم خەت، تىزىم، جەدۋەل) ساقلاندى." : ""}
      </p>

      {pages[0] && (
        <div className="mt-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-[13px] font-semibold text-ink3">
              بىرىنچى بەت — {showRaw ? "ئەسلى مەنبە" : "ئوقۇرمەنلەر كۆرىدىغان شەكلى"}
            </h3>
            {isMarkdown && (
              <button
                type="button"
                className="hbtn"
                data-testid="preview-toggle"
                onClick={() => setShowRaw((raw) => !raw)}
              >
                <Icon name="file-text" />
                {showRaw ? "كۆرۈنۈشنى كۆرۈش" : "ئەسلى مەنبەنى كۆرۈش"}
              </button>
            )}
          </div>
          <div
            data-testid="chunk-preview"
            className="mt-2 max-h-72 overflow-y-auto overscroll-contain rounded-[var(--radius)] bg-bg2 p-3 text-[13.5px] leading-7"
          >
            {isMarkdown && !showRaw ? (
              <MarkdownContent source={pages[0]} />
            ) : (
              <p className="whitespace-pre-wrap">{pages[0].slice(0, 900)}{pages[0].length > 900 ? "…" : ""}</p>
            )}
          </div>
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
          autoComplete="off"
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
        <input autoComplete="off" className="field" value={meta.author} onChange={(event) => update({ author: event.target.value })} maxLength={120} />
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
          <input autoComplete="off" className="field" type="date" dir="ltr" value={meta.date} onChange={(event) => update({ date: event.target.value })} />
        </label>
      </div>
      <label className="block">
        <span className="mb-1.5 block text-[13px] font-semibold text-ink2">قىسقىچە چۈشەندۈرۈش</span>
        <textarea
          autoComplete="off"
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
  preview,
  keepOriginal,
  hasOriginal,
  onPick,
  onClear,
  onKeepOriginalChange,
}: {
  preview: string | null;
  keepOriginal: boolean;
  hasOriginal: boolean;
  onPick: (file: File) => void;
  onClear: () => void;
  onKeepOriginalChange: (value: boolean) => void;
}) {
  return (
    <section className="paper grain p-5">
      <h2 className="text-[16px] font-bold">مۇقاۋا ۋە ئەسلى ھۆججەت</h2>
      <p className="mt-1.5 text-[13px] text-ink3">
        مۇقاۋا مەجبۇرىي ئەمەس — قويمىسىڭىز ماۋزۇ يېزىلغان قەغەز شەكلىدىكى مۇقاۋا
        ئۆزلۈكىدىن ياسىلىدۇ.
      </p>

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
              data-testid="cover-input"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) onPick(file);
              }}
            />
          </label>
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
  canRetry,
  onSave,
  onRetry,
}: {
  progress: { done: number; total: number } | null;
  savedBookId: number | null;
  pageCount: number;
  busy: boolean;
  /** A save was begun and did not finish; a retry carries on inside it. */
  canRetry: boolean;
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
            <button
              type="button"
              className="btn-am"
              data-testid="save-now"
              disabled={busy}
              onClick={onSave}
            >
              <Icon name="save" />
              ھازىر ساقلاش
            </button>
            {canRetry && !busy && (
              <button type="button" className="hbtn" data-testid="save-retry" onClick={onRetry}>
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
