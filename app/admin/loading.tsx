import { HeadingSkeleton, PageSkeleton, RowsSkeleton } from "@/components/skeletons";

/**
 * The admin area, which reads the role from the database on every request and
 * so can never be instant. Only the owner and the uploaders ever see this.
 */
export default function AdminLoading() {
  return (
    <PageSkeleton>
      <HeadingSkeleton width="w-36" />
      <RowsSkeleton count={5} height="h-16" />
    </PageSkeleton>
  );
}
