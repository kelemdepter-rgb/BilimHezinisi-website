import type { Metadata } from "next";
import Link from "next/link";
import { Icon } from "@/components/icons";
import { signUpAction } from "../actions";

export const metadata: Metadata = { title: "تىزىمدىن ئۆتۈش" };

const ERRORS: Record<string, string> = {
  empty: "ئېلخەت ۋە پارولنى تولۇق كىرگۈزۈڭ.",
  short: "پارول كەم دېگەندە 6 ھەرپ بولسۇن.",
  exists: "بۇ ئېلخەت بىلەن بۇرۇن تىزىمدىن ئۆتۈلگەن. كىرىش بېتىنى ئىشلىتىڭ.",
  bad_email: "بۇ ئېلخەت ئادرېسى قوبۇل قىلىنمىدى. ھەقىقىي ئېلخەت ئادرېسى كىرگۈزۈڭ.",
  disabled: "ھازىر يېڭى ھېسابات ئېچىش ئېتىۋېتىلگەن.",
  provider_off:
    "ئېلخەت بىلەن كىرىش ئۇسۇلى Supabase دا ئېتىۋېتىلگەن. Authentication → Sign In / Providers → Email بۆلىكىدىن ئۇنى ئېچىڭ.",
  email_limit:
    "جەزملەش ئېلخېتى ئەۋەتىش چېكىدىن ئېشىپ كەتتى. Supabase تەڭشىكىدىن «Confirm email» نى ئېتىۋەتسىڭىز ئېلخەت ھاجەتسىز بولىدۇ، بولمىسا بىر سائەت كۈتۈڭ.",
  rate_limit: "ئۇرۇنۇش سانى كۆپىيىپ كەتتى. بىردەم كۈتۈپ قايتا سىناڭ.",
  config: "سايت تېخى ساندانغا ئۇلانمىغان. باشقۇرغۇچى تەڭشىگەندىن كېيىن قايتا سىناڭ.",
  failed: "تىزىمدىن ئۆتۈش مەغلۇپ بولدى. سەل تۇرۇپ قايتا سىناڭ.",
};

export default async function RegisterPage({ searchParams }: PageProps<"/register">) {
  const params = await searchParams;
  const xata = typeof params.xata === "string" ? ERRORS[params.xata] : undefined;

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

        {xata && (
          <p role="alert" className="mt-4 rounded-[var(--radius)] border border-bd2 bg-ab2 px-3.5 py-3 text-[13px] leading-6 text-ink">
            {xata}
          </p>
        )}

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
            />
          </label>
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
          <button type="submit" className="btn-am w-full">
            تىزىمدىن ئۆتۈش
          </button>
        </form>

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
