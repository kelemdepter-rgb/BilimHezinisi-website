import { HeadingSkeleton, LineSkeleton, PageSkeleton } from "@/components/skeletons";

export default function QuranLoading() {
  return (
    <PageSkeleton>
      <HeadingSkeleton width="w-36" />
      <div className="mt-2">
        <LineSkeleton width="w-64" />
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <span className="skel h-12 min-w-0 flex-1" />
        <span className="skel h-12 w-24" />
      </div>
      <ul className="mt-5 grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 12 }, (_, index) => (
          <li key={index} className="skel h-[62px] w-full" />
        ))}
      </ul>
    </PageSkeleton>
  );
}
