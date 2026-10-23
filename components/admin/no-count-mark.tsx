"use client";

import { useEffect } from "react";
import { NO_COUNT_COOKIE } from "@/lib/visits/count";

/** Browsers cap a cookie's life at 400 days; renewed on every visit to /admin anyway. */
const MAX_AGE_SECONDS = 400 * 24 * 60 * 60;

/**
 * Marks a staff member's own browser so the library's tallies leave it out
 * (lib/visits/count.ts): the owner and the uploaders testing the site would
 * otherwise inflate their own country's numbers. Mounted in the admin layout,
 * which renders only after the role was verified on the server.
 *
 * A flag, not a credential: it grants nothing, and setting it by hand only
 * ever takes a browser out of the count. Renders nothing.
 */
export function NoCountMark() {
  useEffect(() => {
    const secure = window.location.protocol === "https:" ? "; Secure" : "";
    document.cookie = `${NO_COUNT_COOKIE}=1; Path=/; Max-Age=${MAX_AGE_SECONDS}; SameSite=Lax${secure}`;
  }, []);
  return null;
}
