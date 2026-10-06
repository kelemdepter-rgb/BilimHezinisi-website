"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Icon } from "@/components/icons";

/**
 * What any page shows when the server could not finish it — in practice, when
 * the database did not answer in time.
 *
 * Before PROMPT-40 there was no boundary here at all. On 2026-10-05 a search
 * flood stalled Supabase, and every page waited on it until Vercel killed the
 * request at 300 s: readers watched a spinner for five minutes and then got
 * the browser's own error. Now every Supabase call gives up within seconds
 * (lib/supabase/timeouts.ts), the loaders throw rather than pretend the
 * library is empty (lib/cache.ts), and this is what the reader sees instead:
 * a short Uyghur message inside the usual header and sidebar, and a way to
 * try again.
 *
 * The /notes routes keep their own boundary (app/notes/error.tsx). A failure
 * in the root layout itself — the shell — is app/global-error.tsx.
 *
 * `data-bh-error-page` is what public/sw.js looks for: a page that ended
 * here must never be kept as the offline copy of the page that was asked for.
 */
export default function AppError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    // The digest is the only handle on the matching server log line; Next
    // withholds the message itself from the browser on purpose.
    console.error("[bh] page failed", error.digest ?? error.name);
  }, [error]);

  return (
    <div className="px-3 py-10 sm:px-6 lg:px-8" data-testid="error-page" data-bh-error-page="">
      <div className="paper mx-auto max-w-lg p-6 text-center">
        <Icon name="info" className="ic-lg mx-auto text-am" />
        <h1 className="mt-3 text-[16px] font-bold">كۇتۇپخانا ھازىر جاۋاب بەرمىدى</h1>
        <p className="mx-auto mt-2 max-w-md text-[13.5px] leading-7 text-ink2">
          بىر نەچچە سېكۇنتتىن كېيىن قايتا سىناپ بېقىڭ.
        </p>

        <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
          <button type="button" className="btn-am" data-testid="error-retry" onClick={() => retry()}>
            <Icon name="redo" />
            قايتا سىناش
          </button>
          <Link href="/" className="hbtn" data-testid="error-home">
            باش بەت
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
