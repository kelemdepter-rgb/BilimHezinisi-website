import { HeadingSkeleton, PageSkeleton, RowsSkeleton } from "@/components/skeletons";

/**
 * Search is the slowest thing the site does, so it is the page that most
 * needs to say it heard the request. The field itself is redrawn at its own
 * height, because on a phone it is most of the screen above the fold.
 */
export default function SearchLoading() {
  return (
    <PageSkeleton>
      <HeadingSkeleton width="w-28" />
      <div className="mt-4 flex flex-wrap gap-2">
        <span className="skel h-12 min-w-0 flex-1" />
        <span className="skel h-12 w-24" />
      </div>
      <RowsSkeleton count={5} height="h-24" />
    </PageSkeleton>
  );
}
