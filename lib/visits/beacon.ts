import { NO_COUNT_COOKIE } from "./count";

/**
 * The browser's half of the library's tally (components/visit-beacon.tsx).
 *
 * Each full page load sends ONE empty POST to /api/visit — a page opening.
 * The first one of a UTC day carries `?d=1` as well — a device. To know
 * which is first, the browser keeps ONE thing in its own localStorage: the
 * date it last sent `?d=1`. The server adds one to that country's counts and
 * keeps nothing about the browser (lib/visits/count.ts).
 *
 * Moving between pages inside the site is not a new page load, so a reader
 * browsing ten books is one opening. A page served from the offline cache is
 * not counted: there is no network to send to.
 *
 * Where storage does not work (a private window, storage switched off) the
 * opening is still sent, but never as a device: such a browser could not
 * tell its first page of the day from its tenth.
 */

export const VISIT_DAY_KEY = "bh-visit-day";
export const VISIT_BEACON_URL = "/api/visit";
/** The same signal, marked as this browser's first page load of the day. */
export const VISIT_BEACON_FIRST_URL = "/api/visit?d=1";

type DayStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export type BeaconEnvironment = {
  /** `window.localStorage`, or null where reaching it throws. */
  storage: DayStorage | null;
  /** "YYYY-MM-DD" in UTC — the tally's own day boundary. */
  today: string;
  /** `document.cookie`. */
  cookie: string;
  /** `location.pathname` of the page that was opened. */
  path: string;
  online: boolean;
  /** `navigator.sendBeacon`, bound; false when the browser refused to queue it. */
  send: (url: string) => boolean;
};

export type SignalOutcome = { sent: boolean; device: boolean };

const NOTHING: SignalOutcome = { sent: false, device: false };

/**
 * Whether today's device mark can be claimed: true when the date was not yet
 * written and now is, and reads back. Any storage failure answers false.
 */
function claimDay(storage: DayStorage | null, today: string): { claimed: boolean; previous: string | null } {
  if (!storage) return { claimed: false, previous: null };
  try {
    const previous = storage.getItem(VISIT_DAY_KEY);
    if (previous === today) return { claimed: false, previous };
    storage.setItem(VISIT_DAY_KEY, today);
    // A browser that accepts the write but does not keep it would otherwise count a device on every page.
    return { claimed: storage.getItem(VISIT_DAY_KEY) === today, previous };
  } catch {
    return { claimed: false, previous: null };
  }
}

/** Put the day back as it was, so a signal the browser refused is tried again. */
function releaseDay(storage: DayStorage | null, previous: string | null): void {
  if (!storage) return;
  try {
    if (previous === null) storage.removeItem(VISIT_DAY_KEY);
    else storage.setItem(VISIT_DAY_KEY, previous);
  } catch {
    // Nothing more to do: the next page load simply will not count a device today.
  }
}

/** Send this page load's signal. Never throws. */
export function sendPageSignal({ storage, today, cookie, path, online, send }: BeaconEnvironment): SignalOutcome {
  if (!online) return NOTHING;
  if (cookie.split(";").some((part) => part.trim() === `${NO_COUNT_COOKIE}=1`)) return NOTHING;
  // Never from the admin area: its no-count flag (components/admin/no-count-mark.tsx)
  // is set by a part of the page that hydrates AFTER this runs, so a staff
  // browser's first visit was counted before the flag existed (2026-10-23).
  if (path === "/admin" || path.startsWith("/admin/")) return NOTHING;

  const { claimed, previous } = claimDay(storage, today);
  let sent = false;
  try {
    sent = send(claimed ? VISIT_BEACON_FIRST_URL : VISIT_BEACON_URL);
  } catch {
    sent = false;
  }
  if (!sent) {
    if (claimed) releaseDay(storage, previous);
    return NOTHING;
  }
  return { sent: true, device: claimed };
}
