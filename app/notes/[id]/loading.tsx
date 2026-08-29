import { ReadingSkeleton } from "@/components/skeletons";

/** The note editor: a writing surface with its own toolbar. */
export default function NoteEditorLoading() {
  return <ReadingSkeleton lines={8} />;
}
