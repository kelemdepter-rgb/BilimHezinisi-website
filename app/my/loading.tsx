import { HeadingSkeleton, LineSkeleton, PageSkeleton, RowsSkeleton } from "@/components/skeletons";

/**
 * One skeleton for every personal page — the account, the AI settings, the
 * bookmarks and the saved notes. They share a heading, a line of explanation
 * and a stack of panels, which is exactly what this draws.
 */
export default function MyLoading() {
  return (
    <PageSkeleton>
      <HeadingSkeleton width="w-40" />
      <div className="mt-2">
        <LineSkeleton width="w-64" />
      </div>
      <RowsSkeleton count={3} height="h-28" />
    </PageSkeleton>
  );
}
