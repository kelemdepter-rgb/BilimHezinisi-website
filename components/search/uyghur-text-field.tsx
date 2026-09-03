"use client";

import { useRef, type ReactNode } from "react";
import { KeyboardControl, type TextField } from "@/components/search/uyghur-keyboard";

/**
 * An ordinary labelled form field with the on-screen Uyghur keyboard beside it.
 *
 * The keyboard was built for the search boxes, but the reader who needs it is
 * the same reader the book-request form is for — offering somebody a way to
 * ask for a book and then requiring a keyboard they do not have would be
 * offering nothing. Everything else about the field is a plain input: it
 * submits with the form, with or without JavaScript.
 */
export function UyghurTextField({
  label,
  name,
  placeholder,
  testId,
  maxLength,
  required = false,
  multiline = false,
  rows = 4,
  hint,
}: {
  label: ReactNode;
  name: string;
  placeholder?: string;
  testId?: string;
  maxLength?: number;
  required?: boolean;
  multiline?: boolean;
  rows?: number;
  hint?: ReactNode;
}) {
  const fieldRef = useRef<TextField>(null);
  const common = {
    name,
    required,
    /**
     * Every field this renders today is a book's title, its author or a note
     * about it (app/request/page.tsx) — nothing that belongs to the person
     * typing. A browser offering to fill a saved home address into «ئاپتورى»
     * is nonsense, and after 2026-09-02 it is also the thing that frightened
     * a reader. The email field on that form is a plain <input> and keeps its
     * `autocomplete="email"`; if a caller ever needs an identity field here,
     * give this component a prop rather than removing the line.
     */
    autoComplete: "off",
    ...(maxLength ? { maxLength } : {}),
    ...(placeholder ? { placeholder } : {}),
    ...(testId ? { "data-testid": testId } : {}),
  };

  return (
    <div className="block">
      <div className="mb-1.5 flex items-center gap-2">
        <label
          htmlFor={`field-${name}`}
          className="block text-[13px] font-semibold text-ink2"
        >
          {label}
        </label>
        <span className="ms-auto">
          <KeyboardControl
            inputRef={fieldRef}
            label={`ئېكران كۇنۇپكا تاختىسى`}
          />
        </span>
      </div>
      {multiline ? (
        <textarea
          id={`field-${name}`}
          ref={fieldRef as React.RefObject<HTMLTextAreaElement>}
          className="field min-h-24"
          rows={rows}
          {...common}
        />
      ) : (
        <input
          id={`field-${name}`}
          ref={fieldRef as React.RefObject<HTMLInputElement>}
          className="field"
          type="text"
          {...common}
        />
      )}
      {hint && <span className="mt-1.5 block text-[12px] leading-5 text-ink3">{hint}</span>}
    </div>
  );
}
