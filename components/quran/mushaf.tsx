"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icons";
import { ThemeToggle } from "@/components/theme-toggle";
import { SuraList } from "@/components/quran/sura-list";
import { addQuranBookmark, removeQuranBookmark } from "@/lib/quran/bookmarks";
import { copyAyas } from "@/lib/quran/copy";
import { BASMALA, revelationLabel, showsBasmala, toArabicNumerals } from "@/lib/quran/format";
import {
  ARABIC_LINE_HEIGHT,
  ARABIC_SIZE_RATIO,
  TRANSLATION_LABELS,
  TRANSLATION_MODES,
  TRANSLATION_SIZE_RATIO,
} from "@/lib/quran/settings";
import {
  getTranslationModeServerSnapshot,
  getTranslationModeSnapshot,
  setTranslationMode,
  subscribeTranslationMode,
} from "@/lib/quran/settings-store";
import type { Aya, Sura } from "@/lib/quran/types";
import { MAX_FONT_SIZE, MIN_FONT_SIZE } from "@/lib/reader/settings";
import {
  getSettingsServerSnapshot,
  getSettingsSnapshot,
  subscribeSettings,
  updateSettingsStore,
} from "@/lib/reader/settings-store";
import type { Theme } from "@/lib/theme";

const TOAST_MS = 2400;

/**
 * The medallion carrying the aya number. It doubles as the verse's action
 * trigger, so the same reach exists without a pointer — and stops the click
 * from bubbling into the surrounding tap area, which would toggle twice.
 */
function AyaNumber({
  aya,
  expanded,
  onToggle,
}: {
  aya: number;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      className="quran-aya-num"
      data-testid="aya-number"
      aria-expanded={expanded}
      aria-label={`${toArabicNumerals(aya)}-ئايەت — ھەرىكەتلەر`}
      onClick={(event) => {
        event.stopPropagation();
        onToggle();
      }}
    >
      {toArabicNumerals(aya)}
    </button>
  );
}

