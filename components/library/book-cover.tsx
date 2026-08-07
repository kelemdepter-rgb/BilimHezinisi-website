import Image from "next/image";
import { Icon } from "@/components/icons";

/**
 * A book cover, or a manuscript-style placeholder when there is none, so the
 * grid never shows a broken image.
 *
 * Real covers go through next/image: Vercel optimises and caches them on its
 * CDN, so Supabase serves each cover once rather than once per visitor.
 */
export function BookCover({
  coverUrl,
  title,
  author,
  sizes,
  priority = false,
}: {
  coverUrl: string | null;
  title: string;
  author?: string;
  sizes: string;
  priority?: boolean;
}) {
  if (coverUrl) {
    return (
      <Image
        src={coverUrl}
        alt=""
        fill
        sizes={sizes}
        priority={priority}
        loading={priority ? undefined : "lazy"}
        className="object-cover"
      />
    );
  }
  return (
    <span className="grain flex h-full w-full flex-col items-center justify-center gap-2 bg-paper p-3 text-center">
      <Icon name="book" className="ic-lg text-am" />
      <span className="line-clamp-3 text-[12.5px] font-bold leading-5 text-ink">{title}</span>
      {author && <span className="line-clamp-1 text-[11px] text-ink3">{author}</span>}
    </span>
  );
}
