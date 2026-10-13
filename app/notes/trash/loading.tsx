import { HeadingSkeleton, LineSkeleton, PageSkeleton, RowsSkeleton } from "@/components/skeletons";

/** The trash: a way back, a heading, a line of explanation, rows. */
export default function NotesTrashLoading() {
  return (
    <PageSkeleton>
      <LineSkeleton width="w-32" />
      <div className="mt-2">
        <HeadingSkeleton width="w-40" />
      </div>
      <div className="mt-2">
        <LineSkeleton width="w-72" />
      </div>
      <RowsSkeleton count={3} height="h-[112px]" />
    </PageSkeleton>
  );
}
