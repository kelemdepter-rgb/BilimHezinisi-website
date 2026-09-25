"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

const LABEL = "جەزملەش خېتىنى قايتا ئەۋەتىش";

const subscribeNothing = () => () => {};

/** False while the server renders and while React hydrates; true after. */
function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribeNothing,
    () => true,
    () => false,
  );
}

/**
 * «Resend the confirmation email», held back for a minute after each resend
 * with the seconds counting down on the button (PROMPT-38 B7).
 *
 * The countdown is an enhancement and nothing more: the server renders an
 * ordinary, enabled button, so a browser without JavaScript can always ask
 * again — RESEND_RULE in lib/rate-limit.ts is what actually stops a flood.
 * `secondsLeft` comes from the server, which knows when the last resend was.
 */
export function ResendButton({ secondsLeft }: { secondsLeft: number }) {
  const hydrated = useHydrated();
  if (!hydrated || secondsLeft <= 0) {
    return (
      <button type="submit" className="hbtn w-full" data-testid="resend-submit">
        {LABEL}
      </button>
    );
  }
  return <Countdown seconds={secondsLeft} />;
}

function Countdown({ seconds }: { seconds: number }) {
  const [left, setLeft] = useState(seconds);

  useEffect(() => {
    if (left <= 0) return;
    const timer = setTimeout(() => setLeft((value) => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [left]);

  const waiting = left > 0;
  return (
    <button
      type="submit"
      className="hbtn w-full disabled:cursor-default disabled:opacity-60"
      disabled={waiting}
      data-testid="resend-submit"
    >
      {LABEL}
      {waiting && (
        <span dir="ltr" data-testid="resend-countdown" className="tabular-nums">
          ({left})
        </span>
      )}
    </button>
  );
}
