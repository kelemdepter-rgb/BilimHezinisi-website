import type { Metadata } from "next";
import Link from "next/link";
import { Icon } from "@/components/icons";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { updatePasswordAction } from "../actions";

export const metadata: Metadata = {
  title: "يېڭى پارول بەلگىلەش",
  robots: { index: false, follow: false },
};

const ERRORS: Record<string, string> = {
  empty: "يېڭى پارولنى ئىككى قۇرغىمۇ كىرگۈزۈڭ.",
  short: "پارول كەم دېگەندە 6 ھەرپ بولۇشى كېرەك.",
  mismatch: "ئىككى پارول ئوخشىمىدى. قايتا كىرگۈزۈڭ.",
  same: "يېڭى پارول كونىسى بىلەن ئوخشاش. باشقا پارول تاللاڭ.",
  expired: "ئۇلانمىنىڭ ۋاقتى ئۆتكەن ياكى ئىناۋەتسىز. يېڭى ئۇلانما تەلەپ قىلىڭ.",
  rate_limit: "ئۇرۇنۇش سانى كۆپىيىپ كەتتى. بىردەم كۈتۈپ قايتا سىناڭ.",
  config: "سايت تېخى ساندانغا ئۇلانمىغان. باشقۇرغۇچى تەڭشىگەندىن كېيىن قايتا سىناڭ.",
  failed: "پارولنى يېڭىلىغىلى بولمىدى. سەل تۇرۇپ قايتا سىناڭ.",
};

export default async function ResetPasswordPage({ searchParams }: PageProps<"/reset-password">) {
  const params = await searchParams;
  const xata = typeof params.xata === "string" ? ERRORS[params.xata] : undefined;

  /**
   * The recovery link signs the visitor in before it lands here, so "is there
   * a session" is the same question as "did they arrive through a valid
   * link". Someone who opens this URL cold gets sent back to ask for one
   * rather than a form that could only fail.
   */
  const supabase = await createSupabaseServerClient();
  const { data } = (await supabase?.auth.getUser()) ?? { data: { user: null } };
  const linkValid = Boolean(data.user);

  return (
    <div className="mx-auto w-full max-w-md px-4 py-8 sm:py-12">
      <div className="paper grain p-6 sm:p-8">
        <h1 className="flex items-center gap-2.5 text-xl font-bold">
          <Icon name="key" className="ic-lg text-am" />
          يېڭى پارول بەلگىلەش
        </h1>

        {!linkValid ? (
          <>
            <p
              role="alert"
              data-testid="reset-link-invalid"
              className="mt-4 rounded-[var(--radius)] border border-bd2 bg-ab2 px-3.5 py-3 text-[13px] leading-6 text-ink"
            >
              بۇ ئۇلانما ئىناۋەتسىز ياكى ۋاقتى ئۆتكەن. يېڭى ئۇلانما تەلەپ قىلىڭ.
            </p>
            <Link href="/forgot-password" className="btn-am mt-5 w-full">
              يېڭى ئۇلانما تەلەپ قىلىش
            </Link>
          </>
        ) : (
          <>
            <p className="mt-2 text-[13px] leading-6 text-ink3">
              يېڭى پارولىڭىزنى كىرگۈزۈڭ. ساقلىغاندىن كېيىن ھېساباتىڭىزغا ئۆزلۈكىدىن كىرىسىز.
            </p>

            {xata && (
              <p
                role="alert"
                data-testid="reset-error"
                className="mt-4 rounded-[var(--radius)] border border-bd2 bg-ab2 px-3.5 py-3 text-[13px] leading-6 text-ink"
              >
                {xata}
              </p>
            )}

            <form action={updatePasswordAction} className="mt-5 space-y-4">
              <label className="block">
                <span className="mb-1.5 block text-[13px] font-semibold text-ink2">يېڭى پارول</span>
                <input
                  className="field"
                  type="password"
                  name="password"
                  required
                  minLength={6}
                  dir="ltr"
                  autoComplete="new-password"
                  data-testid="new-password"
                />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-[13px] font-semibold text-ink2">
                  يېڭى پارولنى قايتا كىرگۈزۈڭ
                </span>
                <input
                  className="field"
                  type="password"
                  name="confirm"
                  required
                  minLength={6}
                  dir="ltr"
                  autoComplete="new-password"
                  data-testid="confirm-password"
                />
              </label>
              <button type="submit" className="btn-am w-full" data-testid="save-password">
                پارولنى ساقلاش
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
