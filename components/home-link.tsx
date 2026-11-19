import Image from "next/image";
import Link from "next/link";
import { LinkPending } from "@/components/nav-pending";
import brandMark from "@/public/brand.png";

/**
 * The way home from a surface that renders without the site header
 * (PROMPT-54): the book reader, a sura, a note and a trashed note.
 *
 * Without it the only way out was the browser's own back — which a phone
 * that installed the site as an app (standalone PWA) does not have. It is
 * always the first control of its toolbar, the right edge in RTL.
 *
 * Below 640 px it is the brand mark alone, as in the site header, in a
 * 44 × 44 box with no border; from 640 px up it is an .hbtn holding a
 * smaller mark and the words «باش بەت». The image keeps the site header's
 * 30 px size, so it is the same file — and the same cached copy offline.
 */
export function HomeLink() {
  return (
    <Link
      href="/"
      data-testid="home-link"
      aria-label="باش بەت"
      title="باش بەت"
      className="hbtn relative shrink-0 max-sm:border-transparent max-sm:p-0"
    >
      <Image
        src={brandMark}
        alt=""
        width={30}
        height={30}
        className="size-[30px] shrink-0 rounded-[7px] shadow-sm ring-1 ring-bd sm:size-5 sm:rounded-[5px]"
      />
      <span className="hidden sm:inline">باش بەت</span>
      {/* In a corner, so the mark stays centred in its box. */}
      <span className="pointer-events-none absolute bottom-1 start-1 flex">
        <LinkPending />
      </span>
    </Link>
  );
}
