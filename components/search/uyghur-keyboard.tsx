"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "@/components/icons";

/**
 * An Uyghur keyboard on the screen, for the phones that do not have one.
 *
 * This is not a convenience. A great many phones in this audience have no
 * Uyghur keyboard installed and no way for their owner to add one, and without
 * this those readers cannot search the library at all — they can only browse.
 *
 * ORDER. The letters are in ALPHABETICAL order, not in the QWERTY-derived
 * order of the standard Uyghur keyboard. That is a deliberate choice and worth
 * writing down: the reader this exists for has, by definition, never used the
 * standard layout, and is hunting for a letter rather than touch-typing.
 * Alphabetical is the order they can actually scan.
 *
 * It is never required. It is closed until asked for, a reader with a real
 * Uyghur keyboard need never open it, and closing it changes nothing about
 * what has been typed.
 */

/**
 * The Uyghur Arabic alphabet, in order, followed by the hamza carrier.
 *
 * ئ is not a letter of the alphabet — it carries a word-initial vowel — but it
 * cannot be left off a keyboard, because «ئۇيغۇر» cannot be typed without it.
 */
const LETTERS = [
  "ا", "ە", "ب", "پ", "ت", "ج", "چ", "خ",
  "د", "ر", "ز", "ژ", "س", "ش", "غ", "ف",
  "ق", "ك", "گ", "ڭ", "ل", "م", "ن", "ھ",
  "و", "ۇ", "ۆ", "ۈ", "ۋ", "ې", "ى", "ي",
  "ئ",
];

/** Anything this keyboard can type into. */
export type TextField = HTMLInputElement | HTMLTextAreaElement;

/**
 * Write a value into a field the way a keystroke would.
 *
 * Setting `.value` directly is invisible to React: it tracks the last value
 * it rendered and would decide nothing had changed, so a controlled input —
 * the reader's in-book search box is one — would snap back on the next render.
 * Going through the prototype's setter and then dispatching a real `input`
 * event is what makes React's own onChange fire, so one code path serves both
 * controlled and uncontrolled fields, and both inputs and textareas.
 */
function typeInto(input: TextField, value: string, caret: number) {
  const prototype =
    input instanceof HTMLTextAreaElement
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  if (setter) setter.call(input, value);
  else input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.setSelectionRange(caret, caret);
}

export function KeyboardControl({
  inputRef,
  label = "ئېكران كۇنۇپكا تاختىسى",
}: {
  inputRef: React.RefObject<TextField | null>;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const sheetRef = useRef<HTMLDivElement>(null);

  /** Put a character in at the caret, or take one out from before it. */
  const press = useCallback(
    (key: string | "space" | "backspace") => {
      const input = inputRef.current;
      if (!input) return;

      const start = input.selectionStart ?? input.value.length;
      const end = input.selectionEnd ?? start;

      if (key === "backspace") {
        // A selection is deleted whole; otherwise one character disappears
        // from before the caret, exactly as a real backspace behaves.
        const from = start === end ? Math.max(0, start - 1) : start;
        typeInto(input, input.value.slice(0, from) + input.value.slice(end), from);
      } else {
        const text = key === "space" ? " " : key;
        typeInto(input, input.value.slice(0, start) + text + input.value.slice(end), start + text.length);
      }
      input.focus();
    },
    [inputRef],
  );

  // Escape closes it, like every other layer on this site.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  /**
   * Make sure the sheet is not sitting on top of the box it types into.
   *
   * Every input this is offered on lives in a bar at the top of the screen, so
   * in practice it never is — but "in practice" is not a guarantee, and a
   * keyboard covering its own input is the single worst thing this could do.
   */
  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => {
      const input = inputRef.current;
      const sheet = sheetRef.current;
      if (!input || !sheet) return;
      const covered = input.getBoundingClientRect().bottom - sheet.getBoundingClientRect().top;
      if (covered > 0) window.scrollBy(0, covered + 12);
    });
    return () => cancelAnimationFrame(frame);
  }, [open, inputRef]);

  return (
    <>
      <button
        type="button"
        className="ibtn shrink-0"
        data-testid="keyboard-toggle"
        aria-label={label}
        aria-pressed={open}
        title={label}
        onClick={() => {
          setOpen((value) => !value);
          inputRef.current?.focus();
        }}
      >
        <Icon name="keyboard" className="ic-lg" />
      </button>

      {open && (
        <div
          ref={sheetRef}
          role="group"
          aria-label={label}
          data-testid="uyghur-keyboard"
          /**
           * A sheet at the bottom, where a phone's own keyboard would be, and
           * clear of the gesture area. Body scroll is deliberately NOT locked:
           * the reader must still be able to move the page to see what they are
           * typing about. overscroll-contain keeps a flick inside the sheet
           * from scrolling the page behind it.
           */
          className="safe-bottom safe-x fixed inset-x-0 bottom-0 z-50 max-h-[60dvh] overflow-y-auto overscroll-contain border-t border-bd bg-bg2/98 backdrop-blur print:hidden"
          // Keeps the caret where it is: without this the input loses focus
          // the moment a key is touched, and the insertion point with it.
          onPointerDown={(event) => event.preventDefault()}
        >
          <div className="mx-auto w-full max-w-2xl px-2 py-2">
            <div className="mb-2 flex items-center gap-2 px-1">
              <span className="text-[12px] font-semibold text-ink3">{label}</span>
              <button
                type="button"
                className="ibtn ms-auto"
                data-testid="keyboard-close"
                aria-label="كۇنۇپكا تاختىسىنى تاقاش"
                onClick={() => setOpen(false)}
              >
                <Icon name="x" className="ic-lg" />
              </button>
            </div>

            {/*
              auto-fit with a 44 px floor: the row count follows the width
              instead of being written down, so there is no phone narrow
              enough to make this scroll sideways and no key smaller than a
              fingertip.
            */}
            <div className="grid grid-cols-[repeat(auto-fit,minmax(44px,1fr))] gap-1">
              {LETTERS.map((letter) => (
                <button
                  key={letter}
                  type="button"
                  data-testid="keyboard-key"
                  className="kbd-key"
                  onClick={() => press(letter)}
                >
                  {letter}
                </button>
              ))}
            </div>

            <div className="mt-1 flex gap-1">
              <button
                type="button"
                data-testid="keyboard-space"
                className="kbd-key flex-1"
                onClick={() => press("space")}
              >
                بوشلۇق
              </button>
              <button
                type="button"
                data-testid="keyboard-backspace"
                className="kbd-key w-24"
                aria-label="ئۆچۈرۈش"
                onClick={() => press("backspace")}
              >
                <Icon name="undo" />
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
