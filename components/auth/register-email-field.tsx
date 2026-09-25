"use client";

import { useEffect, useRef, useState } from "react";
import { isBlockedJurisdiction, parseEmail, suggestDomain, withDomain } from "@/lib/auth/email";
import { BLOCKED_MESSAGE } from "@/lib/auth/messages";

type Notice = { typed: string; suggestion: string };

/** What an address calls for: a suggestion to offer, or the block to name. */
function judge(value: string, keptDomain: string): { notice: Notice | null; blocked: boolean } {
  const parsed = parseEmail(value);
  if (!parsed) return { notice: null, blocked: false };
  if (isBlockedJurisdiction(parsed.domain)) return { notice: null, blocked: true };
  const suggestion = suggestDomain(parsed.domain);
  return {
    notice: suggestion && keptDomain !== parsed.domain ? { typed: parsed.domain, suggestion } : null,
    blocked: false,
  };
}

/**
 * The registration form's email field, with the typo check in front of it
 * (PROMPT-38 B5).
 *
 * On leaving the field, and again on submit, an address one slip away from a
 * common domain — `name@gmial.com` — gets a notice under the field with two
 * buttons: use the suggested domain, or keep what was typed. Nothing is ever
 * corrected silently, and submitting waits for the choice.
 *
 * The same markup works with JavaScript switched off: the two buttons are
 * then ordinary submit buttons aimed at `acceptAction` and `keepAction`, and
 * the server — which runs the same check before anything is sent — renders
 * this component with its suggestion already open (`initialSuggestion`). With
 * JavaScript, the buttons act in place and the page never reloads.
 *
 * An address under the Chinese-jurisdiction block is named on leaving the
 * field, for instant feedback only; the server's check is the one that counts.
 */
export function RegisterEmailField({
  defaultEmail,
  initialSuggestion,
  initialKept,
  acceptAction,
  keepAction,
}: {
  defaultEmail: string;
  initialSuggestion: string | null;
  initialKept: string;
  acceptAction: (formData: FormData) => Promise<void>;
  keepAction: (formData: FormData) => Promise<void>;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const acceptRef = useRef<HTMLButtonElement>(null);
  const focusChoice = useRef(false);
  const [kept, setKept] = useState(initialKept);
  const [blocked, setBlocked] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(() => {
    const parsed = parseEmail(defaultEmail);
    return parsed && initialSuggestion ? { typed: parsed.domain, suggestion: initialSuggestion } : null;
  });

  function check() {
    const verdict = judge(inputRef.current?.value ?? "", kept);
    setNotice(verdict.notice);
    setBlocked(verdict.blocked);
  }

  // Submitting waits for a decision on an open suggestion. A native listener
  // runs before React's own form handling, which respects preventDefault.
  // The kept domain is read off the hidden field, which is always current.
  useEffect(() => {
    const form = inputRef.current?.form;
    if (!form) return;
    const onSubmit = (event: SubmitEvent) => {
      if (event.submitter?.hasAttribute("data-suggestion-choice")) return;
      const keptField = form.elements.namedItem("keep_domain") as HTMLInputElement | null;
      const verdict = judge(inputRef.current?.value ?? "", keptField?.value ?? "");
      if (!verdict.notice) return;
      event.preventDefault();
      focusChoice.current = true;
      setNotice(verdict.notice);
    };
    form.addEventListener("submit", onSubmit);
    return () => form.removeEventListener("submit", onSubmit);
  }, []);

  // After React has drawn the notice, hand the reader the choice.
  useEffect(() => {
    if (notice && focusChoice.current) {
      focusChoice.current = false;
      acceptRef.current?.focus();
    }
  }, [notice]);

  function accept(event: React.MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    const input = inputRef.current;
    if (!input || !notice) return;
    input.value = withDomain(input.value.trim(), notice.suggestion);
    setNotice(null);
    setKept("");
    input.focus();
  }

  function keep(event: React.MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    if (!notice) return;
    setKept(notice.typed);
    setNotice(null);
    inputRef.current?.focus();
  }

  return (
    <div>
      <label className="block">
        <span className="mb-1.5 block text-[13px] font-semibold text-ink2">ئېلخەت ئادرېسى</span>
        <input
          ref={inputRef}
          className="field"
          type="email"
          name="email"
          required
          dir="ltr"
          autoComplete="email"
          placeholder="siz@example.com"
          defaultValue={defaultEmail}
          data-testid="register-email"
          aria-describedby={notice ? "email-suggestion" : blocked ? "email-blocked" : undefined}
          onBlur={check}
          onInput={() => {
            if (notice) setNotice(null);
            if (blocked) setBlocked(false);
          }}
        />
      </label>
      <input type="hidden" name="keep_domain" value={kept} />

      {blocked && (
        <p
          id="email-blocked"
          role="alert"
          data-testid="email-blocked"
          className="mt-2 rounded-[var(--radius)] border border-bd2 bg-ab2 px-3.5 py-3 text-[13px] leading-6 text-ink"
        >
          {BLOCKED_MESSAGE}
        </p>
      )}

      {notice && (
        <div
          id="email-suggestion"
          role="status"
          data-testid="email-suggestion"
          className="mt-2 rounded-[var(--radius)] bg-ab px-3.5 py-3 text-[13px] leading-6 text-ink"
        >
          <p data-testid="email-suggestion-text">
            بۇ ‹<bdi>{notice.typed}</bdi>› بولۇپ قالدى — ‹<bdi>{notice.suggestion}</bdi>› دېمەكچىمۇ؟
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              ref={acceptRef}
              type="submit"
              formAction={acceptAction}
              formNoValidate
              onClick={accept}
              className="btn-am"
              data-suggestion-choice=""
              data-testid="suggestion-accept"
            >
              ھەئە، <bdi dir="ltr">{notice.suggestion}</bdi>
            </button>
            <button
              type="submit"
              formAction={keepAction}
              formNoValidate
              onClick={keep}
              className="hbtn"
              data-suggestion-choice=""
              data-testid="suggestion-keep"
            >
              ياق، يازغىنىم توغرا
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
