"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Icon } from "@/components/icons";

/**
 * Signing in needs a server, and offline there is none.
 *
 * Reading works with no connection now, which makes it entirely reasonable
 * for someone to open the app on a train, tap «كىرىش» and wait. Without this
 * the Server Action simply fails and the page sits there saying nothing —
 * so the state is named, in Uyghur, and the form is disabled while it holds
 * rather than accepting a password that is going nowhere.
 */
export function OfflineFormNotice({ children }: { children: ReactNode }) {
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    const update = () => setOffline(!navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  return (
    <>
      {offline && (
        <p
          role="alert"
          data-testid="auth-offline"
          className="flex items-start gap-2 rounded-[var(--radius)] border border-bd2 bg-ab2 px-3.5 py-3 text-[13px] leading-6 text-ink"
        >
          <Icon name="globe" className="mt-1 shrink-0 text-am" />
          تور ئۇلىنىشى يوق. ھېساباتقا كىرىش ئۈچۈن تور كېرەك — تور كەلگەندە قايتا سىناڭ. ئىلگىرى
          ئېچىپ باققان كىتابلارنى ھازىرمۇ ئوقۇيالايسىز.
        </p>
      )}
      {/* display: contents so the wrapper never changes the form's layout. */}
      <fieldset disabled={offline} className="contents">
        {children}
      </fieldset>
    </>
  );
}
