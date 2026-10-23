import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Icon } from "@/components/icons";
import { CountryVisitsReport } from "@/components/admin/country-visits-card";
import { getServerRole } from "@/lib/admin/guards";
import { getCountryVisitReport } from "@/lib/visits/data";

export const metadata: Metadata = { title: "دۆلەتلەر بويىچە كىرىش" };

/**
 * «دۆلەتلەر بويىچە كىرىش» — which countries the library is opened from
 * (lib/visits, migration 0033). Its own tab since 2026-10-23, so the
 * dashboard stays short. Admin-only, like «ئەزالار»: the layout lets
 * uploaders into /admin, and this page sends them back to the dashboard.
 */
export default async function AdminVisitsPage() {
  const session = await getServerRole();
  if (!session) redirect("/login");
  if (session.role !== "admin") redirect("/admin");

  const report = await getCountryVisitReport();

  return (
    <>
      <h1 className="flex items-center gap-2.5 text-xl font-bold">
        <Icon name="globe" className="ic-lg text-am" />
        دۆلەتلەر بويىچە كىرىش
      </h1>
      <p className="mt-1.5 max-w-3xl text-[13px] leading-6 text-ink3">
        قايسى دۆلەتتىن قانچە قېتىم بەت ئېچىلغانلىقى. بۇ <strong>ئادەم سانى ئەمەس</strong>، بەت ئېچىلىش
        سانى: بىر ئادەم نەچچە بەت ئاچسا شۇنچە سانىلىدۇ. IP ئادرېس ۋە شەخسىي ئۇچۇر ساقلانمايدۇ.
        شەرقىي تۈركىستان جۇڭگودىن ئايرىم سانىلىدۇ.
      </p>
      <p className="mt-1 max-w-3xl text-[13px] leading-6 text-ink3">
        «ئۈسكۈنە» ئادەم سانىغا يېقىنراق: ھەر بىر تېلېفون ياكى كومپيۇتېر كۈنىگە بىرلا قېتىم سانىلىدۇ. 7 ۋە 30
        كۈنلۈك ئۈسكۈنە سانى كۈنلۈك سانلارنىڭ يىغىندىسى؛ بىر ئادەمنىڭ تېلېفونى بىلەن كومپيۇتېرى ئىككى بولىدۇ.
        سىز ۋە كىتاب يوللىغۇچىلارنىڭ كىرىشى سانالمايدۇ.
      </p>
      <CountryVisitsReport report={report} />
    </>
  );
}
