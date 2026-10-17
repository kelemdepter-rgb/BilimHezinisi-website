"use client";

import { Icon } from "@/components/icons";

export const PAINTER_TITLE = "فورمات سۈپۈرگىسى";
/** The first tap, with nothing selected. */
export const PAINTER_NEEDS_SOURCE = "ئاۋۋال فورماتى ئېلىنىدىغان تېكىستنى تاللاڭ.";
const PAINTER_HINT = "ئەمدى فورمات بېرىدىغان تېكىستنى تاللاپ، «فورماتنى بېرىش» نى بېسىڭ.";
const PAINTER_NEEDS_TARGET = "ئاۋۋال فورمات بېرىدىغان تېكىستنى تاللاڭ.";

/**
 * The format painter, once it holds a format (PROMPT-49, N24): what to do
 * next, and the second tap that does it.
 *
 * Two taps rather than the desktop's paint-on-release, because a phone
 * cannot paint while selecting: the writer selects the text, then presses
 * «فورماتنى بېرىش». A row in the sticky header, like the find bar and the
 * spelling row, so the button is in reach wherever in a long note the text
 * to paint is — and never open by default, so the phone header keeps its
 * two rows (PROMPT-45) until the painter is picked up.
 */
export function PainterBar({
  armed,
  needsTarget,
  onApply,
  onCancel,
}: {
  armed: boolean;
  /** «فورماتنى بېرىش» was pressed with nothing selected. */
  needsTarget: boolean;
  onApply: () => void;
  onCancel: () => void;
}) {
  if (!armed) return null;

  return (
    <div className="border-t border-bd px-2 py-1.5 sm:px-4" data-testid="painter-bar" role="group" aria-label={PAINTER_TITLE}>
      <div className="mx-auto flex w-full max-w-4xl flex-wrap items-center gap-1.5">
        <p className="min-w-0 flex-1 basis-56 px-1 text-[12.5px] leading-5 text-ink2" role="status" data-testid="painter-hint">
          {needsTarget ? PAINTER_NEEDS_TARGET : PAINTER_HINT}
        </p>
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            className="btn-am"
            data-testid="painter-apply"
            // The selection to paint is still there when the command runs.
            onMouseDown={(event) => event.preventDefault()}
            onClick={onApply}
          >
            <Icon name="paint-roller" />
            فورماتنى بېرىش
          </button>
          <button
            type="button"
            className="hbtn"
            data-testid="painter-cancel"
            onMouseDown={(event) => event.preventDefault()}
            onClick={onCancel}
          >
            بىكار قىلىش
          </button>
        </div>
      </div>
    </div>
  );
}
