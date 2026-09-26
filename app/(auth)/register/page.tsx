import type { Metadata } from "next";
import Link from "next/link";
import { OfflineFormNotice } from "@/components/pwa/offline-form-notice";
import { Icon } from "@/components/icons";
import { BotFields } from "@/components/auth/bot-fields";
import { RegisterEmailField } from "@/components/auth/register-email-field";
import { isRegistrationPaused } from "@/lib/auth/account-security";
import { readRegisterDraft, readSentTo } from "@/lib/auth/flash";
import {
  BLOCKED_MESSAGE,
  BOT_MESSAGE,
  DISPOSABLE_MESSAGE,
  EMAIL_CAP_MESSAGE,
  LOCKED_MESSAGE,
  PAUSED_MESSAGE,
  readWaitSeconds,
  waitMessage,
} from "@/lib/auth/messages";
import { acceptSuggestionAction, keepSuggestionAction, signUpAction } from "../actions";

export const metadata: Metadata = { title: "تىزىمدىن ئۆتۈش" };

/**
 * No message here tells a reader to change a setting they cannot reach: what
 * the owner has to fix (the email allowance, the email provider switch) goes
 * to the server log instead (PROMPT-38 B6).
 */
const ERRORS: Record<string, string> = {
  empty: "ئېلخەت ۋە پارولنى تولۇق كىرگۈزۈڭ.",
  short: "پارول كەم دېگەندە 6 ھەرپ بولسۇن.",
  exists: "بۇ ئېلخەت بىلەن بۇرۇن تىزىمدىن ئۆتۈلگەن. كىرىش بېتىنى ئىشلىتىڭ.",
  bad_email: "بۇ ئېلخەت ئادرېسى قوبۇل قىلىنمىدى. ھەقىقىي ئېلخەت ئادرېسى كىرگۈزۈڭ.",
  blocked: BLOCKED_MESSAGE,
  disposable: DISPOSABLE_MESSAGE,
  locked: LOCKED_MESSAGE,
  bot: BOT_MESSAGE,
  paused: PAUSED_MESSAGE,
  disabled: "ھازىر يېڭى ھېسابات ئېچىش ئېتىۋېتىلگەن.",
  provider_off: "ھازىر ئېلخەت بىلەن تىزىمدىن ئۆتكىلى بولمايدۇ. كېيىنرەك قايتا سىناڭ.",
  email_limit: EMAIL_CAP_MESSAGE,
  send_failed: "جەزملەش خېتىنى ھازىر بۇ ئادرېسقا ئەۋەتكىلى بولمىدى. بىرئاز ۋاقىتتىن كېيىن قايتا سىناڭ.",
  rate_limit: "ئۇرۇنۇش سانى كۆپىيىپ كەتتى. بىردەم كۈتۈپ قايتا سىناڭ.",
  config: "سايت تېخى ساندانغا ئۇلانمىغان. باشقۇرغۇچى تەڭشىگەندىن كېيىن قايتا سىناڭ.",
  failed: "تىزىمدىن ئۆتۈش مەغلۇپ بولدى. سەل تۇرۇپ قايتا سىناڭ.",
};

