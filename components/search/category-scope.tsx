"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { Icon, type IconName } from "@/components/icons";
import type { Category } from "@/lib/types";

/**
 * Which part of the library the next search will look in — chosen BEFORE the
 * search runs, from inside the box itself.
 *
 * Until now the only category filter lived on /search, so a reader could only
 * narrow a search they had already run across the whole library. This puts the
 * choice where the question is asked.
 *
 * WITHOUT JAVASCRIPT this control is inert and no `cat` field is submitted, so
 * the box behaves exactly as it always has: it submits `q` and searches
 * everything. The hidden field below is written by React and only exists once
 * React is running — which is also why a search fired in the split second
 * before hydration searches the whole library rather than something arbitrary.
 * The alternative, a native <select> as the base, cannot be made to look like
 * the sidebar the owner asked for, and swapping one for the other on hydration
 * either flashes or means pixel-matching a native control across three themes.
 */

/** What the button says when nothing is chosen. */
const ALL_LABEL = "بارلىق كىتابلار";
/** What the first row of the panel says — the sidebar's own wording. */
const ALL_ROW_LABEL = "ھەممە كىتابلار";

export function CategoryScope({
  categories,
  counts,
  value = null,
  variant = "sbox",
  collapseLabel = false,
  testId = "search-scope",
}: {
  categories: Category[];
  /** Published books per category, already rolled up the tree. */
  counts: Record<number, number>;
  /** The category the surrounding page is already filtered by, if any. */
  value?: number | null;
  /** `sbox` hangs off the header's rounded pill; `field` is the page-level row. */
  variant?: "sbox" | "field";
  /**
   * Show the icon and chevron alone until `lg`. Only the header's own form
   * asks for this: below 1024 px that row still carries the menu button, and
   * a full label there would squeeze the input to nothing.
   */
  collapseLabel?: boolean;
  testId?: string;
}) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<number | null>(value);
  /** Set when the panel was opened with a key, so a row takes the focus. */
  const pendingFocus = useRef<1 | -1 | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const pathname = usePathname();

  // The page below decided this scope (only /search does), so follow it.
  const [prevValue, setPrevValue] = useState(value);
  if (prevValue !== value) {
    setPrevValue(value);
    setSelected(value);
  }

  /**
   * Navigating away closes the panel and puts the scope back where the page
   * says it should be — for the header, «بارلىق كىتابلار». That is the
   * owner's decision: the box offers the whole library on every page and never
   * quietly inherits the category being browsed.
   */
  const [prevPathname, setPrevPathname] = useState(pathname);
  if (prevPathname !== pathname) {
    setPrevPathname(pathname);
    setOpen(false);
    setSelected(value);
  }

  // Outside tap and Escape — the same pair the history dropdown uses, so the
  // two layers in this one box behave identically.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!wrapperRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      buttonRef.current?.focus();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const current =
    selected === null ? null : (categories.find((item) => item.id === selected) ?? null);
  const label = current ? current.name : ALL_LABEL;
  const iconName = (current ? current.icon || "folder" : "layers") as IconName;

  /** Move focus between the rows a reader may actually pick. */
  const moveFocus = useCallback((step: 1 | -1) => {
    const rows = [
      ...(panelRef.current?.querySelectorAll<HTMLButtonElement>("[role=option]") ?? []),
    ].filter((row) => row.getAttribute("aria-disabled") !== "true");
    if (rows.length === 0) return;
    const index = rows.indexOf(document.activeElement as HTMLButtonElement);
    const next =
      index < 0 ? (step === 1 ? 0 : rows.length - 1) : (index + step + rows.length) % rows.length;
    rows[next]?.focus();
  }, []);

  /**
   * An arrow key on the button opens the panel AND lands on a row.
   *
   * The move has to wait for the rows to exist, and an effect is the only
   * thing that reliably does: it runs after React has committed. A
   * requestAnimationFrame here raced the commit and left focus on the button.
   */
  useEffect(() => {
    if (!open) return;
    const step = pendingFocus.current;
    pendingFocus.current = null;
    if (step) moveFocus(step);
  }, [open, moveFocus]);

  function choose(categoryId: number | null) {
    setSelected(categoryId);
    setOpen(false);
    buttonRef.current?.focus();
  }

  const topLevel = categories.filter((category) => category.parent_id === null);
  const childrenOf = (parentId: number) =>
    categories.filter((category) => category.parent_id === parentId);

  /**
   * Nothing at all came back means the counts are UNKNOWN, not zero. A read
   * that failed must not grey out every category and leave a reader with a
   * picker that can pick nothing; it shows no numbers instead, and everything
   * stays choosable.
   */
  const countOf = (categoryId: number): number | null =>
    Object.keys(counts).length === 0 ? null : (counts[categoryId] ?? 0);

  return (
    <div ref={wrapperRef} className={variant === "sbox" ? "contents" : "relative w-full sm:w-auto"}>
      {/* The only field this control owns. Absent while «بارلىق كىتابلار» is
          chosen, so the submitted URL stays /search?q=… with nothing added. */}
      {selected !== null && <input type="hidden" name="cat" value={selected} />}

      <button
        type="button"
        ref={buttonRef}
        data-testid={testId}
        data-scope={selected === null ? "all" : String(selected)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`ئىزدەش دائىرىسى: ${label}`}
        title={label}
        className={
          variant === "sbox"
            ? "flex min-h-11 min-w-0 items-center gap-1.5 border-s border-bd ps-2 text-[12.5px] text-ink2 hover:text-ink"
            : "field flex min-h-11 w-full items-center gap-2 text-[14px] text-ink2 hover:text-ink sm:w-auto"
        }
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
          event.preventDefault();
          const step = event.key === "ArrowDown" ? 1 : -1;
          // Already open: the rows are there to move to. Otherwise the effect
          // above does it, once React has put them on the screen.
          if (open) return moveFocus(step);
          pendingFocus.current = step;
          setOpen(true);
        }}
      >
        <Icon name={iconName} className={current ? "text-am" : "text-ink3"} />
        <span
          className={`min-w-0 max-w-28 truncate ${
            collapseLabel ? "hidden lg:inline-block" : "inline-block"
          }`}
        >
          {label}
        </span>
        <Icon name="chevron-down" className="ic-sm shrink-0 text-ink3" />
      </button>

      {open && (
        <div
          ref={panelRef}
          data-testid={`${testId}-panel`}
          role="listbox"
          aria-label="ئىزدەش دائىرىسى"
          /*
           * Anchored to the inline-end of the box, where the button is. For the
           * header the wrapper is `display: contents`, so this hangs off the
           * .sbox pill itself, which is already positioned; on /search the
           * wrapper spans the whole row below `sm`, so the panel can never
           * reach past the edge of a 360 px screen.
           */
          className={`paper absolute top-full z-40 mt-1.5 max-h-[min(60dvh,22rem)] overflow-y-auto overscroll-contain py-1 shadow-[var(--shadow-2)] ${
            variant === "sbox" ? "end-0 w-[min(17rem,100%)]" : "inset-x-0 sm:inset-x-auto sm:end-0 sm:w-72"
          }`}
          onKeyDown={(event) => {
            if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
            event.preventDefault();
            moveFocus(event.key === "ArrowDown" ? 1 : -1);
          }}
        >
          <ScopeRow
            icon="layers"
            name={ALL_ROW_LABEL}
            count={null}
            selected={selected === null}
            onChoose={() => choose(null)}
            testId={`${testId}-all`}
          />
          <ul>
            {topLevel.map((category) => (
              <li key={category.id}>
                <ScopeRow
                  icon={(category.icon || "folder") as IconName}
                  name={category.name}
                  count={countOf(category.id)}
                  selected={selected === category.id}
                  onChoose={() => choose(category.id)}
                  categoryId={category.id}
                  testId={`${testId}-option`}
                />
                {childrenOf(category.id).length > 0 && (
                  <ul className="ms-4 mt-0.5 space-y-0.5 border-s border-bd ps-2">
                    {childrenOf(category.id).map((child) => (
                      <li key={child.id}>
                        <ScopeRow
                          icon={(child.icon || "folder") as IconName}
                          name={child.name}
                          count={countOf(child.id)}
                          selected={selected === child.id}
                          onChoose={() => choose(child.id)}
                          categoryId={child.id}
                          testId={`${testId}-option`}
                        />
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/**
 * One row, built to the sidebar's measurements: the same icon in --am, the
 * same 44 px height, the same radius, the same hover. A category holding
 * nothing is shown and not hidden — the owner wants to see that it exists and
 * is empty — but it cannot be chosen, because choosing it could only ever
 * return nothing.
 */
function ScopeRow({
  icon,
  name,
  count,
  selected,
  onChoose,
  categoryId,
  testId,
}: {
  icon: IconName;
  name: string;
  /** null on «ھەممە كىتابلار», which counts nothing because it excludes nothing. */
  count: number | null;
  selected: boolean;
  onChoose: () => void;
  categoryId?: number;
  testId: string;
}) {
  const empty = count === 0;
  return (
    <button
      type="button"
      role="option"
      data-testid={testId}
      {...(categoryId === undefined ? {} : { "data-category-id": String(categoryId) })}
      aria-selected={selected}
      {...(empty ? { "aria-disabled": true } : {})}
      className={`flex min-h-11 w-full items-center gap-2.5 rounded-[var(--radius)] px-3 py-2 text-start text-[14px] ${
        empty ? "cursor-default text-ink2 opacity-50" : "text-ink2 hover:bg-bg2 hover:text-ink"
      } ${selected ? "bg-ab font-semibold text-ink" : ""}`}
      onClick={() => {
        if (empty) return;
        onChoose();
      }}
    >
      <Icon name={icon} className="text-am" />
      <span className="min-w-0 flex-1 truncate">{name}</span>
      {selected && <Icon name="check" className="shrink-0 text-am" />}
      {count !== null && <span className="shrink-0 text-[12px] tabular-nums text-ink3">{count}</span>}
    </button>
  );
}
