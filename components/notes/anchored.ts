"use client";

import { useEffect, useRef } from "react";

/**
 * A small box anchored to something in the note — a misspelled word, a link.
 *
 * Both the spell popup and the link card (PROMPT-49) follow the same rules,
 * set by PROMPT-45 for the spell popup and kept in one place so the two can
 * never drift apart:
 *
 *  - placed in viewport coordinates, measured first, below the anchor and
 *    flipped above it when there is no room — which on a phone is most of the
 *    time, since the keyboard takes the bottom half of the screen and only
 *    `visualViewport` knows how much;
 *  - never over the sticky toolbar, never under the keyboard;
 *  - it follows its anchor on scroll and resize, of the page and of the
 *    visual viewport, at most once a frame, and goes only when the anchor has
 *    left the part of the page that can be seen.
 */

/** Kept clear of the viewport edges and of the sticky toolbar above. */
const EDGE = 8;
const GAP = 6;

/** Where the anchor is, in viewport coordinates. */
export type AnchorRect = { top: number; bottom: number; left: number; right: number };

/** The part of the page something can be seen in, in viewport coordinates. */
export function visibleArea(toolbar: HTMLElement | null): { top: number; bottom: number } {
  const viewport = window.visualViewport;
  const viewTop = viewport?.offsetTop ?? 0;
  const viewBottom = viewTop + (viewport?.height ?? window.innerHeight);
  const toolbarBottom = toolbar?.getBoundingClientRect().bottom ?? 0;
  return { top: Math.max(viewTop, toolbarBottom), bottom: viewBottom };
}

/** A DOMRect as the plain anchor the boxes keep in state. */
export function anchorRect(box: DOMRect): AnchorRect {
  return { top: box.top, bottom: box.bottom, left: box.left, right: box.right };
}

/**
 * Where a box of `size` goes for `anchor`. Placing from the anchor alone would
 * guess the box's height, and a wrong guess is what puts it under the keyboard
 * — so the caller measures the box first (hidden) and places it with this.
 */
export function placeAnchored(
  size: { width: number; height: number },
  anchor: AnchorRect,
  clearTop: number,
): React.CSSProperties {
  const viewport = window.visualViewport;
  const viewTop = viewport?.offsetTop ?? 0;
  const viewHeight = viewport?.height ?? window.innerHeight;
  const viewWidth = viewport?.width ?? window.innerWidth;

  // Never over the toolbar — measured, with the find bar or the overflow
  // open as much as without — and never below the keyboard.
  const topLimit = Math.max(viewTop, clearTop) + EDGE;
  const bottomLimit = viewTop + viewHeight - EDGE;

  let top = anchor.bottom + GAP;
  if (top + size.height > bottomLimit) {
    const above = anchor.top - GAP - size.height;
    top = above >= topLimit ? above : Math.max(topLimit, bottomLimit - size.height);
  }
  top = Math.min(Math.max(top, topLimit), Math.max(topLimit, bottomLimit - size.height));

  // Centre on the anchor, then pull inside the viewport. Physical left is
  // correct here: this is a viewport coordinate, not a text direction.
  let left = anchor.left + (anchor.right - anchor.left) / 2 - size.width / 2;
  left = Math.min(Math.max(left, EDGE), Math.max(EDGE, viewWidth - size.width - EDGE));

  return {
    position: "fixed",
    top,
    left,
    maxHeight: Math.max(120, bottomLimit - top),
    visibility: "visible",
  };
}

/** Before the box has been measured: in the tree, out of sight. */
export const UNPLACED: React.CSSProperties = {
  position: "fixed",
  top: -9999,
  insetInlineStart: 0,
  visibility: "hidden",
};

/**
 * Follow an anchor while `open`.
 *
 * The box's anchor is a snapshot of where the thing was. On a phone, tapping
 * the note focuses it, the keyboard rises and the page scrolls — so throwing
 * the box away on any scroll closed it the moment it opened (N16). Instead a
 * scroll or a resize, of the page or of the visual viewport the keyboard
 * shrinks, moves the anchor, at most once a frame; `onGone` is called only
 * when the anchor has left the visible part of the page, or the page itself
 * (a detached node measures 0 × 0).
 *
 * `measure` answers null when there is nothing to follow. The three callbacks
 * are read when an event arrives, so they may change on every render.
 */
export function useFollowAnchor(
  open: boolean,
  toolbarRef: React.RefObject<HTMLElement | null> | undefined,
  measure: () => DOMRect | null,
  onMove: (rect: AnchorRect, clearTop: number) => void,
  onGone: () => void,
) {
  const latest = useRef({ measure, onMove, onGone });
  useEffect(() => {
    latest.current = { measure, onMove, onGone };
  });

  useEffect(() => {
    if (!open) return;
    let frame = 0;
    const follow = () => {
      frame = 0;
      const box = latest.current.measure();
      if (!box) return;
      const view = visibleArea(toolbarRef?.current ?? null);
      const gone =
        (box.width === 0 && box.height === 0) || box.bottom <= view.top || box.top >= view.bottom;
      if (gone) {
        latest.current.onGone();
        return;
      }
      latest.current.onMove(anchorRect(box), view.top);
    };
    const schedule = () => {
      if (frame === 0) frame = requestAnimationFrame(follow);
    };
    const viewport = window.visualViewport;
    window.addEventListener("scroll", schedule, { passive: true, capture: true });
    window.addEventListener("resize", schedule);
    viewport?.addEventListener("resize", schedule);
    viewport?.addEventListener("scroll", schedule);
    return () => {
      if (frame !== 0) cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule, { capture: true });
      window.removeEventListener("resize", schedule);
      viewport?.removeEventListener("resize", schedule);
      viewport?.removeEventListener("scroll", schedule);
    };
  }, [open, toolbarRef]);
}

/**
 * Close on a tap outside `box`, or on Escape. Pointerdown rather than click,
 * so it fires before the note's own handler opens a box for the same tap.
 */
export function useDismiss(box: React.RefObject<HTMLElement | null>, onClose: () => void) {
  useEffect(() => {
    const onDown = (event: PointerEvent) => {
      if (!box.current?.contains(event.target as Node)) onClose();
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
  }, [box, onClose]);
}
