"use client";

import { useEffect, useRef } from "react";
import { Icon, type IconName } from "@/components/icons";

export type ToolMenuItem = {
  testId: string;
  icon: IconName;
  label: string;
  checked: boolean;
  onSelect: () => void;
};

/**
 * A toolbar control that opens a short list of choices — the block style, the
 * kind of list.
 *
 * Tap only: it opens on a tap and closes on a choice, an outside tap or
 * Escape, never on hover. Neither the button nor a choice takes focus on the
 * way down, so the selection in the note is still there when the command
 * runs — the same rule as every other toolbar button. The list drops below
 * the button, inside the sticky header, and scrolls inside itself if a short
 * screen ever needs it to.
 */
export function ToolMenu({
  testId,
  label,
  icon,
  open,
  onOpenChange,
  items,
  state,
}: {
  testId: string;
  label: string;
  /** What the button shows — the style the caret is in, for the block menu. */
  icon: IconName;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: ToolMenuItem[];
  /** Exposed as `data-style`, so what the button shows can be asserted. */
  state?: string;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) onOpenChange(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onOpenChange(false);
    };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onOpenChange]);

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        className={open ? "ibtn bg-bg3 text-ink" : "ibtn"}
        title={label}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        data-testid={testId}
        data-style={state}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => onOpenChange(!open)}
      >
        <Icon name={icon} className="ic-lg" />
        <Icon name="chevron-down" className="ic-sm -ms-0.5" />
      </button>
      {open && (
        <div
          role="menu"
          aria-label={label}
          data-testid={`${testId}-menu`}
          // Opens toward the start of the line from its button's far edge,
          // which keeps it on a 360 px screen wherever the button sits.
          className="absolute end-0 top-full z-40 mt-1 max-h-[60dvh] w-48 max-w-[calc(100vw-1.5rem)] overflow-y-auto overscroll-contain rounded-[var(--radius)] border border-bd2 bg-bg2 py-1 shadow-lg"
        >
          {items.map((item) => (
            <button
              key={item.testId}
              type="button"
              role="menuitemradio"
              aria-checked={item.checked}
              data-testid={item.testId}
              className="flex min-h-11 w-full items-center gap-2.5 px-3 text-start text-[14px] text-ink hover:bg-ab focus:bg-ab focus:outline-none"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                onOpenChange(false);
                item.onSelect();
              }}
            >
              <Icon name={item.icon} className="ic-lg shrink-0 text-ink2" />
              <span className="flex-1">{item.label}</span>
              {item.checked && <Icon name="check" className="shrink-0 text-am" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