export default async function RegisterPage({ searchParams }: PageProps<"/register">) {
  const params = await searchParams;
  const code = typeof params.xata === "string" ? params.xata : undefined;
  const xata =
    code === "wait" ? waitMessage(readWaitSeconds(params.s) ?? 60) : code ? ERRORS[code] : undefined;

  /**
   * What the reader typed last, bar the password — kept in a short-lived
   * cookie by the action, never in the URL. «ئادرېس خاتا بولسا…» on the
   * sign-in page arrives with ?fix=1 and fills the form from where the
   * confirmation email went instead.
   */
  const draft = await readRegisterDraft();
  const sent = params.fix === "1" ? await readSentTo() : null;
  const email = sent?.email ?? draft?.email ?? "";
  const displayName = sent?.name ?? draft?.name ?? "";

  /**
   * While the owner has paused registration (/admin), the form is not drawn
   * at all — only the notice. The action refuses a stale form regardless, and
   * the database's hook refuses a sign-up that skips the site.
   */
  const paused = await isRegistrationPaused();

  return (
    <div className="mx-auto w-full max-w-md px-4 py-8 sm:py-12">
      <div className="paper grain p-6 sm:p-8">
        <h1 className="flex items-center gap-2.5 text-xl font-bold">
          <Icon name="user" className="ic-lg text-am" />
          تىزىمدىن ئۆتۈش
        </h1>
        <p className="mt-2 text-[13px] leading-6 text-ink3">
          ھېسابات ھەقسىز — خەتكۈچ قويۇش، خاتىرە يېزىش ۋە ئوقۇش ئىزىڭىزنى ساقلاش ئۈچۈن ئىشلىتىلىدۇ.
        </p>

        {paused ? (
          <p
            role="status"
            data-testid="registration-paused"
            className="mt-4 rounded-[var(--radius)] border border-bd2 bg-ab2 px-3.5 py-3 text-[13px] leading-6 text-ink"
          >
            {PAUSED_MESSAGE}
          </p>
        ) : (
          <>
            {xata && (
              <div
                role="alert"
                data-testid="auth-error"
                className="mt-4 rounded-[var(--radius)] border border-bd2 bg-ab2 px-3.5 py-3 text-[13px] leading-6 text-ink"
              >
                <p data-testid="auth-error-text">{xata}</p>
                {code === "locked" && (
                  <Link
                    href="/login"
                    data-testid="locked-login-link"
                    className="inline-flex min-h-11 items-center font-semibold text-am underline"
                  >
                    كىرىش بېتىگە ئۆتۈش
                  </Link>
                )}
              </div>
            )}
            <RegisterForm email={email} displayName={displayName} draft={draft} fromSent={Boolean(sent)} />
          </>
        )}

        <p className="mt-5 text-[13px] text-ink2">
          ھېساباتىڭىز بارمۇ؟{" "}
          <Link href="/login" className="font-semibold text-am underline">
            كىرىڭ
          </Link>
        </p>
      </div>
    </div>
  );
}

/** The form itself, drawn only while registration is open. */
function RegisterForm({
  email,
  displayName,
  draft,
  fromSent,
}: {
  email: string;
  displayName: string;
  draft: Awaited<ReturnType<typeof readRegisterDraft>>;
  fromSent: boolean;
}) {
  return (
    <form action={signUpAction} className="mt-5 space-y-4">
      <label className="block">
        <span className="mb-1.5 block text-[13px] font-semibold text-ink2">كۆرسىتىلىدىغان ئىسىم</span>
        <input
          className="field"
          type="text"
          name="display_name"
          maxLength={60}
          autoComplete="name"
          placeholder="مەسىلەن: ئالىم"
          defaultValue={displayName}
        />
      </label>
      <RegisterEmailField
        // A new draft is a new field: remount rather than keep stale state.
        key={`${email}|${draft?.suggestion ?? ""}|${draft?.kept ?? ""}`}
        defaultEmail={email}
        initialSuggestion={fromSent ? null : (draft?.suggestion ?? null)}
        initialKept={fromSent ? "" : (draft?.kept ?? "")}
        acceptAction={acceptSuggestionAction}
        keepAction={keepSuggestionAction}
      />
      <label className="block">
        <span className="mb-1.5 block text-[13px] font-semibold text-ink2">پارول (كەم دېگەندە 6 ھەرپ)</span>
        <input
          className="field"
          type="password"
          name="password"
          required
          minLength={6}
          dir="ltr"
          autoComplete="new-password"
        />
      </label>
      <BotFields />
      <OfflineFormNotice>
        <button type="submit" className="btn-am w-full">
          تىزىمدىن ئۆتۈش
        </button>
      </OfflineFormNotice>
    </form>
  );
}
