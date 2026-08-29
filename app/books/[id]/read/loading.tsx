import { ReadingSkeleton } from "@/components/skeletons";

/**
 * The reader is a bare full-height surface with its own toolbar, so it gets
 * the reading skeleton rather than the page one — a site header would appear
 * here and then vanish again when the real reader took over.
 */
export default function ReaderLoading() {
  return <ReadingSkeleton />;
}
