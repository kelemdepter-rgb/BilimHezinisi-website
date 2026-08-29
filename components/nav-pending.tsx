"use client";

import { useLinkStatus } from "next/link";

/**
 * "Your tap registered."
 *
 * The complaint that started this work was that clicking a category felt like
 * nothing had happened. A route-level skeleton answers that for the page, but
 * only once the router has committed; this answers it in the same frame as the
 * tap, on the control the reader actually touched.
 *
 * It must be rendered INSIDE the <Link> it belongs to — that is how
 * useLinkStatus finds the navigation it is reporting on.
 *
 * The element is always present and always the same size, so it can never
 * move the row it sits in; only its opacity changes. The 120 ms delay means a
 * navigation that was already prefetched and lands immediately never flashes
 * a dot at anybody.
 */
export function LinkPending() {
  const { pending } = useLinkStatus();
  return <span aria-hidden className={pending ? "link-hint is-pending" : "link-hint"} />;
}
