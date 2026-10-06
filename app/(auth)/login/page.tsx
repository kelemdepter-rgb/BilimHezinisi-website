import type { Metadata } from "next";
import Link from "next/link";
import { Icon } from "@/components/icons";
import { OfflineFormNotice } from "@/components/pwa/offline-form-notice";
import { ResendButton } from "@/components/auth/resend-button";
import { readLoginDraft, readSentTo, resendSecondsLeft } from "@/lib/auth/flash";
import { BLOCKED_MESSAGE, LOCKED_MESSAGE, RESENT_MESSAGE } from "@/lib/auth/messages";
import { resendConfirmationAction, signInAction } from "../actions";

export const metadata: Metadata = { title: "كىرىش" };

const ERRORS: Record<string, string> = {
  empty: "ئېلخەت ۋە پارولنى تولۇق كىرگۈزۈڭ.",
  empty_resend: "ئېلخەت ئادرېسىڭىزنى كىرگۈزۈڭ.",
  credentials: "ئېلخەت ياكى پارول خاتا. قايتا سىناڭ.",
  bad_email: "بۇ ئېلخەت ئادرېسى قوبۇل قىلىنمىدى. ھەقىقىي ئېلخەت ئادرېسى كىرگۈزۈڭ.",
  blocked: BLOCKED_MESSAGE,
  locked: LOCKED_MESSAGE,
  unconfirmed: "ئېلخېتىڭىز تېخى جەزملەنمىگەن. ساندۇقىڭىزدىكى جەزملەش ئۇلانمىسىنى بېسىڭ.",
  rate_limit: "ئۇرۇنۇش سانى كۆپىيىپ كەتتى. بىردەم كۈتۈپ قايتا سىناڭ.",
  provider_off: "ھازىر ئېلخەت بىلەن كىرگىلى بولمايدۇ. كېيىنرەك قايتا سىناڭ.",
  config: "سايت تېخى ساندانغا ئۇلانمىغان. باشقۇرغۇچى تەڭشىگەندىن كېيىن قايتا سىناڭ.",
  confirm_failed: "جەزملەش ئۇلانمىسى ئىناۋەتسىز ياكى ۋاقتى ئۆتكەن. قايتا كىرىپ سىناڭ.",
  failed: "كىرىش مەغلۇپ بولدى. سەل تۇرۇپ قايتا سىناڭ.",
};

const NOTICES: Record<string, string> = {
  confirm: "تىزىمدىن ئۆتتىڭىز! ئېلخەت ساندۇقىڭىزغا كەلگەن جەزملەش ئۇلانمىسىنى بېسىپ، ئاندىن كىرىڭ.",
  resent: RESENT_MESSAGE,
};

