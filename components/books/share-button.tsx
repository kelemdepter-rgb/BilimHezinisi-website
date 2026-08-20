"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/icons";

/**
 * Pass a book — or the exact page somebody is on — to a friend.
 *
 * The library has no advertising budget, so sharing IS the distribution. On a
 * phone that means the system share sheet, which puts the link straight into
 * whatever messaging app the reader actually uses; on a desktop browser with
 * no share sheet it means the clipboard and a plain confirmation, never a
 * silent no-op.
 *
 * The URL is built at the moment of the tap rather than at render, because in
 * the reader it has to carry the page the reader is looking at NOW.
 */
export function ShareButton({
  path,
  title,
  text,
  variant = "button",
  label = "ئۈلەشتۈرۈش",
}: {
  /**
   * The site-relative address to share. A function when it depends on where
   * the reader is right now — the reader passes one so the link carries the
   * page under their thumb — and a plain string everywhere else, which is
   * also what a Server Component is able to hand down.
   */
  path: string | (() => string);
  title: string;
  text?: string;
  variant?: "icon" | "button";
  label?: string;
}) {
  const [notice, setNotice] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  function say(message: string) {
    setNotice(message);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setNotice(null), 3000);
  }

  async function share() {
    const url = new URL(typeof path === "function" ? path() : path, window.location.origin).toString();
    if (navigator.share) {
      try {
        await navigator.share({ title, url, ...(text ? { text } : {}) });
        return;
      } catch (error) {
        // Dismissing the share sheet is not a failure and must not be
        // reported as one; anything else falls through to the clipboard.
        if (error instanceof DOMException && error.name === "AbortError") return;
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      say("ئۇلانما كۆچۈرۈلدى");
    } catch {
      // Clipboard permission refused, or an insecure origin. Showing the
      // address is still better than pretending nothing happened.
      say(url);
    }
  }

  return (
    <span className="relative inline-flex">
      <button
        type="button"
        className={variant === "icon" ? "ibtn" : "hbtn"}
        data-testid="share-button"
        aria-label={label}
        onClick={() => void share()}
      >
        <Icon name="share" className={variant === "icon" ? "ic-lg" : undefined} />
        {variant === "button" && <span>{label}</span>}
      </button>
      {notice && (
        <span
          role="status"
          data-testid="share-notice"
          /**
           * Opens towards the inline start so it cannot push the row wider
           * than a 360 px phone, and sits above the button rather than over
           * the controls beside it.
           */
          className="paper grain absolute bottom-full end-0 z-40 mb-1 max-w-[min(18rem,calc(100vw-2rem))] whitespace-normal break-all px-3 py-2 text-[12.5px] leading-5 shadow-[var(--shadow-2)]"
        >
          {notice}
        </span>
      )}
    </span>
  );
}
