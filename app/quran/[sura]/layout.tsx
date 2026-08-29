import { notFound } from "next/navigation";
import { getAyas, getSuras } from "@/lib/quran/data";

/**
 * There are 114 suras and no others. Asked in front of the loading boundary,
 * because once the skeleton has been flushed the status line has gone out
 * with it and a notFound() in the page can no longer make it a 404.
 *
 * Both reads are cached, so this costs nothing the page was not going to
 * spend anyway.
 */
export default async function SuraLayout({ children, params }: LayoutProps<"/quran/[sura]">) {
  const { sura } = await params;
  const suraNumber = /^\d+$/.test(sura) ? Number(sura) : null;
  if (suraNumber === null || suraNumber < 1 || suraNumber > 114) notFound();
  const [suras, ayas] = await Promise.all([getSuras(), getAyas(suraNumber)]);
  if (!suras.some((item) => item.number === suraNumber) || ayas.length === 0) notFound();
  return children;
}
