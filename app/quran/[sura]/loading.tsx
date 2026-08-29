import { ReadingSkeleton } from "@/components/skeletons";

/** The mushaf reads like a book, and is bare like one. */
export default function SuraLoading() {
  return <ReadingSkeleton lines={10} />;
}
