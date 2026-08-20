"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/icons";
import {
  collectBookPages,
  DownloadError,
  requestDownload,
  type DownloadManifest,
} from "@/lib/books/download";
import {
  buildBookDocx,
  buildBookText,
  exportFileName,
  saveBlob,
  textFileExtension,
} from "@/lib/books/export-book";

/**
 * "Keep a copy of this book."
 *
 * The site is one person's project on a free plan. If it ever goes dark, the
 * copies readers have already downloaded are what survives — so this is
 * offered plainly, next to reading, rather than hidden in a menu.
 *
 * PDF is deliberately absent, as everywhere else in the web edition.
 */

type Format = "docx" | "text";

type State =
  | { kind: "idle" }
  | { kind: "working"; format: Format; done: number; total: number }
  | { kind: "error"; message: string }
  | { kind: "done"; fileName: string };

export function DownloadBook({
  bookId,
  variant = "button",
  placement = "down",
}: {
  bookId: number;
  /** The reader's toolbar has room for an icon; the book page has room for words. */
  variant?: "icon" | "button";
  /**
   * Which way the panel opens. The reader's bar is stuck to the bottom of the
   * screen, where a panel dropping downwards would open below the fold and be
   * unreachable — the exact mobile failure the project rules forbid.
   */
  placement?: "down" | "up";
}) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<State>({ kind: "idle" });
  const abort = useRef<AbortController | null>(null);
  const wrapper = useRef<HTMLDivElement>(null);

  // Tapping anywhere else closes the panel — on a phone there is no Escape
  // key and no way to click "off" a menu that ignores it.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!wrapper.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  useEffect(() => () => abort.current?.abort(), []);

  async function run(format: Format) {
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    setState({ kind: "working", format, done: 0, total: 0 });

    try {
      const manifest: DownloadManifest = await requestDownload(bookId, controller.signal);
      setState({ kind: "working", format, done: 0, total: manifest.pageCount });

      const pages = await collectBookPages(bookId, manifest.pageCount, {
        signal: controller.signal,
        onProgress: ({ done, total }) => setState({ kind: "working", format, done, total }),
      });

      const meta = {
        title: manifest.title,
        author: manifest.author,
        contentFormat: manifest.contentFormat,
        sourceUrl: `${window.location.origin}/books/${bookId}`,
      };

      const fileName =
        format === "docx"
          ? exportFileName(manifest.title, "docx")
          : exportFileName(manifest.title, textFileExtension(manifest.contentFormat));

      if (format === "docx") {
        saveBlob(await buildBookDocx(meta, pages), fileName);
      } else {
        saveBlob(
          new Blob([buildBookText(meta, pages)], { type: "text/plain;charset=utf-8" }),
          fileName,
        );
      }
      setState({ kind: "done", fileName });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        setState({ kind: "idle" });
        return;
      }
      setState({
        kind: "error",
        message:
          error instanceof DownloadError
            ? error.message
            : "كىتابنى چۈشۈرگىلى بولمىدى. سەل تۇرۇپ قايتا سىناڭ.",
      });
    }
  }

  const working = state.kind === "working";
  const percent =
    working && state.total > 0 ? Math.min(100, Math.round((state.done / state.total) * 100)) : 0;

  return (
    <div className="relative" ref={wrapper}>
      <button
        type="button"
        className={variant === "icon" ? "ibtn" : "hbtn"}
        data-testid="download-book"
        aria-label="كىتابنى چۈشۈرۈش"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((value) => !value)}
      >
        <Icon name="download" className={variant === "icon" ? "ic-lg" : undefined} />
        {variant === "button" && <span>چۈشۈرۈش</span>}
      </button>

      {open && (
        <div
          role="menu"
          data-testid="download-menu"
          aria-label="كىتابنى چۈشۈرۈش"
          /**
           * Anchored to the inline-end edge, which under dir="rtl" is the
           * left — so the panel opens inwards and cannot push the page wider
           * than the phone.
           */
          className={`paper grain absolute end-0 z-40 w-[min(19rem,calc(100vw-1.5rem))] p-3 text-start shadow-[var(--shadow-2)] ${
            placement === "up" ? "bottom-full mb-1" : "top-full mt-1"
          }`}
        >
          {state.kind === "idle" && (
            <>
              <p className="mb-2 text-[12.5px] leading-6 text-ink2">
                پۈتۈن كىتاب ئۈسكۈنىڭىزگە ساقلىنىدۇ. سايت ئىشلىمەي قالسىمۇ نۇسخىڭىز قالىدۇ.
              </p>
              <div className="flex flex-col gap-2">
                <button
                  type="button"
                  role="menuitem"
                  className="hbtn w-full justify-start"
                  data-testid="download-docx"
                  onClick={() => void run("docx")}
                >
                  <Icon name="file-text" />
                  Word ھۆججىتى (.docx)
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="hbtn w-full justify-start"
                  data-testid="download-text"
                  onClick={() => void run("text")}
                >
                  <Icon name="align-right" />
                  تېكىست ھۆججىتى
                </button>
              </div>
              <p className="mt-2 text-[11.5px] leading-5 text-ink3">
                PDF يوق — تور نۇسخىسىدا PDF ياسالمايدۇ.
              </p>
            </>
          )}

          {working && (
            <>
              <p className="text-[12.5px] leading-6" data-testid="download-progress">
                تەييارلىنىۋاتىدۇ… <span dir="ltr">{state.done}/{state.total || "?"}</span>
              </p>
              <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-bg3">
                <div
                  className="h-full bg-am transition-[width] duration-200"
                  style={{ width: `${percent}%` }}
                />
              </div>
              <button
                type="button"
                className="hbtn mt-3 w-full"
                data-testid="download-cancel"
                onClick={() => abort.current?.abort()}
              >
                <Icon name="x" />
                بىكار قىلىش
              </button>
            </>
          )}

          {state.kind === "done" && (
            <>
              <p className="text-[12.5px] leading-6" data-testid="download-done">
                <Icon name="check" className="text-am" /> ساقلاندى:{" "}
                <span className="break-all">{state.fileName}</span>
              </p>
              <button
                type="button"
                className="hbtn mt-3 w-full"
                onClick={() => setState({ kind: "idle" })}
              >
                يەنە چۈشۈرۈش
              </button>
            </>
          )}

          {state.kind === "error" && (
            <>
              <p role="alert" className="text-[12.5px] leading-6" data-testid="download-error">
                {state.message}
              </p>
              <button
                type="button"
                className="hbtn mt-3 w-full"
                onClick={() => setState({ kind: "idle" })}
              >
                قايتا سىناش
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
