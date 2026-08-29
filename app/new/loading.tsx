import { BookGridSkeleton, HeadingSkeleton, LineSkeleton, PageSkeleton } from "@/components/skeletons";

export default function NewBooksLoading() {
  return (
    <PageSkeleton>
      <HeadingSkeleton width="w-40" />
      <div className="mt-2.5 max-w-40">
        <LineSkeleton width="w-28" />
      </div>
      <div className="mt-5">
        <BookGridSkeleton />
      </div>
    </PageSkeleton>
  );
}
