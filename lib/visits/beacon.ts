import { NO_COUNT_COOKIE } from "./count";

/**
 * «One device, once a day» — the browser's half (components/visit-beacon.tsx).
 *
 * The browser keeps ONE thing in its own localStorage: the UTC date it last
 * said «I came today». The first time it opens the library on a new UTC day
 * it sends one empty POST to /api/visit and writes the date down; every other
 * page that day sends nothing. The server adds one to that country's daily
 * device count and keeps nothing about the browser (lib/visits/count.ts).
 *
 * No storage (a private window, storage switched off) means no signal at all,
 * rather than one per page: such a browser is simply not counted as a device.
 * Its page openings are still counted by the proxy.
 */

export const VISIT_DAY_KEY = "bh-visit-day";
export const VISIT_BEACON_URL = "/api/visit";

type DayStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export type BeaconEnvironment = {
  storage: DayStorage;
  /** "YYYY-MM-DD" in UTC — the tally's own day boundary. */
  today: string;
  /** `document.cookie`. */
  cookie: string;
  online: boolean;
  /** `navigator.sendBeacon`, bound; false when the browser refused to queue it. */
  send: (url: string) => boolean;
};

/**
 * Send today's signal if this browser has not yet. Returns whether it sent.
 * Never throws: any storage failure means «not counted».
 */
export function sendDailySignal({ storage, today, cookie, online, send }: BeaconEnvironment): boolean {
  if (!online) return false;
  if (cookie.split(";").some((part) => part.trim() === `${NO_COUNT_COOKIE}=1`)) return false;
  try {
    const last = storage.getItem(VISIT_DAY_KEY);
    if (last === today) return false;
    storage.setItem(VISIT_DAY_KEY, today);
    // A browser that accepts the write but does not keep it would otherwise send on every page.
    if (storage.getItem(VISIT_DAY_KEY) !== today) return false;
    if (send(VISIT_BEACON_URL)) return true;
    if (last === null) storage.removeItem(VISIT_DAY_KEY);
    else storage.setItem(VISIT_DAY_KEY, last);
    return false;
  } catch {
    return false;
  }
}
