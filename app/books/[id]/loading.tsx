import { LineSkeleton, PageSkeleton } from "@/components/skeletons";

/**
 * A book's own page: the cover on one side, the title, author, description
 * and the read/download controls on the other. The two-column grid is the
 * same one the real page uses, so the cover does not move when it arrives.
 */
export default function BookDetailLoading() {
  return (
    <PageSkeleton>
      <div className="mb-4 flex flex-wrap items-center gap-1.5">
        <LineSkeleton width="w-20" />
        <LineSkeleton width="w-24" />
      </div>
      <div className="grid gap-5 lg:grid-cols-[220px_1fr]">
        <div className="paper grain mx-auto w-40 overflow-hidden lg:mx-0 lg:w-full">
          <span className="skel block aspect-[3/4] w-full rounded-none border-0" />
        </div>
        <div className="flex flex-col gap-3">
          <span className="skel skel-line h-6 w-3/4" />
          <LineSkeleton width="w-1/2" />
          <div className="mt-1 flex flex-wrap gap-2">
            <span className="skel h-11 w-32" />
            <span className="skel h-11 w-32" />
            <span className="skel h-11 w-11" />
          </div>
          <div className="mt-3 flex flex-col gap-2.5">
            <LineSkeleton />
            <LineSkeleton />
            <LineSkeleton width="w-5/6" />
          </div>
        </div>
      </div>
    </PageSkeleton>
  );
}
