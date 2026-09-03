"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/icons";
import { chunkIntoPages } from "@/lib/books/chunk";
import {
  ACCEPT_ATTRIBUTE,
  ExtractionError,
  assertAcceptedFile,
  extractFromFile,
} from "@/lib/books/extract";
import {
  countStoredPages,
  createBookRow,
  deletePartialBook,
  findDuplicate,
  insertPages,
  setBookStatus,
} from "@/lib/books/save";
import {
  batchSize,
  importableRows,
  readyToImport,
  rowKey,
  projectBudget,
  sortRows,
  suggestMetadata,
  utf8Bytes,
  type BatchMeta,
  type BatchRow,
  type BatchSort,
  type Budget,
} from "@/lib/books/batch";
import { clearBatchMeta, forgetBatchRows, loadBatchMeta, saveBatchMeta } from "@/lib/books/batch-store";
import { todayIso } from "@/lib/books/metadata";
import { categoryOptionLabel, flattenCategories } from "@/lib/categories";
import {
  getImportHeadroomAction,
  findIncompleteBooksAction,
  type ImportHeadroom,
  type IncompleteBook,
} from "@/app/admin/books/batch/actions";
import { deleteBooksAction, revalidateLibraryAction } from "@/app/admin/books/actions";
import type { BookStatus } from "@/lib/books/types";
import type { Category } from "@/lib/types";

/**
 * Importing a folder of books, each with its own details.
 *
 * The desktop's batch import gives every book in a folder one category and
 * takes each title from its filename. That is not enough for this library: the
 * books that share a folder do not share a title, and some are ready to
 * publish while others are not. So this is three stages on one screen —
 * choose, review, import — with the review stage carrying the weight.
 *
 * WHAT THE LAYOUT IS. One editable card per file, whose fields fall into
 * aligned columns from `lg` up (so twenty books scan like a table) and stack on
 * a phone. One markup tree rather than a table and a card list side by side:
 * two trees would drift, and the phone is not the second-class case here.
 *
 * WHAT NEVER HAPPENS. Nothing is written until the admin says so; extraction
 * runs one file at a time in this browser (Vercel's 4.5 MB body limit and short
 * timeouts make server-side parsing wrong); every book is created as a draft,
 * its pages counted back out of the database, and only then given the status
 * that was chosen for it. A tab closed mid-run can leave a draft short of its
 * pages — never a published book missing half its text — and the panel at the
 * bottom finds and removes exactly those.
 */

const STAGES = ["ھۆججەت تاللاش", "تەكشۈرۈش ۋە تەھرىرلەش", "ئەكىرىش"] as const;

const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

/** Files from a drop, following folders where the browser allows it. */
async function filesFromDrop(dataTransfer: DataTransfer): Promise<File[]> {
  // Read the entries synchronously: a DataTransfer is emptied the moment the
  // event handler yields, so anything awaited first would find nothing.
  const entries = Array.from(dataTransfer.items ?? [])
    .map((item) => (typeof item.webkitGetAsEntry === "function" ? item.webkitGetAsEntry() : null))
    .filter((entry): entry is FileSystemEntry => entry !== null);

  if (entries.length === 0) return Array.from(dataTransfer.files);

  const out: File[] = [];
  const walk = async (entry: FileSystemEntry, depth: number): Promise<void> => {
    if (depth > 4) return;
    if (entry.isFile) {
      const file = await new Promise<File | null>((resolve) =>
        (entry as FileSystemFileEntry).file(
          (value) => resolve(value),
          () => resolve(null),
        ),
      );
      if (file) out.push(file);
      return;
    }
    if (!entry.isDirectory) return;
    const reader = (entry as FileSystemDirectoryEntry).createReader();
    for (;;) {
      const batch = await new Promise<FileSystemEntry[]>((resolve) =>
        reader.readEntries(
          (results) => resolve(results),
          () => resolve([]),
        ),
      );
      if (batch.length === 0) break;
      for (const child of batch) await walk(child, depth + 1);
    }
  };

  for (const entry of entries) await walk(entry, 0);
  return out;
}

type Rejected = { fileName: string; reason: string };

