/**
 * Runs once per page load, before React hydrates (Next's
 * instrumentation-client convention). Nothing here measures, records or
 * sends anything — this site has no analytics and never will.
 *
 * It exists for one reason: Chrome fires `beforeinstallprompt` once per page
 * load, shortly after `load`, and the menu's install row cannot use an offer
 * it never heard (PROMPT-55). Measured on 2026-11-19, the shell's own code
 * was sometimes first evaluated after `load` (338 ms against 316), and on a
 * slow phone hydration lags further. Importing the store here attaches its
 * listeners before hydration begins; lib/pwa/install-prompt.ts explains the
 * rest.
 */
import "@/lib/pwa/install-prompt";
