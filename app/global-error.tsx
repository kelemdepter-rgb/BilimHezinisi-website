"use client";

import { useEffect } from "react";
import "./globals.css";
import { Icon, IconSprite } from "@/components/icons";

/**
 * The last boundary: what renders when the root layout itself could not —
 * the shell reads the category tree, and on a cold cache with the database
 * not answering, it cannot (PROMPT-40).
 *
 * It replaces the whole document, so it brings its own <html> and <body>, the
 * site's stylesheet and the icon sprite. No theme cookie can be read here;
 * the stylesheet's own `prefers-color-scheme` rule still applies. A plain
 * link back to the address that failed rather than a client-side retry: with
 * the layout gone there is no router state worth keeping, and a full load is
 * what actually asks the server again.
 */
export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    console.error("[bh] shell failed", error.digest ?? error.name);
  }, [error]);

  return (
    <html lang="ug" dir="rtl">
      <body className="min-h-dvh">
        <title>بىلىم خەزىنىسى</title>
        <IconSprite />
        <main
          className="flex min-h-dvh items-center justify-center px-4 py-10"
          style={{
            paddingTop: "max(2.5rem, env(safe-area-inset-top))",
            paddingBottom: "max(2.5rem, env(safe-area-inset-bottom))",
          }}
          data-testid="error-page"
          data-bh-error-page=""
        >
          <div className="paper w-full max-w-lg p-6 text-center">
            <Icon name="info" className="ic-lg mx-auto text-am" />
            <h1 className="mt-3 text-[16px] font-bold">كۇتۇپخانا ھازىر جاۋاب بەرمىدى</h1>
            <p className="mx-auto mt-2 max-w-md text-[13.5px] leading-7 text-ink2">
              بىر نەچچە سېكۇنتتىن كېيىن قايتا سىناپ بېقىڭ.
            </p>
            <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
              {/* A real navigation to the same address: the only retry that
                  is sure to reach the server again from here. */}
              <a
                href=""
                className="btn-am"
                data-testid="error-retry"
                onClick={(event) => {
                  event.preventDefault();
                  window.location.reload();
                }}
              >
                <Icon name="redo" />
                قايتا سىناش
              </a>
              {/* A full load on purpose, as above: the layout that the
                  client router renders into is what failed. */}
              {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
              <a href="/" className="hbtn" data-testid="error-home">
                باش بەت
              </a>
            </div>
            {error.digest && (
              <p className="mt-4 text-[12px] text-ink3">
                خاتالىق نومۇرى: <span dir="ltr">{error.digest}</span>
              </p>
            )}
          </div>
        </main>
      </body>
    </html>
  );
}
