import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Icon } from "@/components/icons";
import { DeleteAccount } from "@/components/my/delete-account";
import { OfflineStorage } from "@/components/my/offline-storage";
import { SearchHistoryControl } from "@/components/my/search-history-control";
import { countAdmins, getAccountOwner } from "@/lib/my/account";
import type { Role } from "@/lib/types";

export const metadata: Metadata = {
  title: "ھېساباتىم",
  robots: { index: false, follow: false },
};

const ROLE_LABELS: Record<Role, string> = {
  admin: "باشقۇرغۇچى",
  uploader: "كىتاب قوشقۇچى",
  reader: "ئوقۇرمەن",
};

const ERRORS: Record<string, string> = {
  email_mismatch: "ئېلخەت ئادرېسى ماس كەلمىدى. ھېساباتىڭىز ئۆچۈرۈلمىدى.",
  last_admin:
    "سىز بىردىنبىر باشقۇرغۇچى بولغاچقا ھېساباتىڭىز ئۆچۈرۈلمىدى. ئالدى بىلەن باشقا بىر باشقۇرغۇچى بەلگىلەڭ.",
  config: "سايت تېخى تولۇق تەڭشەلمىگەن. باشقۇرغۇچىغا خەۋەر قىلىڭ.",
  failed: "ئۆچۈرگىلى بولمىدى. سەل تۇرۇپ قايتا سىناڭ.",
};

const NOTICES: Record<string, string> = {
  password_changed: "پارولىڭىز يېڭىلاندى.",
};

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-CA").format(date);
}

