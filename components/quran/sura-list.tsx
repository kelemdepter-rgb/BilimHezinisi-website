"use client";

import { useId, useState } from "react";
import Link from "next/link";
import { filterSuras, revelationLabel, toArabicNumerals } from "@/lib/quran/format";
import type { Sura } from "@/lib/quran/types";

/**
 * The 114 suras with a filter box that matches Arabic name, Uyghur name,
 * transliteration and number — the desktop sidebar, adapted to a list of
 * links so it works on a phone and without JavaScript for the links.
 */
export function SuraList({
  suras,
  activeSura = null,
  onNavigate,
}: {
  suras: Sura[];
  activeSura?: number | null;
  onNavigate?: () => void;
}) {
  const [filter, setFilter] = useState("");
  const inputId = useId();
  const matches = filterSuras(suras, filter);

  return (
    <div className="flex min-h-0 flex-col">
      <label className="sr-only" htmlFor={inputId}>
        سۈرە ئىزدەش
      </label>
      <input
        autoComplete="off"
        id={inputId}
        type="search"
        className="field"
        data-testid="sura-filter"
        value={filter}
        placeholder="سۈرە ئىزدەش…"
        onChange={(event) => setFilter(event.target.value)}
      />

      {matches.length === 0 ? (
        <p className="mt-3 rounded-[var(--radius)] bg-ab px-3 py-3 text-center text-[13px] text-ink2">
          نەتىجە يوق
        </p>
      ) : (
        <ul className="mt-3 space-y-1" data-testid="sura-list">
          {matches.map((sura) => (
            <li key={sura.number}>
              <Link
                href={`/quran/${sura.number}`}
                onClick={onNavigate}
                data-testid="sura-link"
                data-sura={sura.number}
                aria-current={sura.number === activeSura ? "page" : undefined}
                className={`flex min-h-11 items-center gap-3 rounded-[var(--radius)] px-2.5 py-2 hover:bg-bg2 ${
                  sura.number === activeSura ? "bg-ab" : ""
                }`}
              >
                <span className="quran-sura-num">{toArabicNumerals(sura.number)}</span>
                <span className="min-w-0 flex-1">
                  <span className="quran-face block truncate text-[17px] leading-8 text-ink">
                    {sura.name_ar}
                  </span>
                  <span className="block truncate text-[12px] text-ink3">
                    {sura.name_ug} · {revelationLabel(sura.revelation)}
                  </span>
                </span>
                <span className="shrink-0 text-[12px] text-ink2" dir="ltr">
                  {sura.aya_count}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
