"use client";

import { Icon } from "@/components/icons";
import type { SpellStatus } from "@/lib/spellcheck/client";
import type { SpellNav } from "@/components/notes/use-spellcheck";

/**
 * «بىر-بىرلەپ كۆرۈش» — the spelling errors of a note, one at a time.
 *
 * A row in the sticky header, like the find bar, and for the same reason: on
 * a phone a floating box lands on the very text being read. It is never open
 * by default, so the header keeps its two rows (PROMPT-45) until a writer
 * asks for it. Each step scrolls the word to the middle of the screen and
 * opens its corrections, so a long note can be gone through with one thumb:
 * «كېيىنكى», a correction, «كېيىنكى».
 *
 * No keyboard shortcut: F7 is what Chrome and Firefox use for caret browsing,
 * and they answer it with a dialog of their own.
 */
export function SpellNavBar({
  nav,
  status,
  total,
  onStep,
  onClose,
}: {
  nav: SpellNav;
  status: SpellStatus;
  total: number;
  onStep: (direction: 1 | -1) => void;
  onClose: () => void;
}) {
  if (!nav.open) return null;
  const ready = status === "ready";

  return (
    <div
      className="border-t border-bd px-2 py-1.5 sm:px-4"
      data-testid="spell-nav"
      role="group"
      aria-label="ئىملا خاتالىقلىرىنى بىر-بىرلەپ كۆرۈش"
    >
      <div className="mx-auto flex w-full max-w-4xl items-center gap-1.5">
        {nav.done ? (
          <p className="min-w-0 flex-1 px-1 text-[13px] text-ink2" role="status" data-testid="spell-nav-done">
            ئىملا خاتالىقى قالمىدى.
          </p>
        ) : (
          <>
            <NavButton
              testId="spell-nav-prev"
              icon="chevron-up"
              label="ئالدىنقى"
              disabled={!ready || total === 0}
              onClick={() => onStep(-1)}
            />
            <span
              className="min-w-[3.5rem] whitespace-nowrap px-1 text-center text-[12.5px] tabular-nums text-ink2"
              data-testid="spell-nav-count"
              role="status"
            >
              {ready ? `${nav.at} / ${total}` : status === "failed" ? "—" : "…"}
            </span>
            <NavButton
              testId="spell-nav-next"
              icon="chevron-down"
              label="كېيىنكى"
              disabled={!ready || total === 0}
              onClick={() => onStep(1)}
            />
            <span className="flex-1" />
          </>
        )}
        <button type="button" className="ibtn" data-testid="spell-nav-close" aria-label="تاقاش" onClick={onClose}>
          <Icon name="x" className="ic-lg" />
        </button>
      </div>
    </div>
  );
}

function NavButton({
  testId,
  icon,
  label,
  disabled,
  onClick,
}: {
  testId: string;
  icon: "chevron-up" | "chevron-down";
  label: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="hbtn px-2.5"
      data-testid={testId}
      disabled={disabled}
      // The note keeps its caret and its focus: a phone's keyboard neither
      // rises nor falls under the writer's thumb between two steps.
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
    >
      <Icon name={icon} />
      {label}
    </button>
  );
}
