"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Icon } from "@/components/icons";

/**
 * What the notebook shows when something on the server goes wrong.
 *
 * There was no boundary here, so the failure that broke «يېڭى خاتىرە» fell
 * through to Next's built-in screen: a blank page reading "This page couldn't
 * load — A server error occurred", in English, with a reload button that did
 * nothing because the fault was not transient. Somebody writing in Uyghur was
 * told nothing they could act on, and nothing they could report.
 *
 * This covers /notes and /notes/[id] both, since a boundary applies to the
 * segment it sits in and everything under it.
 */
export default function NotesError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // The digest is the only handle on the matching server log line; Next
    // withholds the message itself from the browser on purpose.
    console.error("[bh] notes route failed", error.digest ?? error.message);
  }, [error]);

  return (
    <div className="px-3 py-10 sm:px-6 lg:px-8">
      <div className="paper mx-auto max-w-lg p-6 text-center">
        <Icon name="notebook-pen" className="ic-lg mx-auto text-am" />
        <h1 className="mt-3 text-[16px] font-bold">خاتىرە دەپتىرى ئېچىلمىدى</h1>
        <p className="mx-auto mt-2 max-w-md text-[13.5px] leading-7 text-ink2">
          مۇلازىمېتىردا كۈتۈلمىگەن خاتالىق كۆرۈلدى. يازغانلىرىڭىز يوقالمىدى — قايتا
          سىناپ بېقىڭ.
        </p>

        <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
          <button type="button" className="btn-am" data-testid="notes-error-retry" onClick={reset}>
            <Icon name="redo" />
            قايتا سىناش
          </button>
          <Link href="/notes" className="hbtn" data-testid="notes-error-back">
            خاتىرىلەر تىزىملىكى
          </Link>
        </div>

        {error.digest && (
          <p className="mt-4 text-[12px] text-ink3">
            خاتالىق نومۇرى: <span dir="ltr">{error.digest}</span>
          </p>
        )}
      </div>
    </div>
  );
}
