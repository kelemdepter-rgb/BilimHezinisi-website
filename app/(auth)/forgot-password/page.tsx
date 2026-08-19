import type { Metadata } from "next";
import Link from "next/link";
import { Icon } from "@/components/icons";
import { requestPasswordResetAction } from "../actions";

export const metadata: Metadata = {
  title: "پارولنى ئەسلىگە كەلتۈرۈش",
  robots: { index: false, follow: false },
};

const ERRORS: Record<string, string> = {
  empty: "ئېلخەت ئادرېسىڭىزنى كىرگۈزۈڭ.",
  rate_limit: "ئۇرۇنۇش سانى كۆپىيىپ كەتتى. بىر سائەتتىن كېيىن قايتا سىناڭ.",
  email_limit: "ھازىر ئېلخەت ئەۋەتىش چېكى توشۇپ قالدى. بىردەم كۈتۈپ قايتا سىناڭ.",
  provider_off:
    "ئېلخەت ئەۋەتىش Supabase دا ئېتىۋېتىلگەن. Authentication → Sign In / Providers → Email بۆلىكىدىن ئۇنى ئېچىڭ.",
  config: "سايت تېخى ساندانغا ئۇلانمىغان. باشقۇرغۇچى تەڭشىگەندىن كېيىن قايتا سىناڭ.",
  failed: "ئەۋەتىش مەغلۇپ بولدى. سەل تۇرۇپ قايتا سىناڭ.",
};

/**
 * Deliberately identical whether or not that address has an account. Telling
 * the visitor "no such user" would turn this form into a way to test which
 * emails are registered here.
 */
const SENT_NOTICE =
  "ئەگەر بۇ ئېلخەت ئادرېسى بىلەن ھېسابات ئېچىلغان بولسا، پارولنى يېڭىلاش ئۇلانمىسى ئەۋەتىلدى. ساندۇقىڭىزنى، شۇنداقلا «Spam» بۆلىكىنى تەكشۈرۈپ بېقىڭ.";

export default async function ForgotPasswordPage({
  searchParams,
}: PageProps<"/forgot-password">) {
  const params = await searchParams;
  const xata = typeof params.xata === "string" ? ERRORS[params.xata] : undefined;
  const sent = params.uqtur === "sent";

  return (
    <div className="mx-auto w-full max-w-md px-4 py-8 sm:py-12">
      <div className="paper grain p-6 sm:p-8">
        <h1 className="flex items-center gap-2.5 text-xl font-bold">
          <Icon name="key" className="ic-lg text-am" />
          پارولنى ئۇنتۇدىڭىزمۇ؟
        </h1>
        <p className="mt-2 text-[13px] leading-6 text-ink3">
          ھېساباتىڭىزنىڭ ئېلخەت ئادرېسىنى يېزىڭ. سىزگە پارولنى يېڭىلاش ئۇلانمىسى ئەۋەتىمىز.
        </p>

        {sent && (
          <p
            role="status"
            data-testid="reset-sent"
            className="mt-4 rounded-[var(--radius)] bg-ab px-3.5 py-3 text-[13px] leading-6 text-ink"
          >
            {SENT_NOTICE}
          </p>
        )}
        {xata && (
          <p
            role="alert"
            data-testid="reset-error"
            className="mt-4 rounded-[var(--radius)] border border-bd2 bg-ab2 px-3.5 py-3 text-[13px] leading-6 text-ink"
          >
            {xata}
          </p>
        )}

        <form action={requestPasswordResetAction} className="mt-5 space-y-4">
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
              data-testid="reset-email"
            />
          </label>
          <button type="submit" className="btn-am w-full" data-testid="reset-submit">
            ئۇلانما ئەۋەتىش
          </button>
        </form>

        <p className="mt-5 text-[13px] text-ink2">
          پارولىڭىز ئېسىڭىزدىمۇ؟{" "}
          <Link href="/login" className="font-semibold text-am underline">
            كىرىش بېتىگە قايتىش
          </Link>
        </p>
      </div>
    </div>
  );
}
