import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Icon } from "@/components/icons";
import { AnnotationList } from "@/components/my/annotation-list";
import { getMyAnnotations } from "@/lib/my";

export const metadata: Metadata = { title: "خەتكۈچلىرىم" };

export default async function MyBookmarksPage() {
  const groups = await getMyAnnotations("bookmark");
  // null means "not signed in" — annotations are personal, so send them to login.
  if (groups === null) redirect("/login");

  return (
    <div className="px-3 py-5 sm:px-6 sm:py-7 lg:px-8">
      <h1 className="flex items-center gap-2.5 text-xl font-bold">
        <Icon name="bookmark" className="ic-lg text-am" />
        خەتكۈچلىرىم
      </h1>

      {groups.length === 0 ? (
        <p className="paper mt-5 p-6 text-center text-[13.5px] leading-7 text-ink2">
          تېخى خەتكۈچ يوق. بىر كىتابنى ئوقۇۋېتىپ يۇقىرىدىكى خەتكۈچ كۇنۇپكىسىنى باسسىڭىز
          مۇشۇ يەردە توپلىنىدۇ.
        </p>
      ) : (
        <div className="mt-5">
          <AnnotationList groups={groups} kind="bookmark" />
        </div>
      )}
    </div>
  );
}
