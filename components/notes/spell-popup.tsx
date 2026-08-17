"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Icon } from "@/components/icons";
import type { SpellPopupState } from "@/components/notes/use-spellcheck";

/** Kept clear of the viewport edges and of the sticky toolbar above. */
const EDGE = 8;
const GAP = 6;
/** The notebook's toolbar is roughly this tall at its tallest (two rows). */
const TOOLBAR_ALLOWANCE = 104;

/**
 * The corrections for one word, anchored at the word itself.
 *
 * Fixed positioning, in viewport coordinates, because the anchor comes from
 * `getBoundingClientRect` and the editor scrolls inside the page. It prefers to
 * sit below the word and flips above when there is no room — which on a phone
 * is most of the time, since the on-screen keyboard takes the bottom half of
 * the screen and `visualViewport` is the only thing that knows how much.
 */
export function SpellPopup({
  state,
  onPick,
  onAdd,
  onClose,
}: {
  state: SpellPopupState;
  onPick: (replacement: string) => void;
  onAdd: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<React.CSSProperties>({
    position: "fixed",
    top: -9999,
    insetInlineStart: 0,
    visibility: "hidden",
  });

  // Measure, then place. Placing from the anchor alone would guess the popup's
  // height, and a wrong guess is what puts it under the keyboard.
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;

    const viewport = window.visualViewport;
    const viewTop = viewport?.offsetTop ?? 0;
    const viewHeight = viewport?.height ?? window.innerHeight;
    const viewWidth = viewport?.width ?? window.innerWidth;
    const box = node.getBoundingClientRect();

    // Never above the toolbar, never below the keyboard.
    const topLimit = viewTop + TOOLBAR_ALLOWANCE + EDGE;
    const bottomLimit = viewTop + viewHeight - EDGE;

    let top = state.rect.bottom + GAP;
    if (top + box.height > bottomLimit) {
      const above = state.rect.top - GAP - box.height;
      top = above >= topLimit ? above : Math.max(topLimit, bottomLimit - box.height);
    }
    top = Math.min(Math.max(top, topLimit), Math.max(topLimit, bottomLimit - box.height));

    // Centre on the word, then pull inside the viewport. Physical left is
    // correct here: this is a viewport coordinate, not a text direction.
    let left = state.rect.left + (state.rect.right - state.rect.left) / 2 - box.width / 2;
    left = Math.min(Math.max(left, EDGE), Math.max(EDGE, viewWidth - box.width - EDGE));

    setStyle({
      position: "fixed",
      top,
      left,
      maxHeight: Math.max(120, bottomLimit - top),
      visibility: "visible",
    });
  }, [state.rect]);

  // Outside tap closes. Pointerdown rather than click so it fires before the
  // editor's own handler re-opens a popup for the same word.
  useEffect(() => {
    const onDown = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={`«${state.mark.word}» ئۈچۈن تەكلىپلەر`}
      data-testid="spell-popup"
      style={style}
      className="z-50 w-[min(19rem,calc(100vw-1rem))] overflow-y-auto overscroll-contain rounded-[var(--radius)] border border-bd2 bg-bg2 shadow-lg"
    >
      <div className="flex items-center gap-2 border-b border-bd px-3 py-2">
        <span className="min-w-0 flex-1 truncate text-[13px] font-bold" data-testid="spell-popup-word">
          {state.mark.word}
        </span>
        <button
          type="button"
          className="ibtn shrink-0"
          aria-label="تاقاش"
          data-testid="spell-popup-close"
          onClick={onClose}
        >
          <Icon name="x" />
        </button>
      </div>

      {state.loading ? (
        <p className="px-3 py-3 text-[13px] text-ink3" data-testid="spell-popup-loading">
          ئىزدەۋاتىدۇ…
        </p>
      ) : state.suggestions.length === 0 ? (
        <p className="px-3 py-3 text-[13px] text-ink2" data-testid="spell-popup-empty">
          تەكلىپ تېپىلمىدى.
        </p>
      ) : (
        <ul data-testid="spell-popup-list">
          {state.suggestions.map((suggestion, index) => (
            <li key={suggestion}>
              <button
                type="button"
                data-testid="spell-suggestion"
                // ≥44px tall, and the whole row is the target — a phone tap
                // must not have to find a word-sized hit area.
                className="flex min-h-[44px] w-full items-center px-3 py-2 text-start text-[14px] hover:bg-ab focus:bg-ab focus:outline-none"
                // Keep the editor's selection alive until the command runs.
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => onPick(suggestion)}
              >
                <span className="flex-1">{suggestion}</span>
                {index === 0 && (
                  <span className="ms-2 shrink-0 text-[11px] text-ink3">ئەڭ يېقىن</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="border-t border-bd">
        <button
          type="button"
          data-testid="spell-popup-add"
          className="flex min-h-[44px] w-full items-center gap-2 px-3 py-2 text-start text-[13px] hover:bg-ab focus:bg-ab focus:outline-none"
          onMouseDown={(event) => event.preventDefault()}
          onClick={onAdd}
        >
          <Icon name="plus" className="shrink-0 text-am" />
          لۇغەتكە قوش
        </button>
      </div>
    </div>
  );
}
