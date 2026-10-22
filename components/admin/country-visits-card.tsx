import { Icon } from "@/components/icons";
import { countryName, shareOf, type CountryVisitReport } from "@/lib/visits/report";

/** How many countries the bar diagram shows; the table below lists all of them. */
const TOP_COUNTRIES = 10;

const count = (n: number) => n.toLocaleString("en-US");
const percent = (n: number) => `${n >= 10 ? n.toFixed(0) : n.toFixed(1)}%`;

/**
 * «دۆلەتلەر بويىچە كىرىش» on /admin, for the admin only: which countries the
 * library is opened from (lib/visits, migration 0033).
 *
 * Server-rendered, no script. Every bar carries its number and share as text,
 * so nothing depends on seeing the bar. What is counted is page OPENINGS — not
 * people — and the card says so, because a reader of the chart would
 * otherwise take «Türkiye 310» for 310 readers.
 */
export function CountryVisitsCard({ report }: { report: CountryVisitReport }) {
  if (!report.available) {
    return (
      <div className="paper mt-5 p-5" data-testid="country-visits-card" data-state="unavailable">
        <h2 className="flex items-center gap-2 text-[15px] font-bold">
          <Icon name="globe" className="text-am" />
          دۆلەتلەر بويىچە كىرىش
        </h2>
        <p className="mt-2 text-[13px] leading-7 text-ink2">
          سانىغۇچ ھازىرچە ئىشلىمەيدۇ. <code>0033_country_visits.sql</code> نى Supabase دا ئىجرا قىلسىڭىز،
          بۇ يەردە دۆلەت بويىچە كىرىش سانى كۆرۈنىدۇ.
        </p>
      </div>
    );
  }

  const { rows, totals, since } = report;
  const recent = rows.filter((row) => row.d30 > 0);
  const top = recent.slice(0, TOP_COUNTRIES);
  const rest = recent.slice(TOP_COUNTRIES).reduce((sum, row) => sum + row.d30, 0);
  const widest = top[0]?.d30 ?? 0;

  return (
    <section className="paper grain mt-5 p-5" aria-labelledby="country-visits" data-testid="country-visits-card" data-state="ready">
      <h2 id="country-visits" className="flex items-center gap-2 text-[15px] font-bold">
        <Icon name="globe" className="text-am" />
        دۆلەتلەر بويىچە كىرىش
      </h2>
      <p className="mt-2 text-[12.5px] leading-6 text-ink3">
        قايسى دۆلەتتىن قانچە قېتىم بەت ئېچىلغانلىقى. بۇ <strong>ئادەم سانى ئەمەس</strong>، بەت ئېچىلىش
        سانى: بىر ئادەم نەچچە بەت ئاچسا شۇنچە سانىلىدۇ. IP ئادرېس ۋە شەخسىي ئۇچۇر ساقلانمايدۇ.
      </p>

      {rows.length === 0 ? (
        <p className="mt-4 text-[13px] leading-7 text-ink2" data-testid="country-visits-empty">
          تېخى سان يوق. سانىغۇچ قوشۇلغاندىن كېيىنكى بىرىنچى كىرىشلەر شۇ يەردە كۆرۈنىدۇ.
        </p>
      ) : (
        <>
          <dl className="mt-4 grid gap-2 text-[13px] sm:grid-cols-3">
            <Fact label="ئاخىرقى 7 كۈن" value={count(totals.d7)} testId="visits-7d" />
            <Fact label="ئاخىرقى 30 كۈن" value={count(totals.d30)} testId="visits-30d" />
            <Fact label={since ? `${since} دىن بېرى` : "ھەممىسى"} value={count(totals.total)} testId="visits-total" />
          </dl>

          <h3 className="mt-5 text-[13.5px] font-bold text-ink">ئاخىرقى 30 كۈندىكى ئەڭ كۆپ دۆلەتلەر</h3>
          {top.length === 0 ? (
            <p className="mt-2 text-[13px] leading-7 text-ink2">ئاخىرقى 30 كۈندە كىرىش بولمىدى.</p>
          ) : (
            <ol className="mt-3 space-y-2" data-testid="country-bars">
              {top.map((row) => (
                <li key={row.country} className="grid grid-cols-[minmax(5.5rem,8rem)_1fr_auto] items-center gap-3 text-[13px]">
                  <span className="truncate font-semibold text-ink2" title={`${countryName(row.country)} (${row.country})`}>
                    {countryName(row.country)}
                  </span>
                  <span className="h-2.5 overflow-hidden rounded-full bg-bg3" aria-hidden="true">
                    <span
                      className="block h-full rounded-full bg-am"
                      style={{ width: `${Math.max(2, (row.d30 / widest) * 100)}%` }}
                    />
                  </span>
                  <span className="whitespace-nowrap font-bold" dir="ltr">
                    {count(row.d30)}
                    <span className="ms-1.5 font-normal text-ink3">{percent(shareOf(row.d30, totals.d30))}</span>
                  </span>
                </li>
              ))}
              {rest > 0 && (
                <li className="text-[12.5px] text-ink3">
                  باشقا {count(recent.length - top.length)} دۆلەت: {count(rest)} ({percent(shareOf(rest, totals.d30))})
                </li>
              )}
            </ol>
          )}

          <details className="mt-5 border-t border-bd pt-4" data-testid="country-table">
            <summary className="cursor-pointer text-[13.5px] font-bold text-ink">
              بارلىق دۆلەتلەر ({count(rows.length)})
            </summary>
            <div className="mt-3 overflow-x-auto overscroll-x-contain">
              <table className="w-full min-w-[20rem] border-collapse text-[13px]">
                <thead>
                  <tr className="text-ink3">
                    <th scope="col" className="py-1.5 pe-3 text-start font-semibold">دۆلەت</th>
                    <th scope="col" className="px-3 py-1.5 text-start font-semibold">7 كۈن</th>
                    <th scope="col" className="px-3 py-1.5 text-start font-semibold">30 كۈن</th>
                    <th scope="col" className="ps-3 py-1.5 text-start font-semibold">ھەممىسى</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.country} className="border-t border-bd">
                      <th scope="row" className="py-1.5 pe-3 text-start font-semibold text-ink2">
                        {countryName(row.country)} <span className="font-normal text-ink3" dir="ltr">{row.country}</span>
                      </th>
                      <td className="px-3 py-1.5 tabular-nums" dir="ltr">{count(row.d7)}</td>
                      <td className="px-3 py-1.5 tabular-nums" dir="ltr">{count(row.d30)}</td>
                      <td className="ps-3 py-1.5 font-bold tabular-nums" dir="ltr">{count(row.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </>
      )}
    </section>
  );
}

function Fact({ label, value, testId }: { label: string; value: string; testId: string }) {
  return (
    <div className="flex justify-between gap-2 rounded-[var(--radius)] bg-bg2 px-3 py-2">
      <dt className="text-ink3">{label}</dt>
      <dd className="font-bold" data-testid={testId}>{value}</dd>
    </div>
  );
}
