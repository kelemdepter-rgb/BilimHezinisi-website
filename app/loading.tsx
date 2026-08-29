import {
  BookGridSkeleton,
  HeadingSkeleton,
  LibraryControlsSkeleton,
  PageSkeleton,
} from "@/components/skeletons";

/**
 * The library, and every category view of it.
 *
 * This is the click the owner reported: choosing a category left the previous
 * page on screen, unchanged, until the whole response had arrived. Now the
 * grid it is about to fill appears at once.
 *
 * The «بۇ ئايدىكى يېڭى كىتابلار» strip above it is deliberately not drawn:
 * inside a category there is no such strip, and a placeholder that is
 * sometimes replaced by nothing is worse than no placeholder at all.
 */
export default function LibraryLoading() {
  return (
    <PageSkeleton>
      <div className="mb-5">
        <HeadingSkeleton />
      </div>
      <LibraryControlsSkeleton />
      <BookGridSkeleton />
    </PageSkeleton>
  );
}
