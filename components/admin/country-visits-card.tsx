import { countryName, isOwnCode, shareOf, type CountryVisitReport, type VisitDay } from "@/lib/visits/report";

/** How many countries the bar diagram shows; the table below lists all of them. */
const TOP_COUNTRIES = 10;

const count = (n: number) => n.toLocaleString("en-US");
const percent = (n: number) => `${n >= 10 ? n.toFixed(0) : n.toFixed(1)}%`;

/**
 * The body of /admin/visits: which countries the library is opened from
 * (lib/visits, migration 0033). The page supplies the heading and the
 * «page openings, not people» explanation.
 *
 * Server-rendered, no script. Every bar carries its number and share as text,
 * so nothing depends on seeing the bar.
 */
export function CountryVisitsReport({ report }: { report: CountryVisitReport }) {
  if (!report.available) {
    return (
      <p className="paper mt-5 p-5 text-[13px] leading-7 text-ink2" data-testid="country-visits-card" data-state="unavailable">
        سانىغۇچ ھازىرچە ئىشلىمەيدۇ. <code>0033_country_visits.sql</code> نى Supabase دا ئىجرا قىلسىڭىز، بۇ
        يەردە دۆلەت بويىچە كىرىش سانى كۆرۈنىدۇ.
      </p>
    );
  }

  const { rows, totals, since, days, devicesAvailable } = report;
  if (rows.length === 0) {
    return (
      <p className="paper mt-5 p-5 text-[13px] leading-7 text-ink2" data-testid="country-visits-card" data-state="empty">
        تېخى سان يوق. سانىغۇچ قوشۇلغاندىن كېيىنكى بىرىنچى كىرىشلەر شۇ يەردە كۆرۈنىدۇ.
      </p>
    );
  }

  const recent = rows.filter((row) => row.d30 > 0);
  const top = recent.slice(0, TOP_COUNTRIES);
  const rest = recent.slice(TOP_COUNTRIES).reduce((sum, row) => sum + row.d30, 0);
  const widest = top[0]?.d30 ?? 0;

  return (
    <div data-testid="country-visits-card" data-state="ready">
      {!devicesAvailable && (
        <p className="mt-5 rounded-[var(--radius)] border border-bd2 bg-ab2 px-3.5 py-2.5 text-[12.5px] leading-6 text-ink" data-testid="devices-unavailable">
          ئۈسكۈنە سانى ۋە 30 كۈنلۈك سىزىق ئۈچۈن <code>0034_country_devices.sql</code> نى Supabase دا ئىجرا قىلىڭ.
        </p>
      )}

      <div className="mt-5 grid gap-2 text-[13px] sm:grid-cols-3">
        <Fact label="ئاخىرقى 7 كۈن" devices={totals.dev7} openings={totals.d7} showDevices={devicesAvailable} testId="visits-7d" />
        <Fact label="ئاخىرقى 30 كۈن" devices={totals.dev30} openings={totals.d30} showDevices={devicesAvailable} testId="visits-30d" />
        <Fact
          label={since ? `${since} دىن بېرى` : "ھەممىسى"}
          devices={totals.devtotal}
          openings={totals.total}
          showDevices={devicesAvailable}
          testId="visits-total"
        />
      </div>

      {days.length > 0 && <DailyChart days={days} />}

      <section className="paper grain mt-5 p-5" aria-labelledby="country-bars-title">
        <h2 id="country-bars-title" className="text-[14px] font-bold text-ink">
          ئاخىرقى 30 كۈندىكى ئەڭ كۆپ دۆلەتلەر
        </h2>
        {top.length === 0 ? (
          <p className="mt-2 text-[13px] leading-7 text-ink2">ئاخىرقى 30 كۈندە كىرىش بولمىدى.</p>
        ) : (
          <ol className="mt-3 space-y-2" data-testid="country-bars">
            {top.map((row) => (
              <li key={row.country} className="grid grid-cols-[minmax(5.5rem,9rem)_1fr_auto] items-center gap-3 text-[13px]">
                <span className="truncate font-semibold text-ink2" title={countryName(row.country)}>
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
      </section>

      <section className="paper mt-5 p-5" aria-labelledby="country-table-title" data-testid="country-table">
        <h2 id="country-table-title" className="text-[14px] font-bold text-ink">
          بارلىق دۆلەتلەر ({count(rows.length)})
        </h2>
        <div className="mt-3 overflow-x-auto overscroll-x-contain">
          <table className="w-full min-w-[22rem] border-collapse text-[13px]">
            <thead>
              <tr className="text-ink3">
                <th scope="col" className="py-1.5 pe-3 text-start font-semibold">دۆلەت</th>
                <th scope="col" className="px-3 py-1.5 text-start font-semibold">7 كۈن</th>
                <th scope="col" className="px-3 py-1.5 text-start font-semibold">30 كۈن</th>
                <th scope="col" className="px-3 py-1.5 text-start font-semibold">ھەممىسى</th>
                {devicesAvailable && (
                  <th scope="col" className="ps-3 py-1.5 text-start font-semibold">ئۈسكۈنە (30 كۈن)</th>
                )}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.country} className="border-t border-bd">
                  <th scope="row" className="py-1.5 pe-3 text-start font-semibold text-ink2">
                    {countryName(row.country)}
                    {!isOwnCode(row.country) && (
                      <span className="ms-1.5 font-normal text-ink3" dir="ltr">{row.country}</span>
                    )}
                  </th>
                  <td className="px-3 py-1.5 tabular-nums" dir="ltr">{count(row.d7)}</td>
                  <td className="px-3 py-1.5 tabular-nums" dir="ltr">{count(row.d30)}</td>
                  <td className="px-3 py-1.5 font-bold tabular-nums" dir="ltr">{count(row.total)}</td>
                  {devicesAvailable && (
                    <td className="ps-3 py-1.5 tabular-nums" dir="ltr">{count(row.dev30)}</td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function Fact({
  label,
  devices,
  openings,
  showDevices,
  testId,
}: {
  label: string;
  devices: number;
  openings: number;
  showDevices: boolean;
  testId: string;
}) {
  return (
    <dl className="rounded-[var(--radius)] bg-bg2 px-3 py-2" data-testid={testId}>
      <dt className="text-ink3">{label}</dt>
      {showDevices && (
        <dd className="mt-1 flex justify-between gap-2">
          <span className="text-ink2">ئۈسكۈنە</span>
          <span className="font-bold" data-testid={`${testId}-devices`}>{count(devices)}</span>
        </dd>
      )}
      <dd className="mt-0.5 flex justify-between gap-2">
        <span className="text-ink2">بەت ئېچىلىش</span>
        <span className="font-bold" data-testid={`${testId}-openings`}>{count(openings)}</span>
      </dd>
    </dl>
  );
}

/**
 * The last 30 days as columns: page openings (pale) with that day's devices
 * (gold) inside. Oldest at the start of the line — the right, in this RTL
 * page — today at the end, the same way the dates under it read. Each column
 * names its day and numbers on hover; the totals are in the label.
 */
function DailyChart({ days }: { days: VisitDay[] }) {
  const peak = Math.max(1, ...days.map((day) => Math.max(day.visits, day.devices)));
  const height = (n: number) => `${(n / peak) * 100}%`;
  const visits = days.reduce((sum, day) => sum + day.visits, 0);
  const devices = days.reduce((sum, day) => sum + day.devices, 0);

  return (
    <section className="paper grain mt-5 p-5" aria-labelledby="daily-chart-title" data-testid="daily-chart">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="daily-chart-title" className="text-[14px] font-bold text-ink">
          ئاخىرقى 30 كۈن
        </h2>
        <p className="flex flex-wrap gap-3 text-[12px] text-ink3">
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-sm bg-ab2" aria-hidden="true" />
            بەت ئېچىلىش
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-sm bg-am" aria-hidden="true" />
            ئۈسكۈنە
          </span>
        </p>
      </div>
      <div
        className="mt-4 flex h-36 items-end gap-[3px]"
        role="img"
        aria-label={`ئاخىرقى 30 كۈن: جەمئىي ${count(visits)} بەت ئېچىلىش، ${count(devices)} ئۈسكۈنە`}
      >
        {days.map((day) => (
          <div
            key={day.day}
            className="relative h-full min-w-0 flex-1"
            title={`${day.day}: ${count(day.visits)} بەت ئېچىلىش، ${count(day.devices)} ئۈسكۈنە`}
          >
            <span className="absolute inset-x-0 bottom-0 rounded-t-[2px] bg-ab2" style={{ height: height(day.visits) }} />
            <span className="absolute inset-x-[22%] bottom-0 rounded-t-[2px] bg-am" style={{ height: height(day.devices) }} />
          </div>
        ))}
      </div>
      <div className="mt-1.5 flex justify-between text-[11.5px] text-ink3">
        <span dir="ltr">{days[0].day}</span>
        <span>بۈگۈن</span>
      </div>
    </section>
  );
}