const LINK = "inline-flex min-h-11 items-center font-semibold text-am underline";

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const params = await searchParams;
  const code = typeof params.xata === "string" ? params.xata : undefined;
  const xata = code ? ERRORS[code] : undefined;
  const notice = typeof params.uqtur === "string" ? params.uqtur : undefined;
  const uqtur = notice ? NOTICES[notice] : undefined;

  /**
   * Where the confirmation email went and what was typed here last — both
   * from short-lived cookies the actions set, never from the URL, so an
   * address never lands in a log or the browser's history.
   */
  const draft = await readLoginDraft();
  const sent = notice === "confirm" || notice === "resent" ? await readSentTo() : null;

  /**
   * «Resend the confirmation email» is offered where it can help: right after
   * registering, after a resend, when signing in was refused because the
   * address is unconfirmed, and when a resend itself came back with an error.
   */
  const offerResend =
    notice === "confirm" || notice === "resent" || code === "unconfirmed" || params.resend === "1";
  const secondsLeft = offerResend ? await resendSecondsLeft() : 0;

  return (
    <div className="mx-auto w-full max-w-md px-4 py-8 sm:py-12">
      <div className="paper grain p-6 sm:p-8">
        <h1 className="flex items-center gap-2.5 text-xl font-bold">
          <Icon name="log-in" className="ic-lg text-am" />
          كىرىش
        </h1>
        <p className="mt-2 text-[13px] leading-6 text-ink3">
          كىتاب ئوقۇش ئۈچۈن ھېسابات شەرت ئەمەس — خەتكۈچ، خاتىرە ۋە ئوقۇش ئىزى ئۈچۈن كىرىسىز.
        </p>

        {uqtur && (
          <div
            role="status"
            data-testid="auth-notice"
            className="mt-4 rounded-[var(--radius)] bg-ab px-3.5 py-3 text-[13px] leading-6 text-ink"
          >
            <p data-testid="auth-notice-text">{uqtur}</p>
            {sent && (
              <>
                <p className="mt-2">جەزملەش خېتى مۇشۇ ئادرېسقا ئەۋەتىلدى:</p>
                {/* Its own left-to-right line, lined up with the text above;
                    a very long address wraps only where it has to. */}
                <p dir="ltr" data-testid="sent-to" className="text-end font-semibold [overflow-wrap:anywhere]">
                  {sent.email}
                </p>
                <Link href="/register?fix=1" data-testid="reregister-link" className={LINK}>
                  ئادرېس خاتا بولسا، قايتا تىزىملىتىڭ
                </Link>
              </>
            )}
          </div>
        )}
        {xata && (
          <div
            role="alert"
            data-testid="auth-error"
            className="mt-4 rounded-[var(--radius)] border border-bd2 bg-ab2 px-3.5 py-3 text-[13px] leading-6 text-ink"
          >
            <p data-testid="auth-error-text">{xata}</p>
            {code === "locked" && (
              <Link href="/forgot-password" data-testid="locked-forgot-link" className={LINK}>
                پارولنى ئۇنتۇدىڭىزمۇ؟
              </Link>
            )}
          </div>
        )}

        {offerResend && (
          <form action={resendConfirmationAction} className="mt-4 space-y-3" data-testid="resend-form">
            {/* The address shown just above goes as it is; otherwise the
                reader sees, and may correct, where the email will go. */}
            {sent ? (
              <input type="hidden" name="email" value={sent.email} />
            ) : (
              <label className="block">
                <span className="mb-1.5 block text-[13px] font-semibold text-ink2">
                  تىزىملاتقان ئېلخەت ئادرېسىڭىز
                </span>
                <input
                  className="field"
                  type="email"
                  name="email"
                  required
                  dir="ltr"
                  autoComplete="email"
                  placeholder="siz@example.com"
                  defaultValue={draft?.email ?? ""}
                  data-testid="resend-email"
                />
              </label>
            )}
            <OfflineFormNotice>
              <ResendButton secondsLeft={secondsLeft} />
            </OfflineFormNotice>
          </form>
        )}

        <form action={signInAction} className="mt-5 space-y-4">
          <label className="block">
            <span className="mb-1.5 block text-[13px] font-semibold text-ink2">ئېلخەت ئادرېسى</span>
            <input
              className="field"
              type="email"
              name="email"
              required
              dir="ltr"
              autoComplete="email"
              placeholder="siz@example.com"
              defaultValue={draft?.email ?? ""}
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-[13px] font-semibold text-ink2">پارول</span>
            <input
              className="field"
              type="password"
              name="password"
              required
              minLength={6}
              dir="ltr"
              autoComplete="current-password"
            />
          </label>
          <OfflineFormNotice>
            <button type="submit" className="btn-am w-full">
              كىرىش
            </button>
          </OfflineFormNotice>
        </form>

        <p className="mt-4 text-[13px] text-ink2">
          <Link
            href="/forgot-password"
            data-testid="forgot-password-link"
            className="font-semibold text-am underline"
          >
            پارولنى ئۇنتۇپ قالدىم.
          </Link>
        </p>

        <p className="mt-3 text-[13px] text-ink2">
          <Link href="/register" className="font-semibold text-am underline">
            تىزىملىتىپ كىرىڭ.
          </Link>
        </p>
      </div>
    </div>
  );
}