export function BatchImport({ categories }: { categories: Category[] }) {
  const flatCategories = useMemo(() => flattenCategories(categories), [categories]);

  const [stage, setStage] = useState<0 | 1 | 2>(0);
  const [rows, setRows] = useState<BatchRow[]>([]);
  const [rejected, setRejected] = useState<Rejected[]>([]);
  const [reading, setReading] = useState<{ fileName: string; done: number; total: number } | null>(
    null,
  );
  const [sort, setSort] = useState<BatchSort>("picked");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [headroom, setHeadroom] = useState<ImportHeadroom | null>(null);
  const [confirmedOverBudget, setConfirmedOverBudget] = useState(false);
  const [progress, setProgress] = useState<{ fileName: string; done: number; total: number } | null>(
    null,
  );
  const [growth, setGrowth] = useState<{ estimated: number; actual: number } | null>(null);
  const [savedCount, setSavedCount] = useState(0);
  const [incomplete, setIncomplete] = useState<IncompleteBook[] | null>(null);

  /** The picked files, out of React state — a File is not worth re-rendering. */
  const filesRef = useRef(new Map<string, File>());
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const bulkCategoryRef = useRef<HTMLSelectElement>(null);
  const bulkAuthorRef = useRef<HTMLInputElement>(null);
  const bulkStatusRef = useRef<HTMLSelectElement>(null);

  useEffect(() => {
    void loadBatchMeta().then((saved) => setSavedCount(Object.keys(saved).length));
  }, []);

  useEffect(
    () => () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    },
    [],
  );

  /** Persist what has been typed, shortly after it stops changing. */
  const persist = useCallback((next: BatchRow[]) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      void saveBatchMeta(next.map((row) => ({ id: row.id, meta: row.meta })));
    }, 600);
  }, []);

  const patchRow = useCallback(
    (id: string, patch: Partial<BatchRow>) => {
      setRows((current) => {
        const next = current.map((row) => (row.id === id ? { ...row, ...patch } : row));
        if (patch.meta) persist(next);
        return next;
      });
    },
    [persist],
  );

  const editMeta = useCallback(
    (id: string, patch: Partial<BatchMeta>, clears: (keyof BatchRow["suggested"])[] = []) => {
      setRows((current) => {
        const next = current.map((row) => {
          if (row.id !== id) return row;
          const suggested = { ...row.suggested };
          for (const field of clears) suggested[field] = false;
          return { ...row, meta: { ...row.meta, ...patch }, suggested };
        });
        persist(next);
        return next;
      });
    },
    [persist],
  );

  /** Stage 1 — take the files, and say plainly which ones were refused. */
  function addFiles(files: File[]) {
    const accepted: BatchRow[] = [];
    const refused: Rejected[] = [];

    for (const file of files) {
      try {
        assertAcceptedFile(file);
      } catch (caught) {
        refused.push({
          fileName: file.name,
          reason: caught instanceof ExtractionError ? caught.message : "بۇ ھۆججەت قوللانمايدۇ.",
        });
        continue;
      }
      const id = rowKey(file);
      if (filesRef.current.has(id)) continue;
      filesRef.current.set(id, file);
      accepted.push({
        id,
        fileName: file.name,
        size: file.size,
        format: null,
        contentFormat: "text",
        status: "queued",
        error: "",
        pages: [],
        textBytes: 0,
        fileHash: "",
        duplicate: null,
        skipDuplicate: true,
        selected: false,
        meta: { title: "", author: "", description: "", categoryId: "", status: "draft" },
        suggested: { title: false, author: false, description: false },
        bookId: null,
      });
    }

    // Refusals accumulate rather than replacing each other: a folder with three
    // PDFs in it must list three, not the last one.
    if (refused.length > 0) setRejected((current) => [...current, ...refused]);
    if (accepted.length > 0) setRows((current) => [...current, ...accepted]);
  }

  /** Stage 1 → 2. One file at a time, so a big batch never freezes the tab. */
  async function readAll(only?: string[]) {
    setBusy(true);
    setError(null);
    const saved = await loadBatchMeta();
    const targets = rows.filter(
      (row) => (only ? only.includes(row.id) : row.status === "queued" || row.status === "failed"),
    );

    let done = 0;
    for (const row of targets) {
      const file = filesRef.current.get(row.id);
      setReading({ fileName: row.fileName, done, total: targets.length });
      if (!file) {
        patchRow(row.id, { status: "failed", error: "ھۆججەت تېپىلمىدى — قايتا تاللاڭ." });
        done += 1;
        continue;
      }

      patchRow(row.id, { status: "reading", error: "" });
      try {
        const extracted = await extractFromFile(file);
        const pages = chunkIntoPages(extracted.text);
        if (pages.length === 0) throw new ExtractionError("بۇ ھۆججەتتىن بەت چىقمىدى.");

        // Before anything is written, so a duplicate can be answered on the
        // review screen rather than discovered afterwards.
        const duplicate = await findDuplicate(extracted.fileHash);
        const suggestion = suggestMetadata({
          fileName: row.fileName,
          text: extracted.text,
          embeddedTitle: extracted.embeddedTitle,
          embeddedAuthor: extracted.embeddedAuthor,
        });
        const restored = saved[row.id];

        patchRow(row.id, {
          status: "ready",
          format: extracted.format,
          contentFormat: extracted.contentFormat,
          pages,
          textBytes: utf8Bytes(extracted.text),
          fileHash: extracted.fileHash,
          duplicate,
          skipDuplicate: Boolean(duplicate),
          // What the admin typed before beats what the file suggests.
          meta: restored ?? { ...suggestion.meta, categoryId: "", status: "draft" },
          suggested: restored
            ? { title: false, author: false, description: false }
            : suggestion.suggested,
        });
      } catch (caught) {
        patchRow(row.id, {
          status: "failed",
          error:
            caught instanceof ExtractionError
              ? caught.message
              : "ھۆججەتنى ئوقۇغىلى بولمىدى. Word دا ئېچىپ .docx قىلىپ ساقلاپ قايتا سىناڭ.",
        });
      }

      done += 1;
      // Hand the browser back to the writer for a beat, so the progress line
      // paints and the page keeps answering taps.
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    setReading(null);
    setBusy(false);
    setStage(1);
    void refreshHeadroom();
  }

  const refreshHeadroom = useCallback(async () => {
    const report = await getImportHeadroomAction();
    setHeadroom(report);
    return report;
  }, []);

  /** Apply one value to the checked rows, or to all of them when none are. */
  function applyToSelection(patch: Partial<BatchMeta>) {
    setRows((current) => {
      const anySelected = current.some((row) => row.selected);
      const next = current.map((row) => {
        if (row.status !== "ready") return row;
        if (anySelected && !row.selected) return row;
        const suggested = { ...row.suggested };
        if (patch.author !== undefined) suggested.author = false;
        return { ...row, meta: { ...row.meta, ...patch }, suggested };
      });
      persist(next);
      return next;
    });
  }

  const ordered = useMemo(() => sortRows(rows, sort), [rows, sort]);
  const totals = useMemo(() => batchSize(rows), [rows]);
  const selectedCount = rows.filter((row) => row.selected).length;

  const budget = useMemo(
    () =>
      projectBudget({
        dbBytes: headroom?.dbBytes ?? 0,
        safeBytes: headroom?.safeBytes ?? 0,
        bytesPerPage: headroom?.bytesPerPage ?? 0,
        available: Boolean(headroom?.available),
        pages: totals.pages,
        textBytes: totals.bytes,
      }),
    [headroom, totals],
  );
  const canImport = readyToImport(rows) && (!budget.overBudget || confirmedOverBudget) && !busy;

  /** Stage 3. Draft → pages → verify → the status the admin chose. */
  async function runImport() {
    setBusy(true);
    setError(null);
    setStage(2);

    const before = await refreshHeadroom();
    const targets = importableRows(ordered);
    /**
     * Tracked here rather than read back out of state: `rows` in this closure
     * is the array as it was when the button was pressed, and the loop below
     * spends minutes changing it.
     */
    const landed: string[] = [];

    for (const row of targets) {
      patchRow(row.id, { status: "importing", error: "" });
      setProgress({ fileName: row.fileName, done: 0, total: row.pages.length });
      let bookId: number | null = null;
      try {
        bookId = await createBookRow(
          {
            title: row.meta.title.trim(),
            author: row.meta.author.trim(),
            categoryId: row.meta.categoryId ? Number(row.meta.categoryId) : null,
            date: todayIso(),
            description: row.meta.description.trim(),
            language: "ug",
            // Always a draft first. The status the admin chose is applied only
            // after the pages are counted back out of the database.
            status: "draft",
          },
          {
            format: row.format ?? "TXT",
            fileHash: row.fileHash,
            pageCount: row.pages.length,
            contentFormat: row.contentFormat,
          },
        );
        patchRow(row.id, { bookId });

        await insertPages(bookId, row.pages, (done, total) =>
          setProgress({ fileName: row.fileName, done, total }),
        );

        const stored = await countStoredPages(bookId);
        if (stored !== row.pages.length) {
          throw new Error(`بەت سانى ماس كەلمىدى (${stored}/${row.pages.length}).`);
        }
        if (row.meta.status === "published") await setBookStatus(bookId, "published");

        patchRow(row.id, { status: "imported" });
        landed.push(row.id);
      } catch (caught) {
        // A book that could not be finished is removed rather than left as
        // wreckage. If even that fails, the panel below finds it.
        if (bookId !== null) await deletePartialBook(bookId).catch(() => undefined);
        patchRow(row.id, {
          status: "failed",
          bookId: null,
          error: caught instanceof Error ? caught.message : "ساقلاش مەغلۇپ بولدى.",
        });
      }
    }

    setRows((current) =>
      current.map((row) =>
        row.duplicate && row.skipDuplicate ? { ...row, status: "skipped" } : row,
      ),
    );

    setProgress(null);
    // One tell for the whole run, not one per book: the cached listings only
    // have to be right once the import has finished.
    if (landed.length > 0) await revalidateLibraryAction().catch(() => undefined);
    const after = await refreshHeadroom();
    setGrowth({
      estimated: budget.estimatedBytes,
      actual: Math.max(0, (after.dbBytes || 0) - (before.dbBytes || 0)),
    });

    // Only the rows that landed are forgotten; a failed one keeps its typing,
    // so a retry after a dropped connection starts from what was written.
    await forgetBatchRows(landed);
    setSavedCount(Object.keys(await loadBatchMeta()).length);
    setBusy(false);
  }

  async function retryFailed() {
    const failed = rows.filter((row) => row.status === "failed").map((row) => row.id);
    if (failed.length === 0) return;
    for (const id of failed) patchRow(id, { status: "queued", error: "" });
    await readAll(failed);
  }

  async function discardSaved() {
    await clearBatchMeta();
    setSavedCount(0);
    setNotice("ساقلانغان ئۇچۇرلار ئۆچۈرۈلدى.");
  }

  async function loadIncomplete() {
    setBusy(true);
    const result = await findIncompleteBooksAction();
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setIncomplete(result.books ?? []);
  }

  async function removeIncomplete(id: number) {
    const form = new FormData();
    form.append("ids", String(id));
    const result = await deleteBooksAction(form);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setIncomplete((current) => (current ?? []).filter((book) => book.id !== id));
    setNotice("چالا كىتاب ئۆچۈرۈلدى.");
  }

  const counts = {
    imported: rows.filter((row) => row.status === "imported").length,
    skipped: rows.filter((row) => row.status === "skipped").length,
    failed: rows.filter((row) => row.status === "failed").length,
  };

  return (
    <div className="pb-28">
      <ol className="mb-5 flex flex-wrap gap-1.5" aria-label="باسقۇچلار">
        {STAGES.map((label, index) => (
          <li key={label}>
            <span
              data-testid={`batch-stage-${index}`}
              aria-current={index === stage ? "step" : undefined}
              className={`inline-flex min-h-9 items-center gap-1.5 rounded-full px-3 text-[12.5px] font-semibold ${
                index === stage
                  ? "bg-am text-at"
                  : index < stage
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
        <p
          role="alert"
          data-testid="batch-error"
          className="mb-4 rounded-[var(--radius)] border border-bd2 bg-ab2 px-3.5 py-3 text-[13px] leading-6"
        >
          {error}
        </p>
      )}
      {notice && (
        <p
          role="status"
          data-testid="batch-notice"
          className="mb-4 rounded-[var(--radius)] bg-ab px-3.5 py-3 text-[13px] leading-6"
        >
          {notice}
        </p>
      )}

      {/*
        A refused file is never allowed to just disappear: the list stays on
        screen through the review and the import, so the admin leaves knowing
        that the PDF in the folder is still waiting to be exported as DOCX.
      */}
      {rejected.length > 0 && (
        <div
          className="mb-4 rounded-[var(--radius)] border border-bd2 bg-ab2 p-3.5"
          data-testid="batch-rejected"
        >
          <p className="text-[13px] font-bold">قوبۇل قىلىنمىغان ھۆججەتلەر</p>
          <ul className="mt-2 space-y-2">
            {rejected.map((item, index) => (
              <li key={`${item.fileName}-${index}`} className="text-[12.5px] leading-6">
                <span className="font-semibold">{item.fileName}</span>
                <br />
                {item.reason}
              </li>
            ))}
          </ul>
        </div>
      )}

      {stage === 0 && (
        <section className="paper grain p-5">
          <h2 className="text-[16px] font-bold">كىتاب ھۆججەتلىرىنى تاللاڭ</h2>
          <p className="mt-1.5 text-[13px] leading-6 text-ink3">
            بىر قانچە ھۆججەتنى بىراقلا تاللىسىڭىز بولىدۇ. ھەر بىر كىتابنىڭ ماۋزۇسى،
            ئاپتورى، تۈرى ۋە ھالىتىنى كېيىنكى باسقۇچتا ئايرىم يازىسىز.
          </p>
          <p className="mt-1.5 text-[12.5px] leading-6 text-ink3">
            قوبۇل قىلىنىدىغان فورماتلار: DOCX، DOC، MD، HTML، TXT. PDF قوبۇل قىلىنمايدۇ —
            ئۇنى كومپيۇتېردىكى «بىلىم خەزىنىسى» دېتالىدا ئېچىپ DOCX قىلىپ ساقلاڭ.
          </p>

          <div
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              void filesFromDrop(event.dataTransfer).then(addFiles);
            }}
            data-testid="batch-dropzone"
            className="mt-4 rounded-[var(--radius-lg)] border-2 border-dashed border-bd2 p-6 text-center"
          >
            <Icon name="folder" className="ic-lg mx-auto text-am" />
            <p className="mt-2 text-[13.5px] text-ink2">
              ھۆججەتلەرنى ياكى مۇندەرىجىنى بۇ يەرگە سۆرەپ تاشلاڭ
            </p>
            <div className="mt-3 flex flex-wrap justify-center gap-2">
              <label className="btn-am cursor-pointer">
                <Icon name="file-text" />
                ھۆججەت تاللاش
                <input
                  type="file"
                  accept={ACCEPT_ATTRIBUTE}
                  multiple
                  className="sr-only"
                  data-testid="batch-file-input"
                  onChange={(event) => {
                    if (event.target.files) addFiles(Array.from(event.target.files));
                    event.target.value = "";
                  }}
                />
              </label>
              <label className="hbtn cursor-pointer">
                <Icon name="folder" />
                مۇندەرىجە تاللاش
                <input
                  type="file"
                  className="sr-only"
                  data-testid="batch-folder-input"
                  // Not in the React types, and supported in every browser an
                  // admin will use this from.
                  {...({ webkitdirectory: "", directory: "" } as Record<string, string>)}
                  multiple
                  onChange={(event) => {
                    if (event.target.files) addFiles(Array.from(event.target.files));
                    event.target.value = "";
                  }}
                />
              </label>
            </div>
          </div>

          {rows.length > 0 && (
            <ul className="mt-4 space-y-1.5" data-testid="batch-picked">
              {rows.map((row) => (
                <li
                  key={row.id}
                  className="flex items-center gap-2 rounded-[var(--radius)] bg-bg2 px-3 py-2"
                >
                  <Icon name="file-text" className="text-am" />
                  <span className="min-w-0 flex-1 truncate text-[13.5px]">{row.fileName}</span>
                  <span className="text-[12px] text-ink3">{Math.round(row.size / 1024)} KB</span>
                  <button
                    type="button"
                    className="ibtn"
                    aria-label="تىزىمدىن چىقىرىش"
                    onClick={() => {
                      filesRef.current.delete(row.id);
                      setRows((current) => current.filter((item) => item.id !== row.id));
                    }}
                  >
                    <Icon name="x" />
                  </button>
                </li>
              ))}
            </ul>
          )}


          {savedCount > 0 && (
            <div className="mt-4 rounded-[var(--radius)] bg-ab p-3.5" data-testid="batch-saved-notice">
              <p className="text-[13px] leading-6">
                بۇرۇن يېزىلغان {savedCount} كىتابنىڭ ئۇچۇرى ساقلانغان. ئوخشاش ھۆججەتلەرنى قايتا
                تاللىسىڭىز، يازغانلىرىڭىز ئۆزلۈكىدىن ئەسلىگە كېلىدۇ.
              </p>
              <button
                type="button"
                className="hbtn mt-2"
                data-testid="batch-discard-saved"
                onClick={() => void discardSaved()}
              >
                <Icon name="trash" />
                ساقلانغاننى ئۆچۈرۈش
              </button>
            </div>
          )}

          {reading && (
            <p className="mt-4 text-[13px] text-ink2" data-testid="batch-reading">
              ئوقۇلۇۋاتىدۇ: {reading.fileName} ({reading.done + 1}/{reading.total})
            </p>
          )}
        </section>
      )}

      {stage === 1 && (
        <ReviewStage
          rows={ordered}
          categories={flatCategories}
          sort={sort}
          selectedCount={selectedCount}
          bulkCategoryRef={bulkCategoryRef}
          bulkAuthorRef={bulkAuthorRef}
          bulkStatusRef={bulkStatusRef}
          onSort={setSort}
          onSelectAll={(value) =>
            setRows((current) => current.map((row) => ({ ...row, selected: value })))
          }
          onToggle={(id, value) => patchRow(id, { selected: value })}
          onEdit={editMeta}
          onSkipDuplicate={(id, value) => patchRow(id, { skipDuplicate: value })}
          onApply={applyToSelection}
          onRetry={() => void retryFailed()}
          headroom={headroom}
          budget={budget}
          confirmed={confirmedOverBudget}
          onConfirm={setConfirmedOverBudget}
          totals={totals}
        />
      )}

      {stage === 2 && (
        <ImportStage
          rows={ordered}
          progress={progress}
          counts={counts}
          growth={growth}
          busy={busy}
          incomplete={incomplete}
          onFindIncomplete={() => void loadIncomplete()}
          onRemoveIncomplete={(id) => void removeIncomplete(id)}
          onRetry={() => {
            setStage(1);
            void retryFailed();
          }}
        />
      )}

      {/* Sticky action bar. `pb-28` above keeps it clear of the content. */}
      <div className="safe-bottom safe-x fixed inset-x-0 bottom-0 z-20 border-t border-bd bg-bg2/95 backdrop-blur">
        <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center justify-between gap-2 px-3 py-3 sm:px-6">
          <Link href="/admin/books" className="hbtn">
            بىكار قىلىش
          </Link>
          <div className="flex flex-wrap items-center gap-2">
            {stage === 1 && (
              <button
                type="button"
                className="hbtn"
                data-testid="batch-back"
                disabled={busy}
                onClick={() => setStage(0)}
              >
                <Icon name="undo" />
                كەينىگە
              </button>
            )}
            {stage === 0 && (
              <button
                type="button"
                className="btn-am"
                data-testid="batch-read"
                disabled={busy || rows.length === 0}
                onClick={() => void readAll()}
              >
                <Icon name="redo" />
                ھۆججەتلەرنى ئوقۇش ({rows.length})
              </button>
            )}
            {stage === 1 && (
              <button
                type="button"
                className="btn-am"
                data-testid="batch-import"
                disabled={!canImport}
                onClick={() => void runImport()}
              >
                <Icon name="save" />
                ئەكىرىش ({importableRows(rows).length})
              </button>
            )}
            {stage === 2 && !busy && (
              <Link href="/admin/books" className="btn-am" data-testid="batch-finish">
                تامام
              </Link>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

const STATUS_LABELS: Record<BookStatus, string> = {
  draft: "قارالما",
  published: "ئېلان قىلىنغان",
};

function ReviewStage({
  rows,
  categories,
  sort,
  selectedCount,
  bulkCategoryRef,
  bulkAuthorRef,
  bulkStatusRef,
  onSort,
  onSelectAll,
  onToggle,
  onEdit,
  onSkipDuplicate,
  onApply,
  onRetry,
  headroom,
  budget,
  confirmed,
  onConfirm,
  totals,
}: {
  rows: BatchRow[];
  categories: { category: Category; depth: number }[];
  sort: BatchSort;
  selectedCount: number;
  bulkCategoryRef: React.RefObject<HTMLSelectElement | null>;
  bulkAuthorRef: React.RefObject<HTMLInputElement | null>;
  bulkStatusRef: React.RefObject<HTMLSelectElement | null>;
  onSort: (value: BatchSort) => void;
  onSelectAll: (value: boolean) => void;
  onToggle: (id: string, value: boolean) => void;
  onEdit: (id: string, patch: Partial<BatchMeta>, clears?: (keyof BatchRow["suggested"])[]) => void;
  onSkipDuplicate: (id: string, value: boolean) => void;
  onApply: (patch: Partial<BatchMeta>) => void;
  onRetry: () => void;
  headroom: ImportHeadroom | null;
  budget: Budget;
  confirmed: boolean;
  onConfirm: (value: boolean) => void;
  totals: { pages: number; bytes: number };
}) {
  const failed = rows.filter((row) => row.status === "failed");
  const applyLabel = selectedCount > 0 ? `تاللانغان ${selectedCount} قۇرغا` : "ھەممىسىگە";

  return (
    <>
      <section className="paper grain p-4 sm:p-5">
        <h2 className="text-[16px] font-bold">ھەر بىر كىتابنىڭ ئۇچۇرى</h2>
        <p className="mt-1.5 text-[13px] leading-6 text-ink3">
          ھۆججەتنىڭ ئۆزىدىن تېپىلغان ئۇچۇرلار <span className="chip-hint">تەكلىپ</span> بەلگىسى
          بىلەن كۆرسىتىلدى — تەكشۈرۈپ توغرىلاڭ. ھۆججەتتە ئاپتور يېزىلمىغان بولسا، بۇ يەر بوش
          قالىدۇ.
        </p>

        <div className="mt-4 flex flex-wrap items-end gap-2 border-t border-bd pt-4">
          <label className="flex items-center gap-1.5 text-[12.5px] text-ink2">
            <input
              type="checkbox"
              className="h-4 w-4"
              data-testid="batch-select-all"
              checked={selectedCount > 0 && selectedCount === rows.length}
              onChange={(event) => onSelectAll(event.target.checked)}
            />
            ھەممىنى تاللاش
          </label>

          <label className="text-[12.5px] text-ink2">
            تەرتىپ
            <select
              className="field ms-1.5 w-auto py-1.5"
              data-testid="batch-sort"
              value={sort}
              onChange={(event) => onSort(event.target.value as BatchSort)}
            >
              <option value="picked">تاللانغان تەرتىپ</option>
              <option value="name">ھۆججەت نامى</option>
              <option value="title">ماۋزۇ</option>
              <option value="size">چوڭلۇقى</option>
              <option value="pages">بەت سانى</option>
            </select>
          </label>
        </div>

        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          <div className="flex flex-wrap items-end gap-1.5">
            <label className="min-w-0 flex-1 text-[12.5px] text-ink2">
              تۈر
              <select className="field mt-1" ref={bulkCategoryRef} data-testid="batch-bulk-category">
                <option value="">— تاللاڭ —</option>
                {categories.map((entry) => (
                  <option key={entry.category.id} value={entry.category.id}>
                    {categoryOptionLabel(entry)}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="hbtn"
              data-testid="batch-apply-category"
              onClick={() => {
                const value = bulkCategoryRef.current?.value ?? "";
                if (value) onApply({ categoryId: value });
              }}
            >
              {applyLabel}
            </button>
          </div>

          <div className="flex flex-wrap items-end gap-1.5">
            <label className="min-w-0 flex-1 text-[12.5px] text-ink2">
              ئاپتور
              <input autoComplete="off" className="field mt-1" ref={bulkAuthorRef} data-testid="batch-bulk-author" />
            </label>
            <button
              type="button"
              className="hbtn"
              data-testid="batch-apply-author"
              onClick={() => onApply({ author: bulkAuthorRef.current?.value ?? "" })}
            >
              {applyLabel}
            </button>
          </div>

          <div className="flex flex-wrap items-end gap-1.5">
            <label className="min-w-0 flex-1 text-[12.5px] text-ink2">
              ھالەت
              <select className="field mt-1" ref={bulkStatusRef} data-testid="batch-bulk-status">
                <option value="draft">{STATUS_LABELS.draft}</option>
                <option value="published">{STATUS_LABELS.published}</option>
              </select>
            </label>
            <button
              type="button"
              className="hbtn"
              data-testid="batch-apply-status"
              onClick={() =>
                onApply({ status: (bulkStatusRef.current?.value ?? "draft") as BookStatus })
              }
            >
              {applyLabel}
            </button>
          </div>
        </div>
      </section>

      <ul className="mt-4 space-y-3" data-testid="batch-rows">
        {rows.map((row) => (
          <li
            key={row.id}
            data-testid="batch-row"
            data-file={row.fileName}
            data-status={row.status}
            className="paper p-3.5 sm:p-4"
          >
            <div className="flex flex-wrap items-center gap-2 border-b border-bd pb-2.5">
              <input
                type="checkbox"
                className="h-4 w-4"
                aria-label={`${row.fileName} نى تاللاش`}
                data-testid="batch-row-select"
                checked={row.selected}
                onChange={(event) => onToggle(row.id, event.target.checked)}
              />
              <span className="min-w-0 flex-1 truncate text-[13px] font-bold">{row.fileName}</span>
              <span className="text-[12px] text-ink3">
                {row.format ?? "—"} · {Math.round(row.size / 1024)} KB
                {row.pages.length > 0 ? ` · ${row.pages.length} بەت` : ""}
              </span>
            </div>

            {row.status === "failed" && (
              <div className="mt-2.5 rounded-[var(--radius)] border border-bd2 bg-ab2 px-3 py-2 text-[12.5px] leading-6">
                <span data-testid="batch-row-error">{row.error}</span>
              </div>
            )}

            {row.duplicate && (
              <div
                className="mt-2.5 rounded-[var(--radius)] bg-ab px-3 py-2 text-[12.5px] leading-6"
                data-testid="batch-duplicate"
              >
                بۇ كىتاب ئاللىبۇرۇن بار: «{row.duplicate.title}».
                <label className="ms-2 inline-flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    className="h-4 w-4"
                    data-testid="batch-skip-duplicate"
                    checked={row.skipDuplicate}
                    onChange={(event) => onSkipDuplicate(row.id, event.target.checked)}
                  />
                  ئاتلاپ ئۆتۈش
                </label>
              </div>
            )}

            {row.status === "ready" && (
              <div className="mt-3">
                {/* Stacked on a phone; aligned in columns from lg up, so a
                    folder of twenty books reads like a table. */}
                <div className="grid gap-3 lg:grid-cols-[1.6fr_1.1fr_1.6fr_1.1fr_0.8fr] lg:items-start">
                  <Field
                    label="ماۋزۇ"
                    required
                    suggested={row.suggested.title}
                    testId="batch-title"
                    value={row.meta.title}
                    onChange={(value) => onEdit(row.id, { title: value }, ["title"])}
                  />
                  <Field
                    label="ئاپتور"
                    suggested={row.suggested.author}
                    testId="batch-author"
                    value={row.meta.author}
                    onChange={(value) => onEdit(row.id, { author: value }, ["author"])}
                  />
                  <Field
                    label="چۈشەندۈرۈش"
                    suggested={row.suggested.description}
                    testId="batch-description"
                    multiline
                    value={row.meta.description}
                    onChange={(value) => onEdit(row.id, { description: value }, ["description"])}
                  />
                  <label className="block text-[12px] font-semibold text-ink2">
                    <span className="mb-1 flex items-center gap-1.5">
                      تۈر
                      <span className="text-am">*</span>
                    </span>
                    <select
                      className={`field ${row.meta.categoryId === "" ? "border-am" : ""}`}
                      data-testid="batch-category"
                      value={row.meta.categoryId}
                      aria-label={`${row.fileName} — تۈر`}
                      onChange={(event) => onEdit(row.id, { categoryId: event.target.value })}
                    >
                      <option value="">— تۈر تاللاڭ —</option>
                      {categories.map((entry) => (
                        <option key={entry.category.id} value={entry.category.id}>
                          {categoryOptionLabel(entry)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block text-[12px] font-semibold text-ink2">
                    <span className="mb-1 block">ھالەت</span>
                    <select
                      className="field"
                      data-testid="batch-status"
                      value={row.meta.status}
                      aria-label={`${row.fileName} — ھالەت`}
                      onChange={(event) =>
                        onEdit(row.id, { status: event.target.value as BookStatus })
                      }
                    >
                      <option value="draft">{STATUS_LABELS.draft}</option>
                      <option value="published">{STATUS_LABELS.published}</option>
                    </select>
                  </label>
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>

      {failed.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-2 rounded-[var(--radius)] border border-bd2 bg-ab2 px-3.5 py-3 text-[13px]">
          <span>{failed.length} ھۆججەتنى ئوقۇغىلى بولمىدى.</span>
          <button type="button" className="hbtn" data-testid="batch-retry-failed" onClick={onRetry}>
            <Icon name="refresh" />
            شۇلارنىلا قايتا سىناش
          </button>
        </div>
      )}

      <section className="paper grain mt-4 p-4 sm:p-5" data-testid="batch-headroom">
        <h2 className="flex items-center gap-2 text-[15px] font-bold">
          <Icon name="chart" className="text-am" />
          بوشلۇق ھېسابى
        </h2>
        {headroom?.available ? (
          <>
            <p className="mt-2 text-[13px] leading-7">
              ھازىر ئىشلىتىلگىنى <b>{mb(headroom.dbBytes)}</b> / {mb(headroom.limitBytes)}.
              <br />
              بۇ توپلام {totals.pages} بەت — تەخمىنەن <b data-testid="batch-estimate">
                {mb(budget.estimatedBytes)}
              </b>{" "}
              قوشىدۇ.
              <br />
              ئەكىرگەندىن كېيىن تەخمىنەن <b>{mb(budget.projectedBytes)}</b> بولىدۇ.
            </p>
            {budget.overBudget && (
              <div
                className="mt-3 rounded-[var(--radius)] border border-am bg-ab2 p-3.5"
                data-testid="batch-over-budget"
                role="alert"
              >
                <p className="text-[13px] font-bold leading-7">
                  دىققەت: بۇ توپلام ساندان بوشلۇقىنى بىخەتەر چەكتىن ({mb(headroom.safeBytes)})
                  ئاشۇرۇپ قويىدۇ.
                </p>
                <p className="mt-1 text-[12.5px] leading-6">
                  بىر قىسىم كىتابنى كېيىنكى قېتىمغا قالدۇرۇڭ، ياكى كېرەكسىز كىتابلارنى ئۆچۈرۈپ
                  ئاندىن ئەكىرىڭ. 500 MB تولۇپ كەتسە يېڭى كىتاب قوشقىلى بولمايدۇ.
                </p>
                <label className="mt-2 flex items-center gap-2 text-[13px]">
                  <input
                    type="checkbox"
                    className="h-4 w-4"
                    data-testid="batch-confirm-over"
                    checked={confirmed}
                    onChange={(event) => onConfirm(event.target.checked)}
                  />
                  چۈشەندىم، شۇنداقتىمۇ ئەكىرىمەن
                </label>
              </div>
            )}
          </>
        ) : (
          <p className="mt-2 text-[13px] leading-7 text-ink2">
            بوشلۇقنى ئۆلچەش ئىقتىدارى ئوچۇق ئەمەس — ئەكىرىش داۋاملىشىدۇ، ئەمما قانچە بوشلۇق
            ئىشلىتىلگىنىنى كۆرسەتكىلى بولمايدۇ.
          </p>
        )}
      </section>
    </>
  );
}

/**
 * One editable field, with its own label at every width.
 *
 * The label is repeated on a wide screen rather than replaced by a column
 * heading: twenty rows of unlabelled boxes are a form somebody fills in wrong
 * once and then distrusts, and the cost of the label is one small line.
 *
 * `data-suggested` is the visible marking's other half — the chip says it to a
 * person, the attribute says it to the test that proves suggestions are marked.
 */
function Field({
  label,
  value,
  onChange,
  suggested,
  testId,
  required = false,
  multiline = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  suggested: boolean;
  testId: string;
  required?: boolean;
  multiline?: boolean;
}) {
  const invalid = required && value.trim() === "";
  return (
    <label className="block text-[12px] font-semibold text-ink2">
      <span className="mb-1 flex items-center gap-1.5">
        {label}
        {required && <span className="text-am">*</span>}
        {suggested && <span className="chip-hint">تەكلىپ</span>}
      </span>
      {multiline ? (
        <textarea
          autoComplete="off"
          className="field min-h-16"
          data-testid={testId}
          data-suggested={suggested ? "true" : "false"}
          aria-label={label}
          value={value}
          rows={2}
          onChange={(event) => onChange(event.target.value)}
        />
      ) : (
        <input
          autoComplete="off"
          className={`field ${invalid ? "border-am" : ""}`}
          data-testid={testId}
          data-suggested={suggested ? "true" : "false"}
          aria-label={label}
          aria-invalid={invalid || undefined}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </label>
  );
}

function ImportStage({
  rows,
  progress,
  counts,
  growth,
  busy,
  incomplete,
  onFindIncomplete,
  onRemoveIncomplete,
  onRetry,
}: {
  rows: BatchRow[];
  progress: { fileName: string; done: number; total: number } | null;
  counts: { imported: number; skipped: number; failed: number };
  growth: { estimated: number; actual: number } | null;
  busy: boolean;
  incomplete: IncompleteBook[] | null;
  onFindIncomplete: () => void;
  onRemoveIncomplete: (id: number) => void;
  onRetry: () => void;
}) {
  return (
    <>
      <section className="paper grain p-4 sm:p-5">
        <h2 className="text-[16px] font-bold">{busy ? "ئەكىرىلىۋاتىدۇ" : "نەتىجە"}</h2>
        {progress && (
          <p className="mt-2 text-[13px] text-ink2" data-testid="batch-progress">
            {progress.fileName} — {progress.done}/{progress.total} بەت
          </p>
        )}

        {!busy && (
          <p className="mt-2 text-[13.5px] leading-7" data-testid="batch-summary">
            ئەكىرىلگىنى: <b>{counts.imported}</b> · ئاتلاپ ئۆتۈلگىنى: <b>{counts.skipped}</b> ·
            مەغلۇپ بولغىنى: <b>{counts.failed}</b>
          </p>
        )}

        {growth && (
          <p className="mt-1.5 text-[13px] leading-7 text-ink2" data-testid="batch-growth">
            ساندان {mb(growth.actual)} چوڭايدى (تەخمىنى {mb(growth.estimated)} ئىدى).
            {/*
              Postgres hands out disk in blocks and does not give it back the
              moment rows are deleted, so a batch that fits into space already
              opened up shows as no growth at all. The books really are stored;
              saying so here stops the number from reading as a failure.
            */}
            {growth.actual < growth.estimated / 2 && (
              <>
                {" "}
                كىتابلار تولۇق ساقلاندى — ساندان ئىلگىرى ئېچىلغان بوش ئورۇننى ئىشلەتكەن، شۇڭا
                ئۆسۈش ئاز كۆرۈندى.
              </>
            )}
          </p>
        )}
      </section>

      <ul className="mt-4 space-y-2" data-testid="batch-results">
        {rows.map((row) => (
          <li
            key={row.id}
            className="paper flex flex-wrap items-center gap-2 px-3.5 py-3 text-[13px]"
            data-testid="batch-result"
            data-file={row.fileName}
            data-status={row.status}
          >
            <span className="min-w-0 flex-1 truncate font-semibold">{row.meta.title || row.fileName}</span>
            {row.status === "imported" && row.bookId !== null && (
              <>
                <span className="text-ink3">{STATUS_LABELS[row.meta.status]}</span>
                <Link href={`/books/${row.bookId}`} className="hbtn" data-testid="batch-result-link">
                  <Icon name="book-open" />
                  كىتابنى كۆرۈش
                </Link>
              </>
            )}
            {row.status === "skipped" && (
              <span className="text-ink3">ئاتلاپ ئۆتۈلدى — ئاللىبۇرۇن بار</span>
            )}
            {row.status === "failed" && (
              <span className="text-ink2" data-testid="batch-result-error">
                {row.error}
              </span>
            )}
            {row.status === "importing" && <span className="text-ink3">ساقلىنىۋاتىدۇ…</span>}
          </li>
        ))}
      </ul>

      {counts.failed > 0 && !busy && (
        <div className="mt-4 rounded-[var(--radius)] border border-bd2 bg-ab2 px-3.5 py-3 text-[13px] leading-7">
          <p className="font-bold">مەغلۇپ بولغانلىرىنى قانداق قىلىش كېرەك</p>
          <p className="mt-1">
            سەۋەبى يۇقىرىدا يېزىلغان. ھۆججەتنى Word دا ئېچىپ <b>.docx</b> قىلىپ ساقلاپ قايتا
            سىناڭ. ئۇلىنىش ئۈزۈلگەن بولسا، پەقەت مەغلۇپ بولغانلىرىنىلا قايتا ئەكىرەلەيسىز.
          </p>
          <button type="button" className="hbtn mt-2" data-testid="batch-retry-after" onClick={onRetry}>
            <Icon name="refresh" />
            مەغلۇپ بولغانلىرىنى قايتا سىناش
          </button>
        </div>
      )}

      <section className="paper grain mt-4 p-4 sm:p-5">
        <h2 className="text-[15px] font-bold">چالا قالغان كىتابلارنى تېكشۈرۈش</h2>
        <p className="mt-1.5 text-[13px] leading-6 text-ink3">
          ئەكىرىش يېرىمىدا ئۈزۈلۈپ قالسا، بەتلىرى تولۇق بولمىغان قارالما كىتاب قېلىشى مۇمكىن.
          ئېلان قىلىنغان كىتاب ھەرگىز چالا قالمايدۇ.
        </p>
        <button
          type="button"
          className="hbtn mt-2"
          data-testid="batch-find-incomplete"
          disabled={busy}
          onClick={onFindIncomplete}
        >
          <Icon name="search" />
          تەكشۈرۈش
        </button>

        {incomplete !== null && incomplete.length === 0 && (
          <p className="mt-2 text-[13px] text-ink2" data-testid="batch-incomplete-none">
            چالا قالغان كىتاب يوق.
          </p>
        )}

        {incomplete !== null && incomplete.length > 0 && (
          <ul className="mt-2 space-y-2" data-testid="batch-incomplete">
            {incomplete.map((book) => (
              <li
                key={book.id}
                className="flex flex-wrap items-center gap-2 rounded-[var(--radius)] bg-bg2 px-3 py-2 text-[13px]"
              >
                <span className="min-w-0 flex-1 truncate">{book.title}</span>
                <span className="text-ink3">
                  {book.actualPages}/{book.expectedPages} بەت
                </span>
                <button
                  type="button"
                  className="hbtn"
                  data-testid="batch-remove-incomplete"
                  onClick={() => onRemoveIncomplete(book.id)}
                >
                  <Icon name="trash" />
                  ئۆچۈرۈش
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
