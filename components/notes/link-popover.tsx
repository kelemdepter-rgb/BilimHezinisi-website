"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { Icon } from "@/components/icons";
import { UNPLACED, placeAnchored, useDismiss, type AnchorRect } from "@/components/notes/anchored";
import type { LinkDescription } from "@/lib/notes/links";

export type LinkPopoverState = {
  /** The link itself, live: the card follows it and goes when it does. */
  link: HTMLAnchorElement;
  text: string;
  where: LinkDescription;
  rect: AnchorRect;
  clearTop: number;
};

/** Every row of the card: a whole-width target at least 44 px tall. */
const ROW =
  "flex min-h-[44px] w-full items-center gap-2 px-3 py-2 text-start text-[13.5px] hover:bg-ab focus:bg-ab focus:outline-none";

/**
 * A tap on a link in the note (PROMPT-49): what it says, where it goes, and
 * the two things to do with it — open it in a new tab, or take the link away
 * and keep its text. Anchored like the spell popup (components/notes/
 * anchored.ts): it follows the link while the link can be seen, and closes
 * on an outside tap, Escape or an edit.
 *
 * Only the destinations lib/notes/links.ts allows get «ئېچىش»; anything else
 * is shown as written, with a line saying it cannot be opened.
 */
export function LinkPopover({
  state,
  editable,
  onOpen,
  onUnlink,
  onClose,
}: {
  state: LinkPopoverState;
  /** False while the note holds still: then the link can be opened, not changed. */
  editable: boolean;
  onOpen: () => void;
  onUnlink: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<React.CSSProperties>(UNPLACED);

  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    setStyle(placeAnchored(node.getBoundingClientRect(), state.rect, state.clearTop));
  }, [state.rect, state.clearTop]);

  useDismiss(ref, onClose);

  const { where } = state;
  const blocked = where.url === null;

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="ئۇلىنىش"
      data-testid="link-popover"
      data-kind={where.kind}
      style={style}
      className="z-50 w-[min(19rem,calc(100vw-1rem))] overflow-y-auto overscroll-contain rounded-[var(--radius)] border border-bd2 bg-bg2 shadow-lg"
    >
      <div className="flex items-start gap-2 border-b border-bd ps-3 pe-1 py-1">
        <div className="min-w-0 flex-1 py-1.5">
          <p className="text-[13px] font-bold leading-6 [overflow-wrap:anywhere]" data-testid="link-popover-text">
            {state.text}
          </p>
          <p
            className="text-[12.5px] leading-6 text-ink2 [overflow-wrap:anywhere]"
            data-testid="link-popover-where"
            // An address shown as written reads left to right; a description is Uyghur.
            dir={blocked ? "ltr" : undefined}
          >
            {where.label}
          </p>
        </div>
        <button
          type="button"
          className="ibtn shrink-0"
          aria-label="تاقاش"
          data-testid="link-popover-close"
          onClick={onClose}
        >
          <Icon name="x" />
        </button>
      </div>

      {blocked && (
        <p className="border-b border-bd px-3 py-2 text-[12.5px] leading-6 text-ink3" data-testid="link-popover-blocked">
          بۇ ئۇلىنىشنى ئاچقىلى بولمايدۇ.
        </p>
      )}

      {(!blocked || editable) && (
        <div>
          {!blocked && (
            <button type="button" className={ROW} data-testid="link-open" onClick={onOpen}>
              <Icon name="external-link" className="shrink-0 text-am" />
              ئېچىش
            </button>
          )}
          {editable && (
            <button
              type="button"
              className={ROW}
              data-testid="link-unlink"
              // The note keeps its focus: the command runs on it at once.
              onMouseDown={(event) => event.preventDefault()}
              onClick={onUnlink}
            >
              <Icon name="unlink" className="shrink-0 text-am" />
              ئۇلىنىشنى ئېلىۋېتىش
            </button>
          )}
        </div>
      )}
    </div>
  );
}
