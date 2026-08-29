import { redirect } from "next/navigation";
import { getSessionInfo } from "@/lib/data";

/**
 * The notebook belongs to whoever is signed in, and to nobody else.
 *
 * The guard sits in the layout rather than only in the pages because of where
 * a loading boundary sits: `loading.tsx` wraps the page and everything below
 * it, but not the layout in its own segment. Once a skeleton has been
 * flushed, the response has gone out with its status line, and a redirect
 * from the page can no longer make it a 307 — the reader still arrives at the
 * sign-in card, but a crawler is told 200. Asked here, in front of the
 * boundary, it is a redirect again.
 *
 * The pages keep their own checks. RLS is what actually protects a note; this
 * decides what the response says.
 */
export default async function NotesLayout({ children }: LayoutProps<"/notes">) {
  if (!(await getSessionInfo())) redirect("/login");
  return children;
}
