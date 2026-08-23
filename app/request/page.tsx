import type { Metadata } from "next";
import Link from "next/link";
import { Icon } from "@/components/icons";
import { submitRequestAction } from "@/app/request/actions";
import { REQUEST_LIMITS, issueStamp } from "@/lib/requests";
import { SITE_NAME } from "@/lib/seo";

export const metadata: Metadata = {
  title: "كىتاب تەلەپ قىلىش",
  description: `${SITE_NAME}دە كۆرمىگەن كىتابىڭىزنى تەلەپ قىلىڭ — ھېسابات شەرت ئەمەس.`,
  alternates: { canonical: "/request" },
  openGraph: { title: "كىتاب تەلەپ قىلىش", url: "/request" },
};

/**
 * The form is served fresh on every request — it carries a signed timestamp,
 * and a cached page would hand everyone the same stale one.
 */
export const dynamic = "force-dynamic";

const ERRORS: Record<string, string> = {
  empty: "كىتابنىڭ ئىسمىنى يېزىڭ.",
  rate: "بىر سائەت ئىچىدە بىر قانچە تەلەپ يوللىدىڭىز. سەل تۇرۇپ قايتا سىناڭ.",
  full: "بۈگۈنكى تەلەپ ساندۇقى تولۇپ كەتتى. ئەتە قايتا سىناڭ — تەلىپىڭىز بىزگە مۇھىم.",
  failed: "تەلەپ يوللانمىدى. سەل تۇرۇپ قايتا سىناڭ.",
};

export default async function RequestPage({ searchParams }: PageProps<"/request">) {
  const params = await searchParams;
  const xata = typeof params.xata === "string" ? ERRORS[params.xata] : undefined;
  const sent = params.uqtur === "sent";

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-6 sm:px-6 sm:py-8">
      <h1 className="flex items-center gap-2.5 text-xl font-bold">
        <Icon name="mail" className="ic-lg text-am" />
        كىتاب تەلەپ قىلىش
      </h1>
      <p className="mt-2 text-[13.5px] leading-7 text-ink2">
        ئىزدىگەن كىتابىڭىزنى تاپالمىدىڭىزمۇ؟ بىزگە ئېيتىڭ. ھېسابات ئېچىش شەرت ئەمەس.
        يازغىنىڭىزنى پەقەت كۇتۇپخانا باشقۇرغۇچىسىلا كۆرىدۇ — ھېچقايسى بەتتە
        كۆرۈنمەيدۇ.
      </p>

      {sent && (
        <p
          role="status"
          data-testid="request-sent"
          className="mt-4 rounded-[var(--radius)] bg-ab px-3.5 py-3 text-[13px] leading-6 text-ink"
        >
          تەلىپىڭىز يوللاندى. رەھمەت! كىتاب تېپىلسا كۇتۇپخانىغا قوشۇلىدۇ.
        </p>
      )}
      {xata && (
        <p
          role="alert"
          data-testid="request-error"
          className="mt-4 rounded-[var(--radius)] border border-bd2 bg-ab2 px-3.5 py-3 text-[13px] leading-6 text-ink"
        >
          {xata}
        </p>
      )}

      <form action={submitRequestAction} className="paper grain mt-5 space-y-4 p-5 sm:p-6">
        {/* Signed on the server, checked on the way back in: a form that comes
            back in under two seconds was not filled in by a person. */}
        <input type="hidden" name="ts" value={issueStamp()} />

        {/*
          The honeypot. Not `display: none` — a bot that reads CSS skips those —
          but clipped out of the layout, out of the tab order and out of the
          accessibility tree, so nobody using the page can reach it and nobody
          using a screen reader is told it exists.

          Clipped rather than pushed off to `left: -9999px`: under dir="rtl"
          that is the direction the page overflows in, and it would have given
          a 360 px phone a horizontal scrollbar to nowhere.
        */}
        <div aria-hidden="true" className="pointer-events-none sr-only">
          <label>
            تور بېكەت
            <input type="text" name="website" tabIndex={-1} autoComplete="off" />
          </label>
        </div>

        <label className="block">
          <span className="mb-1.5 block text-[13px] font-semibold text-ink2">
            كىتابنىڭ ئىسمى <span className="text-am">*</span>
          </span>
          <input
            className="field"
            type="text"
            name="title"
            required
            maxLength={REQUEST_LIMITS.title}
            data-testid="request-title"
            placeholder="مەسىلەن: قۇتادغۇ بىلىك"
          />
        </label>

        <label className="block">
          <span className="mb-1.5 block text-[13px] font-semibold text-ink2">ئاپتورى</span>
          <input
            className="field"
            type="text"
            name="author"
            maxLength={REQUEST_LIMITS.author}
            data-testid="request-author"
          />
        </label>

        <label className="block">
          <span className="mb-1.5 block text-[13px] font-semibold text-ink2">
            قوشۇمچە ئىزاھات
          </span>
          <textarea
            className="field min-h-24"
            name="note"
            rows={4}
            maxLength={REQUEST_LIMITS.note}
            data-testid="request-note"
            placeholder="نەشرىياتى، يىلى، ياكى قەيەردىن تاپقىلى بولىدىغانلىقى…"
          />
        </label>

        <label className="block">
          <span className="mb-1.5 block text-[13px] font-semibold text-ink2">
            ئېلخېتىڭىز (خالىغانچە)
          </span>
          <input
            className="field"
            type="email"
            name="contact"
            dir="ltr"
            maxLength={REQUEST_LIMITS.contact}
            autoComplete="email"
            data-testid="request-contact"
            placeholder="siz@example.com"
          />
          <span className="mt-1.5 block text-[12px] leading-5 text-ink3">
            كىتاب قوشۇلغاندا خەۋەر قىلىش ئۈچۈنلا ئىشلىتىلىدۇ. باشقا ھېچ يەرگە
            بېرىلمەيدۇ ۋە ھېچقايسى بەتتە كۆرۈنمەيدۇ.
          </span>
        </label>

        <button type="submit" className="btn-am w-full" data-testid="request-submit">
          <Icon name="mail" />
          تەلەپنى يوللاش
        </button>
      </form>

      <p className="mt-4 text-[12.5px] leading-6 text-ink3">
        كۇتۇپخانا قانداق ئىشلەيدۇ دېگەننى{" "}
        <Link href="/about" className="text-am underline">
          ھەققىدە
        </Link>{" "}
        بېتىدىن، ئۇچۇرلىرىڭىزنىڭ قانداق ساقلىنىدىغانلىقىنى{" "}
        <Link href="/privacy" className="text-am underline">
          مەخپىيەتلىك
        </Link>{" "}
        بېتىدىن كۆرەلەيسىز.
      </p>
    </div>
  );
}