export default async function AccountPage({ searchParams }: PageProps<"/my/account">) {
  const [params, owner] = await Promise.all([searchParams, getAccountOwner()]);
  // This page is entirely about one person's own data.
  if (!owner) redirect("/login");

  const xata = typeof params.xata === "string" ? ERRORS[params.xata] : undefined;
  const uqtur = typeof params.uqtur === "string" ? NOTICES[params.uqtur] : undefined;

  // Refusing to delete the last admin needs the count before the button is
  // even offered, so the reason can be explained instead of thrown back.
  const admins = owner.role === "admin" ? await countAdmins() : null;
  const lastAdmin = owner.role === "admin" && (admins === null || admins <= 1);

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-6 sm:px-6 sm:py-8">
      <h1 className="flex items-center gap-2.5 text-xl font-bold">
        <Icon name="user" className="ic-lg text-am" />
        ھېساباتىم
      </h1>

      {uqtur && (
        <p
          role="status"
          data-testid="account-notice"
          className="mt-4 rounded-[var(--radius)] bg-ab px-3.5 py-3 text-[13px] leading-6 text-ink"
        >
          {uqtur}
        </p>
      )}
      {xata && (
        <p
          role="alert"
          data-testid="account-error"
          className="mt-4 rounded-[var(--radius)] border border-bd2 bg-ab2 px-3.5 py-3 text-[13px] leading-6 text-ink"
        >
          {xata}
        </p>
      )}

      <section className="paper grain mt-5 p-5 sm:p-6" aria-labelledby="account-details">
        <h2 id="account-details" className="flex items-center gap-2 text-[15px] font-bold">
          <Icon name="info" className="text-am" />
          ھېسابات ئۇچۇرى
        </h2>
        <dl className="mt-3 space-y-2.5 text-[13.5px]">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <dt className="font-semibold text-ink2">ئېلخەت:</dt>
            <dd dir="ltr" className="min-w-0 break-all" data-testid="account-email">
              {owner.email}
            </dd>
          </div>
          <div className="flex flex-wrap items-baseline gap-x-2">
            <dt className="font-semibold text-ink2">ئىسىم:</dt>
            <dd className="min-w-0 break-words">{owner.displayName}</dd>
          </div>
          <div className="flex flex-wrap items-baseline gap-x-2">
            <dt className="font-semibold text-ink2">سالاھىيەت:</dt>
            <dd>{ROLE_LABELS[owner.role]}</dd>
          </div>
          <div className="flex flex-wrap items-baseline gap-x-2">
            <dt className="font-semibold text-ink2">ئېچىلغان ۋاقتى:</dt>
            <dd dir="ltr">{formatDate(owner.createdAt)}</dd>
          </div>
        </dl>
      </section>

      <section className="paper grain mt-4 p-5 sm:p-6" aria-labelledby="account-export">
        <h2 id="account-export" className="flex items-center gap-2 text-[15px] font-bold">
          <Icon name="download" className="text-am" />
          سانلىق مەلۇماتىمنى چۈشۈرۈش
        </h2>
        <p className="mt-2 text-[13px] leading-7 text-ink2">
          خەتكۈچلىرىڭىز، كىتابقا يازغان خاتىرىلىرىڭىز، ئوقۇش ئىزىڭىز، قۇرئان خەتكۈچلىرىڭىز
          ۋە خاتىرە دەپتىرىڭىزنىڭ ھەممىسى بىر JSON ھۆججىتىگە يىغىلىپ چۈشۈرۈلىدۇ. ھۆججەت
          پەقەت سىزنىڭ ئۆز ئۇچۇرلىرىڭىزدىن تۈزۈلىدۇ.
        </p>
        <a href="/my/export" download className="btn-am mt-4" data-testid="export-download">
          <Icon name="download" />
          JSON ھۆججىتىنى چۈشۈرۈش
        </a>
      </section>

      <section className="paper grain mt-4 p-5 sm:p-6" aria-labelledby="account-search-history">
        <h2 id="account-search-history" className="flex items-center gap-2 text-[15px] font-bold">
          <Icon name="search" className="text-am" />
          ئىزدەش تارىخىم
        </h2>
        <SearchHistoryControl />
      </section>

      <section className="paper grain mt-4 p-5 sm:p-6" aria-labelledby="account-offline">
        <h2 id="account-offline" className="flex items-center gap-2 text-[15px] font-bold">
          <Icon name="globe" className="text-am" />
          تورسىز ئوقۇش ئۈچۈن ساقلانغان مەزمۇن
        </h2>
        <OfflineStorage />
      </section>

      <section className="paper grain mt-4 p-5 sm:p-6" aria-labelledby="account-password">
        <h2 id="account-password" className="flex items-center gap-2 text-[15px] font-bold">
          <Icon name="key" className="text-am" />
          پارولنى ئۆزگەرتىش
        </h2>
        <p className="mt-2 text-[13px] leading-7 text-ink2">
          پارولنى ئۆزگەرتىش ئۈچۈن ئېلخېتىڭىزگە بىر ئۇلانما ئەۋەتىمىز. بۇ ئۇسۇل
          كومپيۇتېرىڭىزنى بىر دەملىك تاشلاپ قويغان بولسىڭىزمۇ باشقىلارنىڭ پارولىڭىزنى
          ئۆزگەرتىۋېتىشىنىڭ ئالدىنى ئالىدۇ.
        </p>
        <Link href="/forgot-password" className="hbtn mt-4" data-testid="change-password">
          <Icon name="mail" />
          ئۇلانما ئەۋەتىش
        </Link>
      </section>

      <section
        className="mt-4 rounded-[var(--radius-lg)] border border-bd2 p-5 sm:p-6"
        aria-labelledby="account-delete"
      >
        <h2 id="account-delete" className="flex items-center gap-2 text-[15px] font-bold">
          <Icon name="trash" className="text-danger" />
          ھېساباتىمنى ئۆچۈرۈش
        </h2>
        <p className="mt-2 text-[13px] leading-7 text-ink2">
          ھېساباتىڭىز ۋە ئۇنىڭغا باغلانغان بارلىق ئۇچۇرلار مەڭگۈلۈك ئۆچۈرۈلىدۇ. ئۆچۈرۈشتىن
          بۇرۇن يۇقىرىدىكى چۈشۈرۈش كۇنۇپكىسى ئارقىلىق نۇسخا ئېلىۋېلىشىڭىزنى تەۋسىيە
          قىلىمىز. كۇتۇپخانىدىكى كىتابلار ھەممەيلەنگە ئورتاق بولغاچقا ئۆچمەيدۇ.
        </p>
        <div className="mt-4">
          <DeleteAccount email={owner.email} blocked={lastAdmin} />
        </div>
      </section>
    </div>
  );
}
