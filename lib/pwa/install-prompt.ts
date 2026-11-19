import { decideInstallState, type InstallInput, type InstallState } from "@/lib/pwa/install-state";

/**
 * The browser's saved install offer, and what this page has seen of an
 * installation — one store for the whole page (PROMPT-55).
 *
 * The menu row is drawn twice (the desktop sidebar and the phone drawer), so
 * the offer lives here rather than in either of them, and both read it
 * through `useSyncExternalStore`. Nothing is written anywhere: the store is
 * this page's memory and goes with it.
 *
 * The listeners are attached when this module is first evaluated in the
 * browser, which is before hydration on every page: instrumentation-client.ts
 * imports it for exactly that. Never when the drawer opens, and not merely
 * with the shell's code either — Chrome fires `beforeinstallprompt` once per
 * page load, shortly after `load`, and the shell's chunk was measured being
 * evaluated after `load`. A listener added later misses the offer for good.
 *
 * `preventDefault()` is NEVER called on the event. It would only stop
 * Chrome's own install notice on Android — `prompt()` does not need it
 * (Chromium's BeforeInstallPromptEvent::prompt checks the connection and the
 * tap, nothing else) — and the browser's notice is meant to keep appearing.
 */

/** Chromium's event; no other engine fires it, and TypeScript's DOM types lack it. */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<unknown>;
  readonly userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

/** Ways of running as an installed app (the manifest asks for standalone). */
const INSTALLED_DISPLAY_MODES = [
  "(display-mode: standalone)",
  "(display-mode: fullscreen)",
  "(display-mode: minimal-ui)",
];
const COARSE_POINTER = "(pointer: coarse)";

let saved: BeforeInstallPromptEvent | null = null;
/** A prompt() is open: the row keeps its shape behind the browser's dialog. */
let asking = false;
let installed: InstallInput["installed"] = "no";
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (event) => {
    saved = event as BeforeInstallPromptEvent;
    emit();
  });
  window.addEventListener("appinstalled", () => {
    saved = null;
    // Installed while the reader's own prompt was open is the reader's own
    // install; anything else came from the browser's banner or menu.
    if (installed !== "from-row") installed = asking ? "from-row" : "elsewhere";
    emit();
  });
}

let queries: { installed: MediaQueryList[]; coarse: MediaQueryList | null } | null = null;

function mediaQueries() {
  if (!queries) {
    const match = (query: string) =>
      typeof window.matchMedia === "function" ? window.matchMedia(query) : null;
    queries = {
      installed: INSTALLED_DISPLAY_MODES.map(match).filter((list): list is MediaQueryList => list !== null),
      coarse: match(COARSE_POINTER),
    };
  }
  return queries;
}

/** What the row shows right now. A string, so React compares it by value. */
export function installSnapshot(): InstallState {
  const { installed: modes, coarse } = mediaQueries();
  const apple = navigator as Navigator & { standalone?: boolean };
  return decideInstallState({
    userAgent: navigator.userAgent,
    maxTouchPoints: navigator.maxTouchPoints ?? 0,
    standalone: modes.some((list) => list.matches) || apple.standalone === true,
    coarsePointer: coarse?.matches ?? false,
    hasPrompt: saved !== null || asking,
    installed,
  });
}

/** Nothing on the server and while hydrating: the row is decided in the browser only. */
export function installServerSnapshot(): InstallState {
  return "hidden";
}

/**
 * Re-read on the store's own changes and on the media queries': a desktop
 * install moves the tab into the app's window (display-mode turns
 * standalone), and a tablet can gain or lose its keyboard and trackpad.
 */
export function subscribeInstall(onChange: () => void): () => void {
  listeners.add(onChange);
  const { installed: modes, coarse } = mediaQueries();
  const lists = coarse ? [...modes, coarse] : modes;
  for (const list of lists) list.addEventListener?.("change", onChange);
  return () => {
    listeners.delete(onChange);
    for (const list of lists) list.removeEventListener?.("change", onChange);
  };
}

/**
 * Opens the browser's install dialog from the saved offer. Must be called
 * straight from the tap's handler: `prompt()` needs the tap's activation and
 * runs before the first `await`.
 *
 * An offer can be prompted once. It is used up here whatever the answer; if
 * the reader says no, Chrome sends a fresh `beforeinstallprompt`, and the row
 * is a one-tap row again when it arrives.
 */
export async function openInstallPrompt(): Promise<"accepted" | "dismissed" | "busy" | "unavailable"> {
  if (asking) return "busy";
  const event = saved;
  if (!event) return "unavailable";
  saved = null;
  asking = true;
  try {
    await event.prompt();
    const { outcome } = await event.userChoice;
    if (outcome === "accepted") installed = "from-row";
    return outcome;
  } catch {
    // Refused (no tap, or the browser withdrew the offer). The row goes
    // until the browser makes a new offer.
    return "unavailable";
  } finally {
    asking = false;
    emit();
  }
}
