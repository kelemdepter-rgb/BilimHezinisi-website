/**
 * What the menu's «ئەپ قىلىپ قاچىلاش» row offers this browser (PROMPT-55).
 *
 * Pure: everything it needs is passed in, so the whole decision is tested
 * without a browser (tests/unit/install-state.test.ts). The component reads
 * the browser and the saved install event, and draws what this returns.
 *
 * - `hidden`  — nothing at all: already running as the installed app; an
 *               install the browser reported by itself; or no offer from the
 *               browser yet on anything but an iPhone, an iPad or another
 *               app's browser.
 * - `prompt`  — the browser saved an install offer; one tap opens it.
 * - `done`    — the reader installed through this row, in this page.
 * - `in-app`  — a phone in another app's built-in browser, which cannot
 *               install anything: open the page in Safari or Chrome first.
 * - `ios`     — iPhone or iPad: Share → «Add to Home Screen» → «Add».
 *
 * The row never teaches the browser's own menu (the owner's decision,
 * 2026-11-19): where a browser can install, the row waits until one tap
 * does it. Apple gives a page no way to install at all, so an iPhone gets
 * the steps; another app's browser cannot install, so it gets the way out.
 */
export type InstallState = "hidden" | "prompt" | "done" | "in-app" | "ios";

export type InstallInput = {
  userAgent: string;
  /**
   * `navigator.maxTouchPoints`. iPadOS Safari presents itself as a Mac, and
   * this is what tells the two apart: no Mac has a touch screen.
   */
  maxTouchPoints: number;
  /**
   * Already running as the installed app: `display-mode` standalone,
   * fullscreen or minimal-ui, or iOS's `navigator.standalone`.
   */
  standalone: boolean;
  /** `(pointer: coarse)` — a finger, not a mouse: a phone or a tablet. */
  coarsePointer: boolean;
  /** The browser saved a `beforeinstallprompt` that has not been used yet. */
  hasPrompt: boolean;
  /**
   * What this page has seen of an installation: none; one the reader started
   * from this row (accepted, or `appinstalled` while it was open); or an
   * `appinstalled` the browser reported on its own — its banner or its menu.
   */
  installed: "no" | "from-row" | "elsewhere";
};

/** iPhone, iPod, iPad — and iPadOS, which says "Macintosh" but has a touch screen. */
export function isAppleMobile(userAgent: string, maxTouchPoints: number): boolean {
  if (/\b(iPhone|iPad|iPod)\b/.test(userAgent)) return true;
  return /\bMacintosh\b/.test(userAgent) && maxTouchPoints > 1;
}

/**
 * Built-in browsers of other apps, which can never install a site and whose
 * share menu has no «Add to Home Screen». Kept to the markers each app
 * documents or always sends:
 * - `FBAN` / `FBAV` / `FB_IAB` — Facebook and Messenger (iOS and Android);
 * - `Instagram`;
 * - `MicroMessenger` — WeChat;
 * - `Line/` — LINE;
 * - `; wv)` — any Android app showing pages in a WebView. Google documents
 *   it as the WebView's own mark in the user agent; Chrome itself, Custom
 *   Tabs and Samsung Internet never send it.
 * An in-app browser on iOS that sends none of these is not recognised: it
 * gets the iPhone steps, which is what that reader would get anyway.
 */
const IN_APP_BROWSER = /\bFBAN\b|\bFBAV\b|\bFB_IAB\b|\bInstagram\b|\bMicroMessenger\b|\bLine\/|;\s*wv\)/;

export function isInAppBrowser(userAgent: string): boolean {
  return IN_APP_BROWSER.test(userAgent);
}

export function decideInstallState(input: InstallInput): InstallState {
  if (input.standalone) return "hidden";
  if (input.installed === "from-row") return "done";
  if (input.installed === "elsewhere") return "hidden";
  // An offer the browser made wins over everything below: it is the one
  // case where a tap installs, and it is the only one a computer ever sees.
  if (input.hasPrompt) return "prompt";

  const apple = isAppleMobile(input.userAgent, input.maxTouchPoints);
  const phone = apple || input.coarsePointer;
  if (!phone) return "hidden";
  // Before the iPhone steps: Facebook's or WeChat's browser on an iPhone has
  // a share button too, and «Add to Home Screen» is not in it.
  if (isInAppBrowser(input.userAgent)) return "in-app";
  if (apple) return "ios";
  // Android and the rest: nothing until the browser's offer arrives, and
  // then the one-tap row above.
  return "hidden";
}
