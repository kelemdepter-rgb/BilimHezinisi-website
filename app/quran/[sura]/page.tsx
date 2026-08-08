import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { Mushaf } from "@/components/quran/mushaf";
import { getSessionInfo } from "@/lib/data";
import { getAyas, getSuraBookmarks, getSuras } from "@/lib/quran/data";
import { THEME_COOKIE, isTheme } from "@/lib/theme";

function parseSura(value: string): number | null {
  const number = Number(value);
  return Number.isInteger(number) && number >= 1 && number <= 114 ? number : null;
}

export async function generateMetadata({ params }: PageProps<"/quran/[sura]">): Promise<Metadata> {
  const { sura } = await params;
  const suraNumber = parseSura(sura);
  if (suraNumber === null) return { title: "قۇرئان كەرىم" };
  const found = (await getSuras()).find((item) => item.number === suraNumber);
  return {
    title: found ? `${found.name_ug} سۈرىسى` : "قۇرئان كەرىم",
    description: found
      ? `${found.name_ar} — ${found.name_ug} سۈرىسى، ${found.aya_count} ئايەت. ئەرەبچە مەتنى ۋە ئۇيغۇرچە تەرجىمىسى.`
      : undefined,
  };
}

export default async function SuraPage({ params, searchParams }: PageProps<"/quran/[sura]">) {
  const [{ sura }, query] = await Promise.all([params, searchParams]);
  const suraNumber = parseSura(sura);
  if (suraNumber === null) notFound();

  const [suras, ayas, bookmarks, session, cookieStore] = await Promise.all([
    getSuras(),
    getAyas(suraNumber),
    getSuraBookmarks(suraNumber),
    getSessionInfo(),
    cookies(),
  ]);

  const current = suras.find((item) => item.number === suraNumber);
  if (!current || ayas.length === 0) notFound();

  const requestedAya = typeof query.aya === "string" ? Number(query.aya) : NaN;
  const initialAya =
    Number.isInteger(requestedAya) && requestedAya >= 1 && requestedAya <= current.aya_count
      ? requestedAya
      : null;

  const rawTheme = cookieStore.get(THEME_COOKIE)?.value;

  return (
    <Mushaf
      sura={current}
      suras={suras}
      ayas={ayas}
      initialAya={initialAya}
      initialBookmarks={bookmarks}
      signedIn={Boolean(session)}
      theme={isTheme(rawTheme) ? rawTheme : null}
    />
  );
}
