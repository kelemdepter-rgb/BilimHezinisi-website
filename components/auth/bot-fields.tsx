import { FORM_TOKEN_FIELD, HONEYPOT_FIELD, issueFormToken } from "@/lib/auth/bot-check";

/**
 * The two hidden fields every email-sending form carries (lib/auth/bot-check.ts):
 * the honeypot, and the time the page was made, signed.
 *
 * The honeypot is hidden by clipping it to a pixel rather than with
 * display:none — some bots skip fields that are not displayed — and rather
 * than by pushing it off-screen, which in a right-to-left page would open a
 * horizontal scroll. It is out of the tab order, hidden from screen readers,
 * and marked so neither the browser nor a password manager offers to fill it.
 * The label is for the rare person who meets it anyway: leave it empty.
 *
 * Rendered per request — the auth pages are dynamic — so every visitor gets a
 * timestamp of their own.
 */
export function BotFields() {
  return (
    <>
      <div aria-hidden="true" className="sr-only">
        <label>
          بۇ رامكىنى بوش قالدۇرۇڭ
          <input
            type="text"
            name={HONEYPOT_FIELD}
            tabIndex={-1}
            autoComplete="off"
            defaultValue=""
            data-1p-ignore="true"
            data-lpignore="true"
            data-bwignore="true"
            data-form-type="other"
          />
        </label>
      </div>
      <input type="hidden" name={FORM_TOKEN_FIELD} value={issueFormToken()} />
    </>
  );
}
