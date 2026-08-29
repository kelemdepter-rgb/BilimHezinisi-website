import { redirect } from "next/navigation";
import { getSessionInfo } from "@/lib/data";

/**
 * Bookmarks, saved notes, the account, the AI settings: all of it belongs to
 * one reader. Guarded here for the same reason as the notebook — a redirect
 * issued after loading.tsx has flushed its skeleton is no longer a 307, and
 * the pages below all keep their own checks besides.
 */
export default async function MyLayout({ children }: LayoutProps<"/my">) {
  if (!(await getSessionInfo())) redirect("/login");
  return children;
}
