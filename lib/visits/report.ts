/**
 * What /admin shows about where the library is opened from — the pure part:
 * reading the database's answer and naming the countries. The server-only
 * loader that fetches it is lib/visits/data.ts.
 */

export type CountryVisitRow = {
  /** ISO 3166-1 alpha-2, capitals. */
  country: string;
  /** Page openings in the last 7 UTC days, today included. */
  d7: number;
  d30: number;
  /** Everything kept — a year at most. */
  total: number;
  /** First-of-the-day devices (migration 0034): sums of daily counts. */
  dev7: number;
  dev30: number;
  devtotal: number;
};

/** One UTC day of the last 30, every country together. */
export type VisitDay = { day: string; visits: number; devices: number };

type Totals = { d7: number; d30: number; total: number; dev7: number; dev30: number; devtotal: number };

export type CountryVisitReport =
  | { available: false }
  | {
      available: true;
      /** The first day with any count, "YYYY-MM-DD", or null before the first. */
      since: string | null;
      /** Busiest over 30 days first. */
      rows: CountryVisitRow[];
      /** Sum over every country, for the headline numbers and the bars' shares. */
      totals: Totals;
      /** The last 30 UTC days, oldest first. Empty before migration 0034. */
      days: VisitDay[];
      /** Whether migration 0034 (devices, days) is in place. */
      devicesAvailable: boolean;
    };

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

const numeric = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : 0;
};

/**
 * Turn the jsonb that `country_visit_stats()` returns into a report. Anything
 * that is not the expected shape reads as "not available" rather than as an
 * empty list, so a broken answer is never mistaken for «nobody visited».
 */
export function parseCountryVisitReport(data: unknown): CountryVisitReport {
  if (!data || typeof data !== "object") return { available: false };
  const { since, rows, days } = data as { since?: unknown; rows?: unknown; days?: unknown };
  if (!Array.isArray(rows)) return { available: false };

  const parsed: CountryVisitRow[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const { country, d7, d30, total, dev7, dev30, devtotal } = row as Record<string, unknown>;
    if (typeof country !== "string" || !/^[A-Z]{2}$/.test(country)) continue;
    parsed.push({
      country,
      d7: numeric(d7),
      d30: numeric(d30),
      total: numeric(total),
      dev7: numeric(dev7),
      dev30: numeric(dev30),
      devtotal: numeric(devtotal),
    });
  }

  const totals = parsed.reduce<Totals>(
    (sum, row) => ({
      d7: sum.d7 + row.d7,
      d30: sum.d30 + row.d30,
      total: sum.total + row.total,
      dev7: sum.dev7 + row.dev7,
      dev30: sum.dev30 + row.dev30,
      devtotal: sum.devtotal + row.devtotal,
    }),
    { d7: 0, d30: 0, total: 0, dev7: 0, dev30: 0, devtotal: 0 },
  );

  const series: VisitDay[] = [];
  if (Array.isArray(days)) {
    for (const entry of days) {
      if (!entry || typeof entry !== "object") continue;
      const { day, visits, devices } = entry as Record<string, unknown>;
      if (typeof day !== "string" || !ISO_DAY.test(day)) continue;
      series.push({ day, visits: numeric(visits), devices: numeric(devices) });
    }
  }

  return {
    available: true,
    since: typeof since === "string" && ISO_DAY.test(since) ? since : null,
    rows: parsed,
    totals,
    days: series,
    devicesAvailable: Array.isArray(days),
  };
}

let regionNames: Intl.DisplayNames | null | undefined;

/**
 * Names the platform does not know, or that the owner names himself. The
 * key is lib/visits/count.ts EAST_TURKISTAN, written out because this module
 * is imported by components and stays free of the counting code.
 */
const OWN_NAMES: Record<string, string> = { XJ: "شەرقىي تۈركىستان" };

/** Whether a code is a real ISO 3166-1 country rather than one of ours. */
export function isOwnCode(code: string): boolean {
  return code in OWN_NAMES;
}

/**
 * The country's name in Uyghur, e.g. TR → «تۈركىيە», XJ → «شەرقىي تۈركىستان». Falls back to the code
 * itself when the platform's locale data has no name for it (Intl answers
 * with the code, or throws on an unknown locale).
 */
export function countryName(code: string): string {
  if (code in OWN_NAMES) return OWN_NAMES[code];
  if (regionNames === undefined) {
    try {
      regionNames = new Intl.DisplayNames(["ug"], { type: "region", fallback: "code" });
    } catch {
      regionNames = null;
    }
  }
  try {
    return regionNames?.of(code) || code;
  } catch {
    return code;
  }
}

/** `part` as a percentage of `whole` (0–100); 0 when either is not positive. */
export function shareOf(part: number, whole: number): number {
  if (whole <= 0 || part <= 0) return 0;
  return (part / whole) * 100;
}
