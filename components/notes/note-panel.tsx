"use client";

import { useEffect, useRef } from "react";
import { Icon, type IconName } from "@/components/icons";

/**
 * The frame of the notebook's panels — «ئىلگىرىكى نۇسخىلار» (PROMPT-46) and
 * «مۇندەرىجە» (PROMPT-49): a sheet from the bottom on a phone, a side panel
 * from 1024 px up.
 *
 * On a phone the sheet covers the page, so the page behind is held still and
 * whatever the panel lists scrolls inside it (the caller's scrolling part
 * carries `overscroll-contain`); on a wide screen the note stays scrollable
 * beside it. Mounted only while open: the close button takes the focus,
 * Escape and a tap beside the sheet close it.
 *
 * Test ids are `<testId>-panel`, `<testId>-overlay` and `<testId>-close`.
 */
export function NotePanel({
  testId,
  title,
  icon,
  onClose,
  children,
}: {
  testId: string;
  title: string;
  icon: IconName;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  /** Escape closes; the page is held still only where the sheet covers it. */
  useEffect(() => {
    const narrow = window.matchMedia("(max-width: 1023px)").matches;
    if (narrow) document.documentElement.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.documentElement.style.overflow = "";
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);

  return (
    <>
      {/* Only where the sheet covers the page — see above. */}
      <div
        data-testid={`${testId}-overlay`}
        aria-hidden="true"
        onClick={onClose}
        className="fixed inset-0 z-40 bg-black/45 lg:hidden print:hidden"
      />
      <aside
        data-testid={`${testId}-panel`}
        role="dialog"
        aria-label={title}
        className="grain safe-x fixed inset-x-0 bottom-0 z-50 flex max-h-[85dvh] flex-col rounded-t-2xl border-t border-bd bg-bg shadow-[var(--shadow-2)] print:hidden lg:inset-x-auto lg:inset-y-0 lg:end-0 lg:h-dvh lg:max-h-none lg:w-[26rem] lg:rounded-none lg:border-s lg:border-t-0 lg:pt-[env(safe-area-inset-top)]"
      >
        <div className="flex h-14 shrink-0 items-center justify-between gap-2 border-b border-bd px-3">
          <span className="flex items-center gap-2 text-[14px] font-bold">
            <Icon name={icon} className="text-am" />
            {title}
          </span>
          <button
            type="button"
            ref={closeRef}
            className="ibtn"
            data-testid={`${testId}-close`}
            aria-label="تاقاش"
            onClick={onClose}
          >
            <Icon name="x" className="ic-lg" />
          </button>
        </div>
        {children}
      </aside>
    </>
  );
}
