"use client";

import { useSyncExternalStore } from "react";
import { formatNoteTime } from "@/lib/notes/dates";

const subscribeNothing = () => () => {};
const inBrowser = () => true;
const onServer = () => false;

/** As wide as a real one, so nothing moves when the time arrives. */
const PLACEHOLDER = "0000-00-00 00:00";

/**
 * A note's time in the reader's own time zone (lib/notes/dates.ts).
 *
 * The server does not know where the reader is, so it draws an invisible
 * placeholder of the same width and the browser writes the time in once it
 * has taken the page over — never a UTC date that changes on hydration.
 * Isolated left to right: in a right-to-left line, «2026-10-07» and «15:40»
 * would otherwise trade places around the space between them.
 */
export function LocalTime({ stamp }: { stamp: string }) {
  const browser = useSyncExternalStore(subscribeNothing, inBrowser, onServer);
  return (
    <time
      dateTime={stamp}
      dir="ltr"
      data-testid="note-time"
      className={browser ? "tabular-nums" : "invisible tabular-nums"}
    >
      {browser ? formatNoteTime(stamp) : PLACEHOLDER}
    </time>
  );
}
