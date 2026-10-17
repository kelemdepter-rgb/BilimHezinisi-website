"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { Icon } from "@/components/icons";
import { UNPLACED, placeAnchored, useDismiss } from "@/components/notes/anchored";
import type { SpellPopupState } from "@/components/notes/use-spellcheck";

/**
 * The corrections for one word, anchored at the word itself.
 *
 * Fixed positioning, in viewport coordinates, because the anchor comes from
 * `getBoundingClientRect` and the editor scrolls inside the page. It prefers to
 * sit below the word and flips above when there is no room — see
 * components/notes/anchored.ts, which the link card shares.
 */
export function SpellPopup({
  state,
  onPick,
  onIgnore,
  onAdd,
  onClose,
}: {
  state: SpellPopupState;
  onPick: (replacement: string) => void;
  /** «بۇ خاتىرىدە سەل قارا» — right in this note only. */
  onIgnore: () => void;
  /** «لۇغەتكە قوش» — right everywhere, in the personal dictionary. */
  onAdd: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<React.CSSProperties>(UNPLACED);

  // Measure, then place.
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    setStyle(placeAnchored(node.getBoundingClientRect(), state.rect, state.clearTop));
  }, [state.rect, state.clearTop]);

  useDismiss(ref, onClose);

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
          data-testid="spell-popup-ignore"
          className="flex min-h-[44px] w-full items-center gap-2 px-3 py-2 text-start text-[13px] hover:bg-ab focus:bg-ab focus:outline-none"
          onMouseDown={(event) => event.preventDefault()}
          onClick={onIgnore}
        >
          <Icon name="eye-off" className="shrink-0 text-am" />
          بۇ خاتىرىدە سەل قارا
        </button>
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