export function Mushaf({
  sura,
  suras,
  ayas,
  initialAya,
  initialBookmarks,
  signedIn,
  theme,
}: {
  sura: Sura;
  suras: Sura[];
  ayas: Aya[];
  initialAya: number | null;
  initialBookmarks: number[];
  signedIn: boolean;
  theme: Theme | null;
}) {
  const router = useRouter();
  const settings = useSyncExternalStore(
    subscribeSettings,
    getSettingsSnapshot,
    getSettingsServerSnapshot,
  );
  const mode = useSyncExternalStore(
    subscribeTranslationMode,
    getTranslationModeSnapshot,
    getTranslationModeServerSnapshot,
  );

  const [selected, setSelected] = useState<number | null>(initialAya);
  const [bookmarks, setBookmarks] = useState<Set<number>>(() => new Set(initialBookmarks));
  const [toast, setToast] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const drawerCloseRef = useRef<HTMLButtonElement>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const previous = sura.number > 1 ? suras.find((s) => s.number === sura.number - 1) : undefined;
  const next = sura.number < 114 ? suras.find((s) => s.number === sura.number + 1) : undefined;

  const showToast = useCallback((message: string) => {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), TOAST_MS);
  }, []);

  useEffect(() => () => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
  }, []);

  const toggleSelected = useCallback((ayaNumber: number) => {
    setSelected((current) => (current === ayaNumber ? null : ayaNumber));
  }, []);

  const scrollToAya = useCallback((ayaNumber: number) => {
    const node = containerRef.current?.querySelector<HTMLElement>(`[data-aya="${ayaNumber}"]`);
    if (!node) return false;
    node.scrollIntoView({ behavior: "smooth", block: "start" });
    setSelected(ayaNumber);
    return true;
  }, []);

  /**
   * Deep link: /quran/2?aya=255 opens the sura scrolled to that aya and
   * highlights it. Following another ?aya link inside the same sura re-uses
   * this component, so the highlight is adjusted during render (React's
   * "derive state from props" pattern) and the effect only scrolls.
   */
  const [lastDeepLink, setLastDeepLink] = useState(initialAya);
  if (lastDeepLink !== initialAya) {
    setLastDeepLink(initialAya);
    if (initialAya !== null) setSelected(initialAya);
  }

  useEffect(() => {
    if (initialAya === null) return;
    let cancelled = false;
    const bring = () => {
      if (cancelled) return;
      const node = containerRef.current?.querySelector<HTMLElement>(`[data-aya="${initialAya}"]`);
      node?.scrollIntoView({ behavior: "auto", block: "start" });
    };

    // Al-Baqara is 286 verses of Uthmani text: the Quran webfont lands after
    // first paint and moves everything below it, and the browser's own scroll
    // restoration runs on load too. One attempt lands on the wrong offset, so
    // the target is brought back into view once the fonts are in and once more
    // after layout settles.
    const frame = requestAnimationFrame(bring);
    const timer = setTimeout(bring, 400);
    void document.fonts?.ready.then(() => requestAnimationFrame(bring));

    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      clearTimeout(timer);
    };
  }, [initialAya, sura.number]);

  // Lock page scroll only while the sura drawer is open, and release it the
  // moment it closes (CLAUDE.md mobile rules).
  useEffect(() => {
    if (!drawerOpen) return;
    document.documentElement.style.overflow = "hidden";
    drawerCloseRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDrawerOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.documentElement.style.overflow = "";
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [drawerOpen]);

  async function copySelected(withTranslation: boolean, aya: Aya) {
    const copied = await copyAyas([aya], withTranslation);
    showToast(
      copied
        ? withTranslation
          ? "ئايەت تەرجىمىسى بىلەن كۆچۈرۈلدى"
          : "ئايەت كۆچۈرۈلدى"
        : "كۆچۈرگىلى بولمىدى",
    );
  }

  async function toggleBookmark(ayaNumber: number) {
    const has = bookmarks.has(ayaNumber);
    // Update first so the tap feels instant; roll back if the write fails.
    setBookmarks((current) => {
      const draft = new Set(current);
      if (has) draft.delete(ayaNumber);
      else draft.add(ayaNumber);
      return draft;
    });
    try {
      if (has) await removeQuranBookmark(sura.number, ayaNumber);
      else await addQuranBookmark(sura.number, ayaNumber);
      showToast(has ? "خەتكۈچ ئېلىۋېتىلدى" : "خەتكۈچ قوشۇلدى");
    } catch {
      setBookmarks((current) => {
        const draft = new Set(current);
        if (has) draft.add(ayaNumber);
        else draft.delete(ayaNumber);
        return draft;
      });
      showToast("خەتكۈچنى ساقلىغىلى بولمىدى");
    }
  }

  function jump(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const targetSura = Number(form.get("sura"));
    const rawAya = Number(form.get("aya"));
    if (!Number.isInteger(targetSura) || targetSura < 1 || targetSura > 114) {
      showToast("١ — ١١٤ ئارىلىقىدىكى سۈرە نومۇرىنى كىرگۈزۈڭ");
      return;
    }
    const target = suras.find((s) => s.number === targetSura);
    const targetAya =
      Number.isInteger(rawAya) && rawAya >= 1 && rawAya <= (target?.aya_count ?? 1) ? rawAya : 1;
    if (targetSura === sura.number) {
      if (!scrollToAya(targetAya)) showToast("بۇ ئايەت تېپىلمىدى");
      return;
    }
    router.push(`/quran/${targetSura}?aya=${targetAya}`);
  }

  const arabicSize = Math.round(settings.fontSize * ARABIC_SIZE_RATIO);
  const translationSize = Math.round(settings.fontSize * TRANSLATION_SIZE_RATIO);
  const nextMode = TRANSLATION_MODES[(TRANSLATION_MODES.indexOf(mode) + 1) % TRANSLATION_MODES.length];

  return (
    <div className="flex min-h-dvh flex-col">
      {/* Sticky, never auto-hiding: every control stays reachable after any
          amount of scrolling (CLAUDE.md Mobile Rules). */}
      <header
        data-testid="quran-toolbar"
        className="grain safe-top safe-x sticky top-0 z-30 border-b border-bd bg-bg2/95 backdrop-blur print:hidden"
      >
        <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center gap-1 px-2 py-2 sm:px-4">
          <Link href="/quran" className="ibtn" aria-label="سۈرە تىزىملىكىگە قايتىش" data-testid="quran-back">
            <Icon name="undo" className="ic-lg" />
          </Link>
          <button
            type="button"
            className="ibtn lg:hidden"
            data-testid="sura-drawer-open"
            aria-label="سۈرە تاللاش"
            aria-expanded={drawerOpen}
            onClick={() => setDrawerOpen(true)}
          >
            <Icon name="list" className="ic-lg" />
          </button>

          <h1 className="min-w-0 flex-1 truncate text-[14px] font-bold">
            <span className="quran-face text-[18px]">{sura.name_ar}</span>
            <span className="ms-2 text-ink2">{sura.name_ug}</span>
          </h1>

          <button
            type="button"
            className="ibtn"
            data-testid="quran-font-decrease"
            aria-label="خەت چوڭلۇقىنى كىچىكلىتىش"
            disabled={settings.fontSize <= MIN_FONT_SIZE}
            onClick={() => updateSettingsStore({ fontSize: settings.fontSize - 2 })}
          >
            <span className="text-[15px] font-bold">A−</span>
          </button>
          <button
            type="button"
            className="ibtn"
            data-testid="quran-font-increase"
            aria-label="خەت چوڭلۇقىنى چوڭايتىش"
            disabled={settings.fontSize >= MAX_FONT_SIZE}
            onClick={() => updateSettingsStore({ fontSize: settings.fontSize + 2 })}
          >
            <span className="text-[15px] font-bold">A+</span>
          </button>
          <ThemeToggle initial={theme} />
          <button
            type="button"
            className="hbtn"
            data-testid="translation-toggle"
            title={TRANSLATION_LABELS[nextMode]}
            aria-label={`كۆرسىتىش ھالىتى (ھازىر: ${TRANSLATION_LABELS[mode]})`}
            onClick={() => setTranslationMode(nextMode)}
          >
            <Icon name="languages" />
            <span className="hidden sm:inline">{TRANSLATION_LABELS[mode]}</span>
          </button>
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-7xl flex-1 items-start gap-6 px-3 py-5 sm:px-5">
        {/* Desktop sura list — the drawer covers phones and tablets. */}
        <aside
          data-testid="sura-panel"
          className="sticky top-20 hidden max-h-[calc(100dvh-6rem)] w-72 shrink-0 overflow-y-auto overscroll-contain lg:block"
        >
          <SuraList suras={suras} activeSura={sura.number} />
        </aside>

        <main className="min-w-0 flex-1">
          <div className="paper px-3 py-5 sm:px-7 sm:py-7">
            <header className="border-b border-bd pb-5 text-center">
              <p className="quran-face text-am" style={{ fontSize: `${arabicSize}px`, lineHeight: 1.6 }}>
                سورة {sura.name_ar}
              </p>
              <p className="mt-1 text-[14px] text-ink2">
                {sura.name_ug} — {toArabicNumerals(sura.aya_count)} ئايەت
              </p>
              <p className="mt-1 text-[12px] text-ink3">{revelationLabel(sura.revelation)}</p>
            </header>

            {showsBasmala(sura.number) && (
              <p
                data-testid="basmala"
                className="quran-face mt-6 text-center text-ink"
                style={{ fontSize: `${arabicSize}px`, lineHeight: 2 }}
              >
                {BASMALA}
              </p>
            )}

            <div ref={containerRef} className="mt-5" data-testid="aya-container">
              {ayas.map((aya) => {
                const isSelected = selected === aya.aya;
                const bookmarked = bookmarks.has(aya.aya);
                return (
                  <article
                    key={aya.aya}
                    data-aya={aya.aya}
                    data-testid="aya"
                    className={`quran-aya ${isSelected ? "selected" : ""}`}
                  >
                    {/* Tapping anywhere on the verse opens its actions, but a
                        tap that only ends a text selection must not. The aya
                        number is a real button so the same reach exists for
                        the keyboard and for screen readers. */}
                    <div
                      data-testid="aya-body"
                      onClick={() => {
                        if (window.getSelection()?.isCollapsed === false) return;
                        toggleSelected(aya.aya);
                      }}
                    >
                      {mode !== "ug" && (
                        <p
                          className="quran-face quran-aya-ar"
                          data-testid="aya-arabic"
                          style={{ fontSize: `${arabicSize}px`, lineHeight: ARABIC_LINE_HEIGHT }}
                        >
                          {aya.text_ar}
                          <AyaNumber
                            aya={aya.aya}
                            expanded={isSelected}
                            onToggle={() => toggleSelected(aya.aya)}
                          />
                        </p>
                      )}
                      {mode !== "ar" && aya.text_ug && (
                        <p
                          className="quran-aya-ug"
                          data-testid="aya-uyghur"
                          style={{
                            fontSize: `${translationSize}px`,
                            lineHeight: settings.lineHeight,
                          }}
                        >
                          {mode === "ug" && (
                            <AyaNumber
                              aya={aya.aya}
                              expanded={isSelected}
                              onToggle={() => toggleSelected(aya.aya)}
                            />
                          )}
                          {aya.text_ug}
                        </p>
                      )}
                    </div>

                    {isSelected && (
                      <div className="mt-2 flex flex-wrap gap-1.5 border-t border-bd pt-2" data-testid="aya-actions">
                        <button
                          type="button"
                          className="hbtn"
                          data-testid="copy-arabic"
                          onClick={() => void copySelected(false, aya)}
                        >
                          <Icon name="copy" />
                          ئايەتنى كۆچۈرۈش
                        </button>
                        <button
                          type="button"
                          className="hbtn"
                          data-testid="copy-with-translation"
                          disabled={!aya.text_ug}
                          onClick={() => void copySelected(true, aya)}
                        >
                          <Icon name="copy" />
                          تەرجىمىسى بىلەن
                        </button>
                        {signedIn && (
                          <button
                            type="button"
                            className={bookmarked ? "hbtn on" : "hbtn"}
                            data-testid="aya-bookmark"
                            aria-pressed={bookmarked}
                            onClick={() => void toggleBookmark(aya.aya)}
                          >
                            <Icon name="bookmark" />
                            {bookmarked ? "خەتكۈچتە بار" : "خەتكۈچكە قوشۇش"}
                          </button>
                        )}
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          </div>

          <nav className="mt-4 flex items-center justify-between gap-2" aria-label="سۈرە ئارىلىقىدا يۆتكىلىش">
            {previous ? (
              <Link href={`/quran/${previous.number}`} className="hbtn" data-testid="prev-sura">
                <Icon name="undo" />
                {previous.name_ug}
              </Link>
            ) : (
              <span />
            )}
            {next ? (
              <Link href={`/quran/${next.number}`} className="hbtn" data-testid="next-sura">
                {next.name_ug}
                <Icon name="redo" />
              </Link>
            ) : (
              <span />
            )}
          </nav>
        </main>
      </div>

      {/* Sticky (not fixed) so it takes part in layout flow and can never
          cover the last aya. */}
      <div className="safe-bottom safe-x sticky bottom-0 z-20 border-t border-bd bg-bg2/95 backdrop-blur print:hidden">
        <form
          className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-center gap-2 px-3 py-2"
          onSubmit={jump}
        >
          <button
            type="button"
            className="ibtn"
            aria-label="بېشىغا"
            onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
          >
            <Icon name="align-right" />
          </button>
          <label className="text-[12.5px] text-ink3" htmlFor="jump-sura">
            سۈرە
          </label>
          <input
            id="jump-sura"
            name="sura"
            type="number"
            min={1}
            max={114}
            dir="ltr"
            defaultValue={sura.number}
            className="field w-20 text-center"
            data-testid="jump-sura"
          />
          <label className="text-[12.5px] text-ink3" htmlFor="jump-aya">
            ئايەت
          </label>
          <input
            id="jump-aya"
            name="aya"
            type="number"
            min={1}
            dir="ltr"
            className="field w-20 text-center"
            data-testid="jump-aya"
          />
          <button type="submit" className="hbtn" data-testid="jump-go">
            ئاتلاش
          </button>
        </form>
      </div>

      <p
        role="status"
        aria-live="polite"
        data-testid="quran-toast"
        className={`safe-bottom pointer-events-none fixed inset-x-0 bottom-20 z-40 mx-auto w-fit max-w-[92vw] rounded-full bg-at px-4 py-2 text-center text-[13px] text-bg shadow-[var(--shadow-2)] transition-opacity duration-200 ${
          toast ? "opacity-100" : "opacity-0"
        }`}
      >
        {toast}
      </p>

      {/* Mobile sura drawer */}
      <div
        data-testid="sura-drawer-overlay"
        aria-hidden="true"
        onClick={() => setDrawerOpen(false)}
        className={`fixed inset-0 z-40 bg-black/45 transition-[opacity,visibility] duration-200 lg:hidden ${
          drawerOpen ? "visible opacity-100" : "invisible opacity-0"
        }`}
      />
      <aside
        data-testid="sura-drawer"
        role="dialog"
        aria-modal="true"
        aria-label="سۈرىلەر"
        inert={!drawerOpen}
        className={`grain safe-top fixed inset-y-0 start-0 z-50 flex h-dvh w-[85vw] max-w-80 flex-col border-e border-bd bg-bg shadow-[var(--shadow-2)] transition-[transform,visibility] duration-200 lg:hidden ${
          drawerOpen ? "visible translate-x-0" : "invisible translate-x-full"
        }`}
      >
        <div className="flex h-16 shrink-0 items-center justify-between border-b border-bd px-3">
          <span className="flex items-center gap-2 text-[15px] font-bold">
            <Icon name="mosque" className="text-am" />
            سۈرىلەر
          </span>
          <button
            type="button"
            ref={drawerCloseRef}
            className="ibtn"
            data-testid="sura-drawer-close"
            aria-label="تىزىملىكنى تاقاش"
            onClick={() => setDrawerOpen(false)}
          >
            <Icon name="x" className="ic-lg" />
          </button>
        </div>
        <div className="safe-bottom flex-1 overflow-y-auto overscroll-contain p-4">
          <SuraList
            suras={suras}
            activeSura={sura.number}
            onNavigate={() => setDrawerOpen(false)}
          />
        </div>
      </aside>
    </div>
  );
}
