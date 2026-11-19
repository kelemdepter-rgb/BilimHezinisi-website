"use client";

import { useId, useState, useSyncExternalStore, type ReactNode } from "react";
import { Icon, type IconName } from "@/components/icons";
import {
  installServerSnapshot,
  installSnapshot,
  openInstallPrompt,
  subscribeInstall,
} from "@/lib/pwa/install-prompt";

/** The «بۆلۈملەر» rows' own shape (components/app-shell.tsx), as a button. */
const ROW =
  "flex min-h-11 w-full items-center gap-2.5 rounded-[var(--radius)] px-3 py-2 text-start text-[14px] font-semibold text-ink2 hover:bg-bg2 hover:text-ink";
const LABEL = "ئەپ قىلىپ قاچىلاش";

/**
 * «ئەپ قىلىپ قاچىلاش» — the last row of the menu's «بۆلۈملەر» (PROMPT-55).
 *
 * A place to go, never a prompt: nothing here appears by itself. What a tap
 * does is decided in the browser alone (lib/pwa/install-state.ts):
 * - a saved install offer (Chrome, Edge, Samsung Internet) → the browser's
 *   own install dialog, in one tap. Where a browser can install, this is the
 *   ONLY row there is: it never teaches the browser's menu (the owner's
 *   decision, 2026-11-19), so before the offer arrives there is no row;
 * - an iPhone or iPad → three steps, unfolded under the row: Apple gives a
 *   page no way to install, so this is the only way there;
 * - another app's built-in browser → open the page in Safari or Chrome;
 * - already the installed app, or no offer anywhere else → nothing.
 * On the server and while hydrating it renders nothing; as the last row of
 * its list, appearing later moves nothing above it.
 */
export function InstallEntry() {
  const state = useSyncExternalStore(subscribeInstall, installSnapshot, installServerSnapshot);
  const [open, setOpen] = useState(false);
  const panelId = useId();

  if (state === "hidden") return null;

  if (state === "done") {
    return (
      <p role="status" data-testid="install-done" className="flex min-h-11 items-center gap-2.5 px-3 py-2 text-[13px] font-semibold leading-5 text-ink2">
        <Icon name="check" className="text-am" />
        قاچىلاندى — تېلېفونىڭىزنىڭ ئېكرانىدىن ئېچىڭ.
      </p>
    );
  }

  if (state === "prompt") {
    return (
      <button
        type="button"
        data-testid="install-entry"
        data-kind="prompt"
        className={ROW}
        // Called in the tap itself: prompt() needs the tap's activation.
        onClick={() => void openInstallPrompt()}
      >
        <Icon name="smartphone" className="text-am" />
        {LABEL}
      </button>
    );
  }

  return (
    <>
      <button
        type="button"
        data-testid="install-entry"
        data-kind={state}
        className={ROW}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
      >
        <Icon name="smartphone" className="text-am" />
        <span className="min-w-0 flex-1">{LABEL}</span>
        {/* Two glyphs, not a rotated one: WebKit was seen leaving the rotation undone. */}
        <Icon name={open ? "chevron-up" : "chevron-down"} className="text-ink3" />
      </button>
      <div
        id={panelId}
        hidden={!open}
        data-testid="install-panel"
        className="mx-1 mb-1 mt-0.5 rounded-[var(--radius)] bg-ab px-3 py-3 text-[13px] leading-6 text-ink2"
      >
        {state === "ios" && (
          <Steps
            items={[
              <>
                «ھەمبەھىرلەش» كۇنۇپكىسىنى <Glyph name="share" testId="install-share-icon" /> بېسىڭ.
                يېڭى <Latin>iPhone</Latin> لاردا ئۇ ئادرېس يېنىدىكى <Glyph name="ellipsis" label="⋯" /> نىڭ
                ئىچىدە.
              </>,
              <>
                «<Latin>Add to Home Screen</Latin>» نى تاللاڭ — تېلېفونىڭىزنىڭ تىلىدا يېزىلغان بولۇشى
                مۇمكىن.
              </>,
              <>
                «<Latin>Add</Latin>» نى بېسىڭ.
              </>,
            ]}
          />
        )}
        {state === "in-app" && <InAppNotice />}
      </div>
    </>
  );
}

/** A browser's own English words, kept whole and left-to-right inside the Uyghur line. */
function Latin({ children }: { children: ReactNode }) {
  return (
    <bdi dir="ltr" className="whitespace-nowrap">
      {children}
    </bdi>
  );
}

/**
 * A browser control drawn as the browser draws it. A sprite icon, not the
 * Unicode ⋯, which the Uyghur faces do not carry and which fell back to
 * small, faint dots. Named for screen readers when the words around it do
 * not already say what it is.
 */
function Glyph({ name, label, testId }: { name: IconName; label?: string; testId?: string }) {
  return (
    <Icon
      name={name}
      className="text-am"
      data-testid={testId}
      {...(label ? { role: "img", "aria-hidden": false, "aria-label": label } : {})}
    />
  );
}

function Steps({ items }: { items: ReactNode[] }) {
  return (
    <ol className="space-y-2" data-testid="install-steps">
      {items.map((item, index) => (
        <li key={index} className="flex items-start gap-2">
          <span
            aria-hidden="true"
            className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-am text-[11px] font-bold leading-none text-ink"
          >
            {index + 1}
          </span>
          <span className="min-w-0 flex-1">{item}</span>
        </li>
      ))}
    </ol>
  );
}

/**
 * Facebook's, Instagram's or WeChat's own browser cannot install a site, so
 * the way forward is the real browser: copy the address, paste it there.
 * Where the clipboard is refused — some of these browsers do — the address
 * is shown, selected, to be copied by hand.
 */
function InAppNotice() {
  const [copy, setCopy] = useState<"idle" | "copied" | "manual">("idle");
  const [address, setAddress] = useState("");

  async function copyAddress() {
    const url = window.location.href;
    setAddress(url);
    try {
      await navigator.clipboard.writeText(url);
      setCopy("copied");
    } catch {
      setCopy("manual");
    }
  }

  return (
    <div data-testid="install-in-app">
      <p>بۇ بەت باشقا ئەپنىڭ ئىچىدە ئېچىلدى — ئاۋۋال Safari ياكى Chrome دا ئېچىڭ.</p>
      <button
        type="button"
        data-testid="install-copy-link"
        className="hbtn mt-2 bg-bg"
        onClick={() => void copyAddress()}
      >
        <Icon name="copy" />
        ئۇلانمىنى كۆچۈرۈش
      </button>
      {copy === "copied" && (
        <p role="status" data-testid="install-copied" className="mt-2">
          ئۇلانما كۆچۈرۈلدى — Safari ياكى Chrome نىڭ ئادرېس قۇرىغا چاپلاڭ.
        </p>
      )}
      {copy === "manual" && (
        <label className="mt-2 block">
          <span className="block">ئۇلانمىنى بېسىپ تۇرۇپ كۆچۈرۈڭ:</span>
          <input
            readOnly
            dir="ltr"
            value={address}
            data-testid="install-address"
            autoComplete="off"
            className="mt-1 min-h-11 w-full rounded-[var(--radius)] border border-bd bg-bg px-2 text-[13px] text-ink"
            ref={(input) => input?.select()}
            onFocus={(event) => event.currentTarget.select()}
          />
        </label>
      )}
    </div>
  );
}
