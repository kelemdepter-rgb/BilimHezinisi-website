import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Icon } from "@/components/icons";
import { AnnotationList } from "@/components/my/annotation-list";
import { QuranBookmarkList } from "@/components/my/quran-bookmark-list";
import { getMyAnnotations, getMyQuranBookmarks } from "@/lib/my";

export const metadata: Metadata = { title: "خەتكۈچلىرىم" };

export default async function MyBookmarksPage() {
  const [groups, quran] = await Promise.all([getMyAnnotations("bookmark"), getMyQuranBookmarks()]);
  // null means "not signed in" — annotations are personal, so send them to login.
  if (groups === null || quran === null) redirect("/login");

  return (
    <div className="px-3 py-5 sm:px-6 sm:py-7 lg:px-8">
      <h1 className="flex items-center gap-2.5 text-xl font-bold">
        <Icon name="bookmark" className="ic-lg text-am" />
        خەتكۈچلىرىم
      </h1>

      {groups.length === 0 && quran.length === 0 ? (
        <p className="paper mt-5 p-6 text-center text-[13.5px] leading-7 text-ink2">
          تېخى خەتكۈچ يوق. بىر كىتابنى ياكى قۇرئان ئايىتىنى ئوقۇۋېتىپ خەتكۈچ كۇنۇپكىسىنى
          باسسىڭىز مۇشۇ يەردە توپلىنىدۇ.
        </p>
      ) : (
        <div className="mt-5 space-y-8">
          {groups.length > 0 && <AnnotationList groups={groups} kind="bookmark" />}

          {quran.length > 0 && (
            <section aria-labelledby="quran-bookmarks-heading">
              <h2
                id="quran-bookmarks-heading"
                className="mb-2 flex items-center gap-2 text-[15px] font-bold"
              >
                <Icon name="mosque" className="text-am" />
                قۇرئان ئايەتلىرى
                <span className="text-[12px] font-normal text-ink3">({quran.length})</span>
              </h2>
              <QuranBookmarkList items={quran} />
            </section>
          )}
        </div>
      )}
    </div>
  );
}
