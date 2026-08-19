"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/icons";
import type { Annotation } from "@/lib/reader/pages";
import {
  FONT_LABELS,
  MAX_LINE_HEIGHT,
  MIN_LINE_HEIGHT,
  READER_FONTS,
  type ReaderFont,
  type ReaderSettings,
} from "@/lib/reader/settings";

type Tab = "bookmarks" | "notes" | "settings";

/**
 * Side panel / mobile drawer for bookmarks, notes and typography.
 * Body scroll is locked only while open and released on close, and the panel
 * itself uses overscroll-contain so scrolling inside never chains to the page.
 */
export function ReaderPanel({
  open,
  signedIn,
  bookmarks,
  notes,
  settings,
  onSettingsChange,
  onClose,
  onJump,
  onDelete,
  onAddNote,
}: {
  open: boolean;
  signedIn: boolean;
  bookmarks: Annotation[];
  notes: Annotation[];
  settings: ReaderSettings;
  onSettingsChange: (patch: Partial<ReaderSettings>) => void;
  onClose: () => void;
  onJump: (pageNo: number) => void;
  onDelete: (kind: "bookmark" | "note", id: number) => void;
  onAddNote: () => void;
}) {
  const [tab, setTab] = useState<Tab>("bookmarks");
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    document.documentElement.style.overflow = "hidden";
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      // Always restored, so the page scrolls normally again after closing.
      document.documentElement.style.overflow = "";
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onClose]);

  const items = tab === "bookmarks" ? bookmarks : notes;

  return (
    <>
      <div
        data-testid="panel-overlay"
        aria-hidden="true"
        onClick={onClose}
        className={`fixed inset-0 z-40 bg-black/45 transition-[opacity,visibility] duration-200 print:hidden ${
          open ? "visible opacity-100" : "invisible opacity-0"
        }`}
      />
      <aside
        data-testid="reader-panel"
        role="dialog"
        aria-modal="true"
        aria-label="خەتكۈچ، خاتىرە ۋە تەڭشەكلەر"
        inert={!open}
        className={`grain safe-top fixed inset-y-0 end-0 z-50 flex h-dvh w-[88vw] max-w-96 flex-col border-s border-bd bg-bg shadow-[var(--shadow-2)] transition-[transform,visibility] duration-200 print:hidden ${
          open ? "visible translate-x-0" : "invisible -translate-x-full"
        }`}
      >
        <div className="flex h-14 shrink-0 items-center justify-between border-b border-bd px-3">
          <span className="text-[14px] font-bold">خەتكۈچ ۋە خاتىرىلەر</span>
          <button
            type="button"
            ref={closeRef}
            className="ibtn"
            data-testid="panel-close"
            aria-label="تاقاش"
            onClick={onClose}
          >
            <Icon name="x" className="ic-lg" />
          </button>
        </div>

        <div className="flex shrink-0 gap-1 border-b border-bd p-2" role="tablist">
          <TabButton active={tab === "bookmarks"} onClick={() => setTab("bookmarks")}>
            <Icon name="bookmark" />
            خەتكۈچ ({bookmarks.length})
          </TabButton>
          <TabButton active={tab === "notes"} onClick={() => setTab("notes")}>
            <Icon name="notebook-pen" />
            خاتىرە ({notes.length})
          </TabButton>
          <TabButton active={tab === "settings"} onClick={() => setTab("settings")}>
            <Icon name="settings" />
            تەڭشەك
          </TabButton>
        </div>

        <div className="safe-bottom flex-1 overflow-y-auto overscroll-contain p-3">
          {tab === "settings" ? (
            <div className="space-y-4">
              <label className="block">
                <span className="mb-1.5 block text-[13px] font-semibold text-ink2">خەت نۇسخىسى</span>
                <select
                  className="field"
                  data-testid="font-family"
                  value={settings.font}
                  onChange={(event) => onSettingsChange({ font: event.target.value as ReaderFont })}
                >
                  {READER_FONTS.map((font) => (
                    <option key={font} value={font}>
                      {FONT_LABELS[font]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="mb-1.5 block text-[13px] font-semibold text-ink2">
                  قۇر ئارىلىقى: {settings.lineHeight.toFixed(1)}
                </span>
                <input
                  className="w-full accent-[var(--am)]"
                  type="range"
                  data-testid="line-height"
                  min={MIN_LINE_HEIGHT}
                  max={MAX_LINE_HEIGHT}
                  step={0.1}
                  value={settings.lineHeight}
                  onChange={(event) => onSettingsChange({ lineHeight: Number(event.target.value) })}
                />
              </label>
              <p className="text-[12.5px] leading-6 text-ink3">
                خەت چوڭلۇقى ۋە تۈس ئۈستىدىكى قوراللار بالدىقىدا. تەڭشەكلىرىڭىز مۇشۇ
                تور كۆرگۈچتە ساقلىنىدۇ.
              </p>
            </div>
          ) : !signedIn ? (
            <p className="rounded-[var(--radius)] bg-ab px-3.5 py-3 text-[13px] leading-6">
              خەتكۈچ ۋە خاتىرە ئۈچۈن ھېساباتقا كىرىشىڭىز كېرەك.
            </p>
          ) : items.length === 0 ? (
            <p className="px-1 py-3 text-[13px] leading-6 text-ink3">
              {tab === "bookmarks" ? "تېخى خەتكۈچ يوق." : "تېخى خاتىرە يوق."}
            </p>
          ) : (
            <ul className="space-y-2">
              {items.map((item) => (
                <li key={item.id} className="paper flex items-start gap-2 p-2.5">
                  <button
                    type="button"
                    className="min-w-0 flex-1 text-start"
                    onClick={() => onJump(item.page_no)}
                  >
                    <span className="block text-[12px] font-semibold text-am">
                      {item.page_no}-بەت
                    </span>
                    <span className="mt-0.5 line-clamp-3 block text-[13px] leading-6">
                      {item.text}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="ibtn shrink-0"
                    aria-label="ئۆچۈرۈش"
                    onClick={() => onDelete(tab === "bookmarks" ? "bookmark" : "note", item.id)}
                  >
                    <Icon name="trash" />
                  </button>
                </li>
              ))}
            </ul>
          )}

          {signedIn && tab === "notes" && (
            <button type="button" className="btn-am mt-4 w-full" onClick={onAddNote}>
              <Icon name="plus" />
              خاتىرە قوشۇش
            </button>
          )}
        </div>
      </aside>
    </>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-[var(--radius)] px-2 text-[12.5px] font-semibold ${
        active ? "bg-am text-at" : "text-ink2 hover:bg-bg2"
      }`}
    >
      {children}
    </button>
  );
}
