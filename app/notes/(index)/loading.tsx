import { HeadingSkeleton, LineSkeleton, PageSkeleton, RowsSkeleton } from "@/components/skeletons";

export default function NotesLoading() {
  return (
    <PageSkeleton>
      <HeadingSkeleton width="w-44" />
      <div className="mt-2">
        <LineSkeleton width="w-72" />
      </div>
      <RowsSkeleton count={4} height="h-[76px]" />
    </PageSkeleton>
  );
}
