import type { Metadata } from "next";
import Link from "next/link";
import { Icon } from "@/components/icons";
import { signInAction } from "../actions";

export const metadata: Metadata = { title: "كىرىش" };

const ERRORS: Record<string, string> = {
  empty: "ئېلخەت ۋە پارولنى تولۇق كىرگۈزۈڭ.",
  credentials: "ئېلخەت ياكى پارول خاتا. قايتا سىناڭ.",
  unconfirmed: "ئېلخېتىڭىز تېخى جەزملەنمىگەن. ساندۇقىڭىزدىكى جەزملەش ئۇلانمىسىنى بېسىڭ.",
  rate_limit: "ئۇرۇنۇش سانى كۆپىيىپ كەتتى. بىردەم كۈتۈپ قايتا سىناڭ.",
  provider_off:
    "ئېلخەت بىلەن كىرىش ئۇسۇلى Supabase دا ئېتىۋېتىلگەن. Authentication → Sign In / Providers → Email بۆلىكىدىن ئۇنى ئېچىڭ.",
  config: "سايت تېخى ساندانغا ئۇلانمىغان. باشقۇرغۇچى تەڭشىگەندىن كېيىن قايتا سىناڭ.",
  confirm_failed: "جەزملەش ئۇلانمىسى ئىناۋەتسىز ياكى ۋاقتى ئۆتكەن. قايتا كىرىپ سىناڭ.",
  failed: "كىرىش مەغلۇپ بولدى. سەل تۇرۇپ قايتا سىناڭ.",
};

const NOTICES: Record<string, string> = {
  confirm: "تىزىمدىن ئۆتتىڭىز! ئېلخەت ساندۇقىڭىزغا كەلگەن جەزملەش ئۇلانمىسىنى بېسىپ، ئاندىن كىرىڭ.",
};

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const params = await searchParams;
  const xata = typeof params.xata === "string" ? ERRORS[params.xata] : undefined;
  const uqtur = typeof params.uqtur === "string" ? NOTICES[params.uqtur] : undefined;

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
          <p role="status" className="mt-4 rounded-[var(--radius)] bg-ab px-3.5 py-3 text-[13px] leading-6 text-ink">
            {uqtur}
          </p>
        )}
        {xata && (
          <p role="alert" className="mt-4 rounded-[var(--radius)] border border-bd2 bg-ab2 px-3.5 py-3 text-[13px] leading-6 text-ink">
            {xata}
          </p>
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
          <button type="submit" className="btn-am w-full">
            كىرىش
          </button>
        </form>

        <p className="mt-4 text-[13px] text-ink2">
          <Link
            href="/forgot-password"
            data-testid="forgot-password-link"
            className="font-semibold text-am underline"
          >
            پارولنى ئۇنتۇدىڭىزمۇ؟
          </Link>
        </p>

        <p className="mt-3 text-[13px] text-ink2">
          ھېساباتىڭىز يوقمۇ؟{" "}
          <Link href="/register" className="font-semibold text-am underline">
            تىزىمدىن ئۆتۈڭ
          </Link>
        </p>
      </div>
    </div>
  );
}
