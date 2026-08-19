"use client";

import { useState } from "react";
import { Icon } from "@/components/icons";
import { deleteAccountAction } from "@/app/my/account/actions";

/**
 * The destructive half of /my/account.
 *
 * Two things guard it, and both are needed: the button stays disabled until
 * the typed address matches, so nobody deletes an account by tapping the
 * wrong thing on a phone — and the server action re-checks the same match
 * against the session's own email, because a disabled button is only a
 * suggestion.
 */
export function DeleteAccount({ email, blocked }: { email: string; blocked: boolean }) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");

  const matches = typed.trim().toLowerCase() === email.trim().toLowerCase();

  if (blocked) {
    return (
      <p
        data-testid="delete-blocked"
        className="rounded-[var(--radius)] border border-bd2 bg-ab2 px-3.5 py-3 text-[13px] leading-7 text-ink"
      >
        سىز بۇ سايتتىكى <strong>بىردىنبىر باشقۇرغۇچى</strong>. ھېساباتىڭىزنى ئۆچۈرسىڭىز،
        كۇتۇپخانىغا كىتاب قوشىدىغان ياكى باشقىلارغا ھوقۇق بېرىدىغان ھېچكىم قالمايدۇ ۋە بۇنى
        كەينىگە قايتۇرغىلى بولمايدۇ. شۇڭا ئۆچۈرۈش توسۇلدى. ئالدى بىلەن باشقا بىر كىشىنى
        باشقۇرغۇچى قىلىپ بەلگىلەڭ، ئاندىن قايتىپ كېلىڭ.
      </p>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        className="hbtn"
        data-testid="delete-open"
        onClick={() => setOpen(true)}
      >
        <Icon name="trash" />
        ھېساباتىمنى ئۆچۈرۈش
      </button>
    );
  }

  return (
    <form action={deleteAccountAction} className="space-y-4" data-testid="delete-form">
      <p className="rounded-[var(--radius)] border border-bd2 bg-ab2 px-3.5 py-3 text-[13px] leading-7 text-ink">
        بۇ مەشغۇلاتنى <strong>كەينىگە قايتۇرغىلى بولمايدۇ</strong>. خەتكۈچلىرىڭىز،
        خاتىرىلىرىڭىز، ئوقۇش ئىزىڭىز ۋە خاتىرە دەپتىرىڭىزنىڭ ھەممىسى ئۆچىدۇ. داۋاملاشتۇرۇش
        ئۈچۈن تۆۋەندە ئۆز ئېلخەت ئادرېسىڭىزنى يېزىڭ.
      </p>

      <label className="block">
        <span className="mb-1.5 block text-[13px] font-semibold text-ink2">
          ئېلخەت ئادرېسىڭىز: <span dir="ltr">{email}</span>
        </span>
        <input
          className="field"
          type="email"
          name="confirm_email"
          required
          dir="ltr"
          autoComplete="off"
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
          data-testid="delete-confirm-email"
          aria-describedby="delete-confirm-help"
        />
      </label>
      <p id="delete-confirm-help" className="text-[12.5px] text-ink3">
        {matches
          ? "ئادرېس توغرا. ئۆچۈرۈش كۇنۇپكىسى ئېچىلدى."
          : "ئادرېس دەل ماس كەلگەندە ئۆچۈرۈش كۇنۇپكىسى ئىشلەيدۇ."}
      </p>

      <div className="flex flex-wrap gap-2">
        <button
          type="submit"
          className="btn-danger"
          disabled={!matches}
          data-testid="delete-submit"
        >
          <Icon name="trash" />
          ھەئە، ھېساباتىمنى ئۆچۈرۈڭ
        </button>
        <button
          type="button"
          className="hbtn"
          data-testid="delete-cancel"
          onClick={() => {
            setOpen(false);
            setTyped("");
          }}
        >
          بىكار قىلىش
        </button>
      </div>
    </form>
  );
}
