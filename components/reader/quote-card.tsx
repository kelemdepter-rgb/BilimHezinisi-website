"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "@/components/icons";
import { exportFileName, saveBlob } from "@/lib/books/export-book";
import { checkQuote, renderQuoteCard } from "@/lib/share/quote-card";

/**
 * «نەقىل رەسىمى» — turn the passage the reader has selected into a picture.
 *
 * Deliberately driven by selection rather than by a toolbar button: the
 * reader has already said which words matter by highlighting them, and asking
 * them to say it again in a dialog would be asking twice.
 *
 * Everything about this has to work by TAP. A control that only appears on
 * hover does not exist on a phone, which is where most of this library is
 * read — so the button is placed by the selection's own rectangle, kept
 * inside the viewport, and takes a pointerdown that deliberately does not
 * steal the selection out from under itself.
 */

type Anchor = { top: number; left: number };

export function QuoteCard({
  containerRef,
  title,
  author,
  currentPage,
}: {
  containerRef: React.RefObject<HTMLDivElement | null>;
  title: string;
  author: string;
  /** Read at the moment the card is made, so it credits the right page. */
  currentPage: () => number;
}) {
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const [image, setImage] = useState<{ url: string; blob: Blob; pageNo: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const selected = useRef("");

  /** Where to float the button for the current selection, or null for none. */
  const locate = useCallback((): Anchor | null => {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;
    const text = selection.toString().trim();
    if (text.length < 2) return null;

    const range = selection.getRangeAt(0);
    const container = containerRef.current;
    // Only text of the book itself — a selection in the toolbar is not a quote.
    if (!container || !container.contains(range.commonAncestorContainer)) return null;

    const rect = range.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return null;
    selected.current = text;

    /**
     * Below the selection, not above: on a phone the operating system puts
     * its own copy/share menu above, and two floating bars fighting for the
     * same strip is how a reader ends up tapping the wrong one. Clamped so it
     * never lands under the sticky bars at either end.
     */
    const width = 168;
    const below = rect.bottom + 10;
    const top = Math.min(Math.max(below, 64), window.innerHeight - 120);
    const left = Math.min(
      Math.max(rect.left + rect.width / 2 - width / 2, 12),
      window.innerWidth - width - 12,
    );
    return { top, left };
  }, [containerRef]);

  useEffect(() => {
    const update = () => setAnchor(locate());
    document.addEventListener("selectionchange", update);
    // A long press on Android settles the selection after selectionchange has
    // already fired, so the rectangle is only final once the finger is up.
    document.addEventListener("pointerup", update);
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      document.removeEventListener("selectionchange", update);
      document.removeEventListener("pointerup", update);
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [locate]);

  // The object URL is the card; it has to outlive the render that made it and
  // be released when it is replaced or the dialog closes.
  useEffect(
    () => () => {
      if (image) URL.revokeObjectURL(image.url);
    },
    [image],
  );

  function close() {
    setImage(null);
    setError(null);
  }

  async function make() {
    const check = checkQuote(selected.current);
    if (!check.ok) {
      setError(check.message);
      return;
    }
    setBusy(true);
    setError(null);
    // Read once, here: by the time the reader taps "save" the page under the
    // viewport may have moved, and the file should credit the quoted page.
    const pageNo = currentPage();
    try {
      const blob = await renderQuoteCard({
        quote: check.quote,
        title,
        author,
        pageNo,
        siteName: "بىلىم خەزىنىسى",
        siteHost: window.location.host,
      });
      setImage({ url: URL.createObjectURL(blob), blob, pageNo });
    } catch {
      setError("رەسىم ياسالمىدى. قايتا سىناڭ.");
    } finally {
      setBusy(false);
    }
  }

  const fileName = image ? exportFileName(`${title} — ${image.pageNo}`, "png") : "";

  async function shareImage() {
    if (!image) return;
    const file = new File([image.blob], fileName, { type: "image/png" });
    if (navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title });
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
      }
    }
    saveBlob(image.blob, fileName);
  }

  return (
    <>
      {anchor && !image && (
        <div
          className="fixed z-40 print:hidden"
          style={{ top: anchor.top, left: anchor.left }}
          // Taking the pointer down without preventing the default would
          // collapse the very selection this button exists to use.
          onPointerDown={(event) => event.preventDefault()}
        >
          <button
            type="button"
            className="hbtn on shadow-[var(--shadow-2)]"
            data-testid="quote-card-open"
            disabled={busy}
            onClick={() => void make()}
          >
            <Icon name="image" />
            {busy ? "ياسىلىۋاتىدۇ…" : "نەقىل رەسىمى"}
          </button>
        </div>
      )}

      {error && !image && (
        <div
          role="alert"
          data-testid="quote-card-error"
          className="paper grain fixed inset-x-3 z-40 mx-auto max-w-sm px-3.5 py-3 text-[13px] leading-6 shadow-[var(--shadow-2)] print:hidden"
          style={{ bottom: "calc(env(safe-area-inset-bottom, 0px) + 5rem)" }}
        >
          {error}
          <button type="button" className="hbtn mt-2 w-full" onClick={() => setError(null)}>
            بولىدۇ
          </button>
        </div>
      )}

      {image && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-3 print:hidden"
          onClick={close}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="نەقىل رەسىمى"
            data-testid="quote-card-dialog"
            className="paper grain flex max-h-[calc(100dvh-1.5rem)] w-full max-w-md flex-col overflow-y-auto overscroll-contain p-3"
            onClick={(event) => event.stopPropagation()}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- a blob
                built in this tab; next/image optimises remote files. */}
            <img
              src={image.url}
              alt="تاللانغان نەقىلنىڭ رەسىمى"
              data-testid="quote-card-image"
              className="w-full rounded-[var(--radius)]"
            />
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                className="btn-am flex-1"
                data-testid="quote-card-share"
                onClick={() => void shareImage()}
              >
                <Icon name="share" />
                ھەمبەھىرلەش
              </button>
              <button
                type="button"
                className="hbtn flex-1"
                data-testid="quote-card-save"
                onClick={() => saveBlob(image.blob, fileName)}
              >
                <Icon name="download" />
                ساقلاش
              </button>
              <button
                type="button"
                className="ibtn"
                aria-label="تاقاش"
                data-testid="quote-card-close"
                onClick={close}
              >
                <Icon name="x" className="ic-lg" />
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
