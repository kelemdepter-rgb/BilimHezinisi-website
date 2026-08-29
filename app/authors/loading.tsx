import { HeadingSkeleton, LineSkeleton, PageSkeleton } from "@/components/skeletons";

/**
 * Covers the author index and each author's shelf. Both open with the same
 * heading and summary line, so the shape is honest either way; the list below
 * is a one-column stack on a phone and three across on a desktop, matching
 * the real grid.
 */
export default function AuthorsLoading() {
  return (
    <PageSkeleton>
      <HeadingSkeleton width="w-32" />
      <div className="mt-2">
        <LineSkeleton width="w-40" />
      </div>
      <ul className="mt-5 grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 9 }, (_, index) => (
          <li key={index} className="skel h-[68px] w-full" />
        ))}
      </ul>
    </PageSkeleton>
  );
}
