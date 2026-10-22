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
};

export type CountryVisitReport =
  | { available: false }
  | {
      available: true;
      /** The first day with any count, "YYYY-MM-DD", or null before the first. */
      since: string | null;
      /** Busiest over 30 days first. */
      rows: CountryVisitRow[];
      /** Sum over every country, for the headline numbers and the bars' shares. */
      totals: { d7: number; d30: number; total: number };
    };

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
  const { since, rows } = data as { since?: unknown; rows?: unknown };
  if (!Array.isArray(rows)) return { available: false };

  const parsed: CountryVisitRow[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const { country, d7, d30, total } = row as Record<string, unknown>;
    if (typeof country !== "string" || !/^[A-Z]{2}$/.test(country)) continue;
    parsed.push({ country, d7: numeric(d7), d30: numeric(d30), total: numeric(total) });
  }

  const totals = parsed.reduce(
    (sum, row) => ({ d7: sum.d7 + row.d7, d30: sum.d30 + row.d30, total: sum.total + row.total }),
    { d7: 0, d30: 0, total: 0 },
  );
  return {
    available: true,
    since: typeof since === "string" && /^\d{4}-\d{2}-\d{2}$/.test(since) ? since : null,
    rows: parsed,
    totals,
  };
}

let regionNames: Intl.DisplayNames | null | undefined;

/**
 * The country's name in Uyghur, e.g. TR → «تۈركىيە». Falls back to the code
 * itself when the platform's locale data has no name for it (Intl answers
 * with the code, or throws on an unknown locale).
 */
export function countryName(code: string): string {
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
